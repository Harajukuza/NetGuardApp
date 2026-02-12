import React, { useEffect, useRef, useCallback } from 'react';
import {
  AppState,
  AppStateStatus,
  Platform,
  NativeModules,
  NativeEventEmitter,
  DeviceEventEmitter,
  EmitterSubscription,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import BackgroundTimer from 'react-native-background-timer';
import BackgroundActions from 'react-native-background-actions';
import DeviceInfo from 'react-native-device-info';

// Types and Interfaces
interface URLCheckResult {
  id: string;
  url: string;
  status: 'active' | 'inactive' | 'error';
  statusCode?: number;
  responseTime?: number;
  error?: string;
  timestamp: number;
}

interface ServiceConfig {
  checkInterval: number;
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  batchSize: number;
  enableLogging: boolean;
  enableNotifications: boolean;
}

interface ServiceState {
  isRunning: boolean;
  lastCheck: number | null;
  totalChecks: number;
  failedChecks: number;
  successfulChecks: number;
  uptime: number;
  errors: string[];
}

interface CallbackConfig {
  enabled: boolean;
  url: string;
  maxRetries: number;
  retryDelay: number;
}

// Constants
const DEFAULT_CONFIG: ServiceConfig = {
  checkInterval: 300000, // 5 minutes
  maxRetries: 3,
  retryDelay: 5000,
  timeout: 30000,
  batchSize: 10,
  enableLogging: true,
  enableNotifications: true,
};

const STORAGE_KEYS = {
  SERVICE_CONFIG: '@netguard_service_config',
  SERVICE_STATE: '@netguard_service_state',
  CHECK_RESULTS: '@netguard_check_results',
  PENDING_CALLBACKS: '@netguard_pending_callbacks',
  URLS: '@netguard_urls',
  CALLBACK_CONFIG: '@netguard_callback_config',
  LOGS: '@netguard_logs',
};

const BACKGROUND_TASK_OPTIONS = {
  taskName: 'NetGuard URL Monitor',
  taskTitle: 'NetGuard Active',
  taskDesc: 'Monitoring URLs in background',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#ff00ff',
  linkingURI: 'netguard://',
  parameters: {
    delay: 0,
  },
};

/**
 * Improved Background Service Class with Better Memory Management
 */
class ImprovedBackgroundService {
  private static instance: ImprovedBackgroundService | null = null;

  // Service state
  private isInitialized: boolean = false;
  private isRunning: boolean = false;
  private config: ServiceConfig = DEFAULT_CONFIG;
  private state: ServiceState = {
    isRunning: false,
    lastCheck: null,
    totalChecks: 0,
    failedChecks: 0,
    successfulChecks: 0,
    uptime: 0,
    errors: [],
  };

  // Timers and intervals
  private checkInterval: NodeJS.Timeout | null = null;
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private uptimeTimer: NodeJS.Timeout | null = null;

  // Event subscriptions
  private subscriptions: EmitterSubscription[] = [];
  private netInfoUnsubscribe: (() => void) | null = null;
  private appStateSubscription: EmitterSubscription | null = null;

  // Abort controllers for fetch requests
  private abortControllers: Map<string, AbortController> = new Map();

  // Queue management
  private pendingCallbacks: Map<string, any> = new Map();
  private checkQueue: string[] = [];
  private isProcessingQueue: boolean = false;

  // Service start time
  private serviceStartTime: number = 0;

  private constructor() {
    this.log('ImprovedBackgroundService constructor called');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ImprovedBackgroundService {
    if (!ImprovedBackgroundService.instance) {
      ImprovedBackgroundService.instance = new ImprovedBackgroundService();
    }
    return ImprovedBackgroundService.instance;
  }

  /**
   * Initialize the service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.log('Service already initialized');
      return;
    }

    try {
      this.log('Initializing service...');

      // Load saved configuration and state
      await this.loadConfiguration();
      await this.loadState();

      // Setup event listeners with proper cleanup
      this.setupEventListeners();

      // Setup health monitoring
      this.startHealthMonitoring();

      // Setup uptime tracking
      this.startUptimeTracking();

      this.isInitialized = true;
      this.log('Service initialized successfully');
    } catch (error) {
      this.logError('Failed to initialize service', error);
      throw error;
    }
  }

  /**
   * Start the background service
   */
  public async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      this.log('Service already running');
      return;
    }

    try {
      this.log('Starting background service...');

      this.serviceStartTime = Date.now();
      this.isRunning = true;
      this.state.isRunning = true;

      // Start background task based on platform
      if (Platform.OS === 'android') {
        await this.startAndroidBackgroundTask();
      } else if (Platform.OS === 'ios') {
        await this.startiOSBackgroundTask();
      }

      // Start periodic checks
      this.startPeriodicChecks();

      // Process any pending callbacks
      await this.processPendingCallbacks();

      // Save state
      await this.saveState();

      this.log('Background service started successfully');
    } catch (error) {
      this.logError('Failed to start background service', error);
      this.isRunning = false;
      this.state.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the background service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.log('Service not running');
      return;
    }

    try {
      this.log('Stopping background service...');

      this.isRunning = false;
      this.state.isRunning = false;

      // Clear all timers
      this.clearAllTimers();

      // Cancel all ongoing requests
      this.cancelAllRequests();

      // Stop background tasks
      if (Platform.OS === 'android') {
        await this.stopAndroidBackgroundTask();
      } else if (Platform.OS === 'ios') {
        await this.stopiOSBackgroundTask();
      }

      // Save final state
      await this.saveState();

      this.log('Background service stopped successfully');
    } catch (error) {
      this.logError('Error stopping background service', error);
      throw error;
    }
  }

  /**
   * Cleanup and destroy the service
   */
  public async destroy(): Promise<void> {
    try {
      this.log('Destroying service...');

      // Stop the service
      await this.stop();

      // Remove all event listeners
      this.removeAllEventListeners();

      // Clear all data structures
      this.retryTimers.clear();
      this.abortControllers.clear();
      this.pendingCallbacks.clear();
      this.checkQueue = [];

      // Reset state
      this.isInitialized = false;

      // Clear singleton instance
      ImprovedBackgroundService.instance = null;

      this.log('Service destroyed successfully');
    } catch (error) {
      this.logError('Error destroying service', error);
    }
  }

  /**
   * Setup event listeners with proper cleanup
   */
  private setupEventListeners(): void {
    // App state change listener
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange.bind(this)
    );

    // Network state listener
    this.netInfoUnsubscribe = NetInfo.addEventListener(
      this.handleNetworkChange.bind(this)
    );

    // Native module events (Android)
    if (Platform.OS === 'android' && NativeModules.BackgroundTaskModule) {
      const emitter = new NativeEventEmitter(NativeModules.BackgroundTaskModule);

      this.subscriptions.push(
        emitter.addListener('onBackgroundTaskStart', this.handleBackgroundTaskStart.bind(this))
      );

      this.subscriptions.push(
        emitter.addListener('onBackgroundTaskStop', this.handleBackgroundTaskStop.bind(this))
      );
    }

    // Device event listeners
    this.subscriptions.push(
      DeviceEventEmitter.addListener('backgroundTimer.timeout', this.handleBackgroundTimeout.bind(this))
    );
  }

  /**
   * Remove all event listeners
   */
  private removeAllEventListeners(): void {
    // Remove app state listener
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // Remove network listener
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }

    // Remove all other subscriptions
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions = [];
  }

  /**
   * Clear all timers
   */
  private clearAllTimers(): void {
    // Clear check interval
    if (this.checkInterval) {
      BackgroundTimer.clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Clear retry timers
    this.retryTimers.forEach(timer => BackgroundTimer.clearTimeout(timer));
    this.retryTimers.clear();

    // Clear health check timer
    if (this.healthCheckTimer) {
      BackgroundTimer.clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Clear uptime timer
    if (this.uptimeTimer) {
      BackgroundTimer.clearInterval(this.uptimeTimer);
      this.uptimeTimer = null;
    }
  }

  /**
   * Cancel all ongoing requests
   */
  private cancelAllRequests(): void {
    this.abortControllers.forEach((controller, key) => {
      controller.abort();
      this.log(`Cancelled request: ${key}`);
    });
    this.abortControllers.clear();
  }

  /**
   * Start Android background task
   */
  private async startAndroidBackgroundTask(): Promise<void> {
    try {
      // Start native foreground service
      if (NativeModules.BackgroundTaskModule) {
        await NativeModules.BackgroundTaskModule.startForegroundService(
          this.config.checkInterval / 60000 // Convert to minutes
        );
      }

      // Start BackgroundActions for additional reliability
      await BackgroundActions.start(
        this.performBackgroundWork.bind(this),
        BACKGROUND_TASK_OPTIONS
      );

      this.log('Android background task started');
    } catch (error) {
      this.logError('Failed to start Android background task', error);
      throw error;
    }
  }

  /**
   * Stop Android background task
   */
  private async stopAndroidBackgroundTask(): Promise<void> {
    try {
      // Stop native foreground service
      if (NativeModules.BackgroundTaskModule) {
        await NativeModules.BackgroundTaskModule.stopForegroundService();
      }

      // Stop BackgroundActions
      await BackgroundActions.stop();

      this.log('Android background task stopped');
    } catch (error) {
      this.logError('Failed to stop Android background task', error);
    }
  }

  /**
   * Start iOS background task
   */
  private async startiOSBackgroundTask(): Promise<void> {
    try {
      // iOS uses different approach - Background Fetch and Processing tasks
      BackgroundTimer.start();

      // Register for background fetch
      if (NativeModules.BackgroundTaskModule) {
        await NativeModules.BackgroundTaskModule.registerBackgroundFetch(
          this.config.checkInterval / 60000
        );
      }

      this.log('iOS background task started');
    } catch (error) {
      this.logError('Failed to start iOS background task', error);
      throw error;
    }
  }

  /**
   * Stop iOS background task
   */
  private async stopiOSBackgroundTask(): Promise<void> {
    try {
      BackgroundTimer.stop();

      // Unregister background fetch
      if (NativeModules.BackgroundTaskModule) {
        await NativeModules.BackgroundTaskModule.unregisterBackgroundFetch();
      }

      this.log('iOS background task stopped');
    } catch (error) {
      this.logError('Failed to stop iOS background task', error);
    }
  }

  /**
   * Start periodic URL checks
   */
  private startPeriodicChecks(): void {
    this.clearPeriodicCheck();

    this.checkInterval = BackgroundTimer.setInterval(
      () => {
        this.performChecks().catch(error => {
          this.logError('Periodic check failed', error);
        });
      },
      this.config.checkInterval
    );

    this.log(`Started periodic checks with interval: ${this.config.checkInterval}ms`);
  }

  /**
   * Clear periodic check timer
   */
  private clearPeriodicCheck(): void {
    if (this.checkInterval) {
      BackgroundTimer.clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Perform URL checks
   */
  private async performChecks(): Promise<void> {
    if (!this.isRunning || this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      const startTime = Date.now();
      this.log('Starting URL checks...');

      // Get URLs from storage
      const urls = await this.getStoredUrls();

      if (!urls || urls.length === 0) {
        this.log('No URLs to check');
        return;
      }

      // Process URLs in batches
      const results: URLCheckResult[] = [];
      const batches = this.createBatches(urls, this.config.batchSize);

      for (const batch of batches) {
        const batchResults = await Promise.allSettled(
          batch.map(url => this.checkURL(url))
        );

        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            this.logError(`Failed to check URL: ${batch[index].url}`, result.reason);
          }
        });

        // Small delay between batches
        await this.delay(100);
      }

      // Update state
      this.state.lastCheck = Date.now();
      this.state.totalChecks++;

      // Process results
      await this.processResults(results);

      // Send callback if configured
      await this.sendCallback(results);

      const duration = Date.now() - startTime;
      this.log(`URL checks completed in ${duration}ms`);

    } catch (error) {
      this.logError('Failed to perform checks', error);
      this.state.failedChecks++;
    } finally {
      this.isProcessingQueue = false;
      await this.saveState();
    }
  }

  /**
   * Check a single URL
   */
  private async checkURL(urlItem: any): Promise<URLCheckResult> {
    const controller = new AbortController();
    const key = `check_${urlItem.id}`;

    this.abortControllers.set(key, controller);

    try {
      const startTime = Date.now();

      const response = await fetch(urlItem.url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'NetGuard/1.0',
          'Cache-Control': 'no-cache',
        },
      });

      const responseTime = Date.now() - startTime;

      return {
        id: urlItem.id,
        url: urlItem.url,
        status: response.ok ? 'active' : 'inactive',
        statusCode: response.status,
        responseTime,
        timestamp: Date.now(),
      };

    } catch (error: any) {
      return {
        id: urlItem.id,
        url: urlItem.url,
        status: 'error',
        error: error.message || 'Unknown error',
        timestamp: Date.now(),
      };
    } finally {
      this.abortControllers.delete(key);
    }
  }

  /**
   * Process check results
   */
  private async processResults(results: URLCheckResult[]): Promise<void> {
    try {
      // Save results to storage
      await AsyncStorage.setItem(
        STORAGE_KEYS.CHECK_RESULTS,
        JSON.stringify({
          results,
          timestamp: Date.now(),
        })
      );

      // Update statistics
      const activeCount = results.filter(r => r.status === 'active').length;
      const inactiveCount = results.filter(r => r.status === 'inactive').length;
      const errorCount = results.filter(r => r.status === 'error').length;

      this.state.successfulChecks += activeCount;
      this.state.failedChecks += (inactiveCount + errorCount);

      this.log(`Results: Active: ${activeCount}, Inactive: ${inactiveCount}, Errors: ${errorCount}`);
    } catch (error) {
      this.logError('Failed to process results', error);
    }
  }

  /**
   * Send callback with results
   */
  private async sendCallback(results: URLCheckResult[]): Promise<void> {
    try {
      const callbackConfig = await this.getCallbackConfig();

      if (!callbackConfig?.enabled || !callbackConfig?.url) {
        return;
      }

      const controller = new AbortController();
      const timeoutId = BackgroundTimer.setTimeout(
        () => controller.abort(),
        this.config.timeout
      );

      try {
        const payload = {
          results,
          timestamp: Date.now(),
          device: {
            id: await DeviceInfo.getUniqueId(),
            platform: Platform.OS,
            version: DeviceInfo.getSystemVersion(),
            model: DeviceInfo.getModel(),
          },
        };

        const response = await fetch(callbackConfig.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NetGuard/1.0',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        BackgroundTimer.clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Callback failed with status: ${response.status}`);
        }

        this.log('Callback sent successfully');
      } catch (error) {
        BackgroundTimer.clearTimeout(timeoutId);

        // Save to pending callbacks for retry
        await this.savePendingCallback(results, callbackConfig);

        throw error;
      }
    } catch (error) {
      this.logError('Failed to send callback', error);
    }
  }

  /**
   * Save pending callback for retry
   */
  private async savePendingCallback(results: URLCheckResult[], config: CallbackConfig): Promise<void> {
    try {
      const key = `callback_${Date.now()}`;

      this.pendingCallbacks.set(key, {
        results,
        config,
        timestamp: Date.now(),
        retries: 0,
      });

      // Persist to storage
      const pendingList = Array.from(this.pendingCallbacks.entries());
      await AsyncStorage.setItem(
        STORAGE_KEYS.PENDING_CALLBACKS,
        JSON.stringify(pendingList)
      );

      // Schedule retry
      this.scheduleCallbackRetry(key);
    } catch (error) {
      this.logError('Failed to save pending callback', error);
    }
  }

  /**
   * Schedule callback retry
   */
  private scheduleCallbackRetry(key: string): void {
    const timer = BackgroundTimer.setTimeout(
      () => {
        this.retryCallback(key).catch(error => {
          this.logError(`Failed to retry callback ${key}`, error);
        });
      },
      this.config.retryDelay
    );

    this.retryTimers.set(key, timer);
  }

  /**
   * Retry a pending callback
   */
  private async retryCallback(key: string): Promise<void> {
    const pending = this.pendingCallbacks.get(key);

    if (!pending) {
      return;
    }

    pending.retries++;

    if (pending.retries > this.config.maxRetries) {
      this.log(`Max retries reached for callback ${key}, removing`);
      this.pendingCallbacks.delete(key);
      this.retryTimers.delete(key);
      return;
    }

    try {
      await this.sendCallback(pending.results);

      // Success - remove from pending
      this.pendingCallbacks.delete(key);
      this.retryTimers.delete(key);
    } catch (error) {
      // Schedule another retry
      this.scheduleCallbackRetry(key);
    }
  }

  /**
   * Process all pending callbacks
   */
  private async processPendingCallbacks(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_CALLBACKS);

      if (stored) {
        const pendingList = JSON.parse(stored);

        pendingList.forEach(([key, value]: [string, any]) => {
          this.pendingCallbacks.set(key, value);
          this.scheduleCallbackRetry(key);
        });

        this.log(`Loaded ${pendingList.length} pending callbacks`);
      }
    } catch (error) {
      this.logError('Failed to process pending callbacks', error);
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckTimer = BackgroundTimer.setInterval(
      () => {
        this.performHealthCheck().catch(error => {
          this.logError('Health check failed', error);
        });
      },
      60000 // Check every minute
    );
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      // Check memory usage
      const memoryInfo = await DeviceInfo.getUsedMemory();
      const totalMemory = await DeviceInfo.getTotalMemory();
      const memoryUsage = (memoryInfo / totalMemory) * 100;

      if (memoryUsage > 80) {
        this.log(`High memory usage detected: ${memoryUsage.toFixed(2)}%`);

        // Perform cleanup
        await this.performCleanup();
      }

      // Check for stale timers
      const now = Date.now();
      this.retryTimers.forEach((timer, key) => {
        const pending = this.pendingCallbacks.get(key);
        if (pending && (now - pending.timestamp) > 3600000) { // 1 hour
          this.log(`Removing stale callback: ${key}`);
          BackgroundTimer.clearTimeout(timer);
          this.retryTimers.delete(key);
          this.pendingCallbacks.delete(key);
        }
      });

      // Check service health
      if (this.isRunning && this.state.lastCheck) {
        const timeSinceLastCheck = now - this.state.lastCheck;
        const expectedInterval = this.config.checkInterval * 1.5;

        if (timeSinceLastCheck > expectedInterval) {
          this.log(`Service may be unhealthy, last check was ${timeSinceLastCheck}ms ago`);

          // Restart periodic checks
          this.startPeriodicChecks();
        }
      }
    } catch (error) {
      this.logError('Health check error', error);
    }
  }

  /**
   * Perform cleanup to free memory
   */
  private async performCleanup(): Promise<void> {
    try {
      // Clear old logs
      const logs = await AsyncStorage.getItem(STORAGE_KEYS.LOGS);
      if (logs) {
        const parsedLogs = JSON.parse(logs);
        const recentLogs = parsedLogs.slice(-100); // Keep only last 100 logs
        await AsyncStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(recentLogs));
      }

      // Clear old results
      const results = await AsyncStorage.getItem(STORAGE_KEYS.CHECK_RESULTS);
      if (results) {
        const parsed = JSON.parse(results);
        if (parsed.timestamp && (Date.now() - parsed.timestamp) > 86400000) { // 24 hours
          await AsyncStorage.removeItem(STORAGE_KEYS.CHECK_RESULTS);
        }
      }

      // Clear completed callbacks
      const toRemove: string[] = [];
      this.pendingCallbacks.forEach((value, key) => {
        if (value.retries > this.config.maxRetries) {
          toRemove.push(key);
        }
      });

      toRemove.forEach(key => {
        const timer = this.retryTimers.get(key);
        if (timer) {
          BackgroundTimer.clearTimeout(timer);
        }
        this.retryTimers.delete(key);
        this.pendingCallbacks.delete(key);
      });

      this.log('Cleanup completed');
    } catch (error) {
      this.logError('Cleanup failed', error);
    }
  }

  /**
   * Start uptime tracking
   */
  private startUptimeTracking(): void {
    this.uptimeTimer = BackgroundTimer.setInterval(
      () => {
        if (this.isRunning) {
          this.state.uptime = Date.now() - this.serviceStartTime;
        }
      },
      1000 // Update every second
    );
  }

  /**
   * Handle app state change
   */
  private handleAppStateChange(nextAppState: AppStateStatus): void {
    this.log(`App state changed to: ${nextAppState}`);

    if (nextAppState === 'background' && this.isRunning) {
      // Increase check interval in background
      const backgroundInterval = this.config.checkInterval * 2;
      this.config.checkInterval = backgroundInterval;
      this.startPeriodicChecks();

      this.log(`Adjusted interval for background: ${backgroundInterval}ms`);
    } else if (nextAppState === 'active' && this.isRunning) {
      // Restore normal interval
      this.loadConfiguration().then(() => {
        this.startPeriodicChecks();
      });
    }
  }

  /**
   * Handle network change
   */
  private handleNetworkChange(state: NetInfoState): void {
    this.log(`Network state changed: Connected: ${state.isConnected}, Type: ${state.type}`);

    if (state.isConnected && this.pendingCallbacks.size > 0) {
      // Process pending callbacks when network is available
      this.processPendingCallbacks().catch(error => {
        this.logError('Failed to process pending callbacks on network change', error);
      });
    }
  }

  /**
   * Handle background task start (Android)
   */
  private handleBackgroundTaskStart(data: any): void {
    this.log('Background task started from native', data);
  }

  /**
   * Handle background task stop (Android)
   */
  private handleBackgroundTaskStop(data: any): void {
    this.log('Background task stopped from native', data);
  }

  /**
   * Handle background timeout
   */
  private handleBackgroundTimeout(data: any): void {
    this.log('Background timeout occurred', data);
  }

  /**
   * Perform background work (for BackgroundActions)
   */
  private async performBackgroundWork(taskData: any): Promise<void> {
    while (BackgroundActions.isRunning() && this.isRunning) {
      try {
        await this.performChecks();
        await this.delay(this.config.checkInterval);
      } catch (error) {
        this.logError('Background work error', error);
        await this.delay(5000); // Wait 5 seconds before retry
      }
    }
  }

  /**
   * Load configuration from storage
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.SERVICE_CONFIG);
      if (stored) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
        this.log('Configuration loaded');
      }
    } catch (error) {
      this.logError('Failed to load configuration', error);
    }
  }

  /**
   * Save configuration to storage
   */
  public async saveConfiguration(config: Partial<ServiceConfig>): Promise<void> {
    try {
      this.config = { ...this.config, ...config };
      await AsyncStorage.setItem(STORAGE_KEYS.SERVICE_CONFIG, JSON.stringify(this.config));
      this.log('Configuration saved');

      // Restart periodic checks with new interval
      if (this.isRunning) {
        this.startPeriodicChecks();
      }
    } catch (error) {
      this.logError('Failed to save configuration', error);
      throw error;
    }
  }

  /**
   * Load service state from storage
   */
  private async loadState(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.SERVICE_STATE);
      if (stored) {
        const savedState = JSON.parse(stored);
        this.state = { ...this.state, ...savedState };
        this.log('State loaded');
      }
    } catch (error) {
      this.logError('Failed to load state', error);
    }
  }

  /**
   * Save service state to storage
   */
