/**
 * Enhanced Background Service Manager
 * Provides stable background monitoring with improved native integration
 * and better handling of background constraints
 */

import {
    Platform,
    AppState,
    NativeModules,
    DeviceEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';
import BackgroundJob from 'react-native-background-actions';

interface URLCheckResult {
    url: string;
    status: 'active' | 'inactive';
    responseTime: number;
    statusCode?: number;
    error?: string;
    timestamp: string;
}

interface NetworkInfo {
    type: string;
    carrier: string;
    isConnected: boolean;
    isWifiEnabled: boolean;
    isMobileEnabled: boolean;
    displayName: string;
}

interface CallbackConfig {
    name: string;
    url: string;
}

interface BackgroundServiceConfig {
    urls: string[];
    callbackConfig: CallbackConfig;
    intervalMinutes: number;
    retryAttempts: number;
    timeoutMs: number;
}

interface BackgroundServiceStats {
    totalChecks: number;
    successfulChecks: number;
    failedChecks: number;
    successfulCallbacks: number;
    failedCallbacks: number;
    lastCheckTime: string | null;
    uptime: number;
    isRunning: boolean;
}

const STORAGE_KEYS = {
    SERVICE_CONFIG: '@EnhancedBG:config',
    SERVICE_STATS: '@EnhancedBG:stats',
    PENDING_CALLBACKS: '@EnhancedBG:pendingCallbacks',
    LAST_RESULTS: '@EnhancedBG:lastResults',
    SERVICE_LOGS: '@EnhancedBG:logs',
};

const USER_AGENTS = [
    'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'NetGuard-Background-Monitor/2.0 (Android; Background-Service)',
];

class EnhancedBackgroundService {
    private static instance: EnhancedBackgroundService;
    private serviceStartTime: Date | null = null;
    private isServiceRunning: boolean = false;
    private currentConfig: BackgroundServiceConfig | null = null;
    private stats: BackgroundServiceStats;
    private pendingCallbacks: URLCheckResult[][] = [];
    private retryTimer: NodeJS.Timeout | null = null;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private lastActivityTime: Date = new Date();

    private constructor() {
        this.stats = {
            totalChecks: 0,
            successfulChecks: 0,
            failedChecks: 0,
            successfulCallbacks: 0,
            failedCallbacks: 0,
            lastCheckTime: null,
            uptime: 0,
            isRunning: false,
        };
        this.initializeEventListeners();
    }
    
    static getInstance(): EnhancedBackgroundService {
        if (!EnhancedBackgroundService.instance) {
            EnhancedBackgroundService.instance = new EnhancedBackgroundService();
        }
        return EnhancedBackgroundService.instance;
    }

    private initializeEventListeners() {
        // Listen for app state changes
        AppState.addEventListener('change', this.handleAppStateChange.bind(this));

        // Listen for network state changes
        if (Platform.OS === 'android') {
            DeviceEventEmitter.addListener(
                'NetworkStateChanged',
                this.handleNetworkChange.bind(this),
            );
        }

        // Recovery mechanism - check service health every 5 minutes
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, 5 * 60 * 1000);
    }

    private async handleAppStateChange(nextAppState: string) {
        this.log(`App state changed to: ${nextAppState}`);

        if (nextAppState === 'active') {
            // App came to foreground - sync stats and check service
            await this.syncStatsFromStorage();
            await this.checkServiceHealth();

            // Process any pending callbacks
            if (this.pendingCallbacks.length > 0) {
                await this.processPendingCallbacks();
            }
        } else if (nextAppState === 'background' || nextAppState === 'inactive') {
            // App going to background - save current state
            await this.saveCurrentState();
            this.lastActivityTime = new Date();
        }
    }

    private handleNetworkChange(networkInfo: any) {
        this.log('Network state changed', networkInfo);

        // If network is available and we have pending callbacks, try to send them
        if (networkInfo.isConnected && this.pendingCallbacks.length > 0) {
            setTimeout(() => {
                this.processPendingCallbacks();
            }, 2000); // Wait 2 seconds for network to stabilize
        }
    }

    private async performHealthCheck() {
        if (!this.isServiceRunning) return;

        try {
            const isBackgroundJobRunning = BackgroundJob.isRunning();

            if (!isBackgroundJobRunning && this.isServiceRunning) {
                this.log(
                    'Health check failed: Background service stopped unexpectedly',
                );
                await this.restartService();
            }

            // Check if we've missed any scheduled checks
            const now = new Date();
            const timeSinceLastCheck = this.stats.lastCheckTime
                ? now.getTime() - new Date(this.stats.lastCheckTime).getTime()
                : Infinity;

            if (
                this.currentConfig &&
                timeSinceLastCheck >
                this.currentConfig.intervalMinutes * 60 * 1000 * 1.5
            ) {
                this.log(
                    'Health check: Missed scheduled check, triggering immediate check',
                );
                // Don't restart, just log - the background task should handle this
            }

            await this.updateStats({ uptime: this.getUptime() });
        } catch (error) {
            this.log('Health check error', error);
        }
    }

    private async restartService() {
        if (!this.currentConfig) return;

        this.log('Attempting to restart background service...');

        try {
            await this.stopService();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.startService(this.currentConfig);
            this.log('Background service restarted successfully');
        } catch (error) {
            this.log('Failed to restart background service', error);
        }
    }

    private async checkServiceHealth() {
        if (!this.isServiceRunning) return;

        const isBackgroundJobRunning = BackgroundJob.isRunning();

        if (isBackgroundJobRunning !== this.isServiceRunning) {
            this.log(
                `Service health check: Status mismatch - Internal: ${this.isServiceRunning}, BackgroundJob: ${isBackgroundJobRunning}`,
            );

            if (!isBackgroundJobRunning && this.currentConfig) {
                await this.restartService();
            }
        }
    }

    async startService(config: BackgroundServiceConfig): Promise<boolean> {
        try {
            this.log('Starting enhanced background service', config);

            if (this.isServiceRunning) {
                await this.stopService();
            }

            this.currentConfig = config;
            this.serviceStartTime = new Date();

            // Configure background task options
            const backgroundOptions = {
                taskName: 'URLMonitorEnhanced',
                taskTitle: '🔍 NetGuard Enhanced Monitor',
                taskDesc: `Monitoring ${config.urls.length} URLs every ${config.intervalMinutes}m`,
                taskIcon: {
                    name: 'ic_launcher',
                    type: 'mipmap',
                },
                color: '#2196F3',
                linkingURI: 'netguard://monitor',
                parameters: {
                    config: config,
                    startTime: this.serviceStartTime.getTime(),
                },
            };

            await BackgroundJob.start(
                this.backgroundTaskFunction.bind(this),
                backgroundOptions,
            );

            this.isServiceRunning = true;

            await this.saveCurrentState();
            await this.updateStats({
                isRunning: true,
                uptime: 0,
            });

            this.log('Enhanced background service started successfully');
            return true;
        } catch (error) {
            this.log('Failed to start enhanced background service', error);
            this.isServiceRunning = false;
            return false;
        }
    }

    async stopService(): Promise<void> {
        try {
            this.log('Stopping enhanced background service');

            await BackgroundJob.stop();

            this.isServiceRunning = false;
            this.serviceStartTime = null;
            this.currentConfig = null;

            // Clear health check timer
            if (this.healthCheckTimer) {
                clearInterval(this.healthCheckTimer);
                this.healthCheckTimer = null;
            }

            await this.updateStats({ isRunning: false });
            await this.saveCurrentState();

            this.log('Enhanced background service stopped');
        } catch (error) {
            this.log('Error stopping enhanced background service', error);
        }
    }

    private async backgroundTaskFunction(taskData: any) {
        // Prefer config passed via parameters, but fall back to stored service config
        let config = taskData?.parameters?.config as BackgroundServiceConfig;

        if (!config) {
            try {
                this.log('Background task: No config in parameters, attempting to load from storage');
                const stored = await AsyncStorage.getItem(STORAGE_KEYS.SERVICE_CONFIG);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    // stored state shape may include config inside an object
                    config = parsed.config ? (parsed.config as BackgroundServiceConfig) : (parsed as BackgroundServiceConfig);
                }
            } catch (e) {
                this.log('Background task: Error loading config from storage', e);
            }
        }

        if (!config) {
            this.log('Background task: No config provided');
            return;
        }

        this.log('Background task started with config', config);

        const intervalMs = config.intervalMinutes * 60 * 1000;
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5;

        while (BackgroundJob.isRunning()) {
            try {
                this.log('Background task: Starting URL check cycle');

                const checkResults = await this.performURLChecks(config);

                if (checkResults.length > 0) {
                    await this.updateStats({
                        totalChecks: 1,
                        successfulChecks:
                            checkResults.filter(r => r.status === 'active').length > 0
                                ? 1
                                : 0,
                        failedChecks:
                            checkResults.filter(r => r.status === 'inactive').length > 0
                                ? 1
                                : 0,
                        lastCheckTime: new Date().toISOString(),
                        uptime: this.getUptime(),
                    });

                    // Try to send callback
                    const callbackSent = await this.sendCallbackWithRetry(
                        checkResults,
                        config.callbackConfig,
                    );

                    if (callbackSent) {
                        await this.updateStats({ successfulCallbacks: 1 });
                    } else {
                        await this.updateStats({ failedCallbacks: 1 });
                        // Store for later retry
                        await this.storePendingCallback(checkResults);
                    }

                    consecutiveErrors = 0;
                }

                // Wait for next interval
                await this.sleep(intervalMs);
            } catch (error: any) {
                consecutiveErrors++;
                this.log('Background task error', error);

                await this.updateStats({ failedChecks: 1 });

                // If too many consecutive errors, increase wait time
                const waitTime =
                    consecutiveErrors > maxConsecutiveErrors
                        ? intervalMs * 2
                        : intervalMs;

                await this.sleep(waitTime);

                // Reset counter if we've had too many errors
                if (consecutiveErrors > maxConsecutiveErrors) {
                    consecutiveErrors = 0;
                    this.log('Resetting consecutive error counter after maximum reached');
                }
            }
        }

        this.log('Background task stopped');
    }

    private async performURLChecks(
        config: BackgroundServiceConfig,
    ): Promise<URLCheckResult[]> {
        this.log(`Performing URL checks for ${config.urls.length} URLs`);

        const results: URLCheckResult[] = [];

        for (let i = 0; i < config.urls.length; i++) {
            const url = config.urls[i];

            // Add random delay between requests to avoid rate limiting
            if (i > 0) {
                await this.randomSleep(2, 10);
            }

            try {
                const result = await this.checkSingleURL(
                    url,
                    config.timeoutMs,
                    config.retryAttempts,
                );
                results.push(result);
                this.log(`URL check completed: ${url} - ${result.status}`);
            } catch (error: any) {
                this.log(`URL check failed: ${url}`, error);
                results.push({
                    url,
                    status: 'inactive',
                    responseTime: config.timeoutMs,
                    error: error.message || 'Unknown error',
                    timestamp: new Date().toISOString(),
                });
            }
        }

        await this.saveResults(results);
        return results;
    }

    private async checkSingleURL(
        url: string,
        timeoutMs: number,
        retryAttempts: number,
    ): Promise<URLCheckResult> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < retryAttempts; attempt++) {
            const startTime = Date.now();

            try {
                const userAgent =
                    USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': userAgent,
                        Accept:
                            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Cache-Control': 'no-cache',
                        Pragma: 'no-cache',
                    },
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);
                const responseTime = Date.now() - startTime;

                // Consider more status codes as "active"
                const isActive =
                    (response.status >= 200 && response.status < 300) || // Success
                    (response.status >= 300 && response.status < 400) || // Redirect
                    response.status === 401 || // Unauthorized (but server is responding)
                    response.status === 403 || // Forbidden (but server is responding)
                    response.status === 429; // Rate limited (but server is responding)

                return {
                    url,
                    status: isActive ? 'active' : 'inactive',
                    responseTime,
                    statusCode: response.status,
                    timestamp: new Date().toISOString(),
                };
            } catch (error: any) {
                lastError = error;
                const responseTime = Date.now() - startTime;

                // If this is the last attempt, return the error
                if (attempt === retryAttempts - 1) {
                    return {
                        url,
                        status: 'inactive',
                        responseTime,
                        error: error.message || 'Network error',
                        timestamp: new Date().toISOString(),
                    };
                }

                // Wait before retry (exponential backoff)
                await this.sleep(Math.min(1000 * Math.pow(2, attempt), 10000));
            }
        }

        // Fallback (should not reach here)
        return {
            url,
            status: 'inactive',
            responseTime: timeoutMs,
            error: lastError?.message || 'Maximum retries exceeded',
            timestamp: new Date().toISOString(),
        };
    }

    private async sendCallbackWithRetry(
        results: URLCheckResult[],
        callbackConfig: CallbackConfig,
    ): Promise<boolean> {
        const maxRetries = 3;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const success = await this.sendCallback(results, callbackConfig);
                if (success) {
                    this.log('Callback sent successfully');
                    return true;
                }
            } catch (error: any) {
                lastError = error;
                this.log(`Callback attempt ${attempt + 1} failed`, error);

                if (attempt < maxRetries - 1) {
                    await this.sleep(Math.min(5000 * Math.pow(2, attempt), 30000));
                }
            }
        }

        this.log('All callback attempts failed', lastError);
        return false;
    }

    private async sendCallback(results: URLCheckResult[], callbackConfig: CallbackConfig): Promise<boolean> {
        if (!callbackConfig.url) {
            return false;
        }

        const deviceInfo = await this.getDeviceInfo();
        const networkInfo = await this.getNetworkInfo();
        
        // อ่าน URLs ที่ใช้ล่าสุดจาก storage
        const lastUsedUrls = await AsyncStorage.getItem('@Enhanced:lastUsedUrls');
        const totalUrls = lastUsedUrls ? JSON.parse(lastUsedUrls).length : results.length;
        
        const activeCount = results.filter(r => r.status === 'active').length;
        const inactiveCount = results.filter(r => r.status === 'inactive').length;

        const payload = {
            checkType: 'enhanced_background',
            timestamp: new Date().toISOString(),
            isBackground: true,
            serviceVersion: '2.0',
            summary: {
                total: totalUrls, // ใช้จำนวน URLs ที่ถูกต้อง
                active: activeCount,
                inactive: inactiveCount
            },
            urls: results,
            device: deviceInfo,
            network: networkInfo,
            serviceStats: {
                ...this.stats,
                uptime: this.getUptime()
            },
            callbackName: callbackConfig.name
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(callbackConfig.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'NetGuard-Enhanced-Background/2.0',
                    Accept: 'application/json',
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                this.log(`Callback sent successfully: ${response.status}`);
                return true;
            } else {
                this.log(`Callback failed with status: ${response.status}`);
                return false;
            }
        } catch (error: any) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    private async storePendingCallback(results: URLCheckResult[]) {
        try {
            this.pendingCallbacks.push(results);

            // Keep only last 10 pending callbacks to avoid memory issues
            if (this.pendingCallbacks.length > 10) {
                this.pendingCallbacks.shift();
            }

            await AsyncStorage.setItem(
                STORAGE_KEYS.PENDING_CALLBACKS,
                JSON.stringify(this.pendingCallbacks),
            );
        } catch (error) {
            this.log('Error storing pending callback', error);
        }
    }

    private async processPendingCallbacks() {
        if (this.pendingCallbacks.length === 0 || !this.currentConfig) return;

        this.log(`Processing ${this.pendingCallbacks.length} pending callbacks`);

        const callbacksToProcess = [...this.pendingCallbacks];
        this.pendingCallbacks = [];

        for (const results of callbacksToProcess) {
            try {
                const sent = await this.sendCallbackWithRetry(
                    results,
                    this.currentConfig.callbackConfig,
                );

                if (sent) {
                    await this.updateStats({ successfulCallbacks: 1 });
                } else {
                    // If still fails, put it back in pending (up to a limit)
                    if (this.pendingCallbacks.length < 5) {
                        this.pendingCallbacks.push(results);
                    }
                    await this.updateStats({ failedCallbacks: 1 });
                }
            } catch (error) {
                this.log('Error processing pending callback', error);
            }
        }

        // Update storage with remaining pending callbacks
        await AsyncStorage.setItem(
            STORAGE_KEYS.PENDING_CALLBACKS,
            JSON.stringify(this.pendingCallbacks),
        );
    }

    private async getNetworkInfo(): Promise<NetworkInfo> {
        try {
            const { BackgroundServiceModule } = NativeModules;

            if (Platform.OS === 'android' && BackgroundServiceModule) {
                const nativeNetworkInfo = await BackgroundServiceModule.getNetworkInfo();
                return {
                    type: nativeNetworkInfo.type || 'Unknown',
                    carrier: nativeNetworkInfo.carrier || 'Unknown',
                    isConnected: nativeNetworkInfo.isConnected || false,
                    isWifiEnabled: nativeNetworkInfo.isWifiEnabled || false,
                    isMobileEnabled: nativeNetworkInfo.isMobileEnabled || false,
                    displayName: nativeNetworkInfo.displayName || 'Unknown'
                };
            }
            
            return {
                type: 'Unknown',
                carrier: 'iOS/Fallback',
                isConnected: true,
                isWifiEnabled: false,
                isMobileEnabled: false,
                displayName: 'iOS Network'
            };
        } catch (error) {
            console.error('Error getting network info:', error);
            return {
                type: 'Error',
                carrier: 'Error',
                isConnected: false,
                isWifiEnabled: false,
                isMobileEnabled: false,
                displayName: 'Error'
            };
        }
    }

    private async getDeviceInfo() {
        try {
            const networkInfo = await this.getNetworkInfo();

            return {
                id: await DeviceInfo.getUniqueId(),
                model: DeviceInfo.getModel(),
                brand: DeviceInfo.getBrand(),
                platform: Platform.OS,
                version: DeviceInfo.getSystemVersion(),
                appVersion: DeviceInfo.getVersion(),
                network: networkInfo, // เพิ่มส่วนนี้
            };
        } catch (error) {
            console.error('Error getting device info:', error);
            const networkInfo = await this.getNetworkInfo();

            return {
                id: 'unknown',
                model: 'unknown',
                brand: 'unknown',
                platform: Platform.OS,
                version: 'unknown',
                appVersion: 'unknown',
                network: networkInfo, // เพิ่มส่วนนี้
            };
        }
    }

    private getUptime(): number {
        if (!this.serviceStartTime) return 0;
        return Math.floor((Date.now() - this.serviceStartTime.getTime()) / 1000);
    }

    private async saveCurrentState() {
        try {
            const state = {
                isRunning: this.isServiceRunning,
                config: this.currentConfig,
                startTime: this.serviceStartTime?.getTime() || null,
                lastActivityTime: this.lastActivityTime.getTime(),
            };

            await AsyncStorage.setItem(
                STORAGE_KEYS.SERVICE_CONFIG,
                JSON.stringify(state),
            );
        } catch (error) {
            this.log('Error saving current state', error);
        }
    }

    private async saveResults(results: URLCheckResult[]) {
        try {
            const timestamp = new Date().toISOString();
            const resultData = {
                timestamp,
                results,
            };

            await AsyncStorage.setItem(
                STORAGE_KEYS.LAST_RESULTS,
                JSON.stringify(resultData),
            );
        } catch (error) {
            this.log('Error saving results', error);
        }
    }

    private async updateStats(updates: Partial<BackgroundServiceStats>) {
        this.stats = {
            ...this.stats,
            ...updates,
            totalChecks: this.stats.totalChecks + (updates.totalChecks || 0),
            successfulChecks:
                this.stats.successfulChecks + (updates.successfulChecks || 0),
            failedChecks: this.stats.failedChecks + (updates.failedChecks || 0),
            successfulCallbacks:
                this.stats.successfulCallbacks + (updates.successfulCallbacks || 0),
            failedCallbacks:
                this.stats.failedCallbacks + (updates.failedCallbacks || 0),
        };

        try {
            await AsyncStorage.setItem(
                STORAGE_KEYS.SERVICE_STATS,
                JSON.stringify(this.stats),
            );
        } catch (error) {
            this.log('Error updating stats', error);
        }
    }

    private async syncStatsFromStorage() {
        try {
            const savedStats = await AsyncStorage.getItem(STORAGE_KEYS.SERVICE_STATS);
            if (savedStats) {
                this.stats = JSON.parse(savedStats);
            }

            const pendingCallbacks = await AsyncStorage.getItem(
                STORAGE_KEYS.PENDING_CALLBACKS,
            );
            if (pendingCallbacks) {
                this.pendingCallbacks = JSON.parse(pendingCallbacks);
            }
        } catch (error) {
            this.log('Error syncing stats from storage', error);
        }
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async randomSleep(
        minSeconds: number,
        maxSeconds: number,
    ): Promise<void> {
        const ms = (Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000;
        return this.sleep(ms);
    }

    private log(message: string, data?: any) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            message,
            data: data ? JSON.stringify(data) : undefined,
        };

        console.log(`[EnhancedBG ${timestamp}] ${message}`, data || '');

        // Store logs for debugging (keep last 50)
        AsyncStorage.getItem(STORAGE_KEYS.SERVICE_LOGS)
            .then(logs => {
                const parsedLogs = logs ? JSON.parse(logs) : [];
                parsedLogs.push(logEntry);

                if (parsedLogs.length > 50) {
                    parsedLogs.shift();
                }

                return AsyncStorage.setItem(
                    STORAGE_KEYS.SERVICE_LOGS,
                    JSON.stringify(parsedLogs),
                );
            })
            .catch(() => { });
    }

    // Public methods for external use
    async getServiceStatus() {
        return {
            isRunning: this.isServiceRunning,
            stats: this.stats,
            uptime: this.getUptime(),
            pendingCallbacks: this.pendingCallbacks.length,
            config: this.currentConfig,
        };
    }

    async getServiceLogs() {
        try {
            const logs = await AsyncStorage.getItem(STORAGE_KEYS.SERVICE_LOGS);
            return logs ? JSON.parse(logs) : [];
        } catch (error) {
            return [];
        }
    }

    async clearServiceLogs() {
        try {
            await AsyncStorage.removeItem(STORAGE_KEYS.SERVICE_LOGS);
        } catch (error) {
            this.log('Error clearing service logs', error);
        }
    }

    async getLastResults() {
        try {
            const results = await AsyncStorage.getItem(STORAGE_KEYS.LAST_RESULTS);
            return results ? JSON.parse(results) : null;
        } catch (error) {
            return null;
        }
    }

    isRunning(): boolean {
        return this.isServiceRunning && BackgroundJob.isRunning();
    }

    getStats(): BackgroundServiceStats {
        return { ...this.stats, uptime: this.getUptime() };
    }
}

export default EnhancedBackgroundService;
export type { BackgroundServiceConfig, BackgroundServiceStats, URLCheckResult };
