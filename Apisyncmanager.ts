/**
 * API Sync Manager
 * Handles automatic synchronization of URLs from API
 * with intelligent caching, retry logic, and background sync
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

export interface APIURLItem {
    id: number;
    callback_name: string;
    url: string;
    callback_url: string;
    is_active: number;
    created_at: string;
    updated_at: string;
}

export interface APIResponse {
    status: string;
    message: string;
    data: APIURLItem[];
}

export interface SyncResult {
    success: boolean;
    timestamp: string;
    newData?: APIURLItem[];
    previousData?: APIURLItem[];
    addedUrls: APIURLItem[];
    modifiedUrls: APIURLItem[];
    removedUrls: APIURLItem[];
    oldCount: number;
    newCount: number;
    error?: string;
    dataChecksum: string;
    syncDuration: number;
}

export interface SyncNotification {
    id: string;
    type: 'new_urls' | 'modified_urls' | 'removed_urls' | 'sync_error';
    title: string;
    message: string;
    timestamp: string;
    data: any;
    acknowledged: boolean;
}

export interface SyncConfiguration {
    apiEndpoint: string;
    autoSyncEnabled: boolean;
    syncInterval: number; // in milliseconds
    retryAttempts: number;
    retryDelay: number;
    cacheMaxAge: number; // in milliseconds
}

const STORAGE_KEYS = {
    CONFIG: '@ApiSync:config',
    LAST_SYNC: '@ApiSync:lastSync',
    CACHED_DATA: '@ApiSync:cachedData',
    SYNC_HISTORY: '@ApiSync:history',
    NOTIFICATIONS: '@ApiSync:notifications',
    STATS: '@ApiSync:stats',
};

const DEFAULT_CONFIG: SyncConfiguration = {
    apiEndpoint: '',
    autoSyncEnabled: false,
    syncInterval: 30 * 60 * 1000, // 30 minutes
    retryAttempts: 3,
    retryDelay: 5000, // 5 seconds
    cacheMaxAge: 10 * 60 * 1000, // 10 minutes
};

class ApiSyncManager {
    private static instance: ApiSyncManager;
    private config: SyncConfiguration = DEFAULT_CONFIG;
    private autoSyncTimer: NodeJS.Timeout | null = null;
    private isSyncing: boolean = false;
    private lastSyncTime: Date | null = null;
    private stats = {
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        lastSyncDuration: 0,
        totalDataReceived: 0,
    };

    private constructor() {
        this.loadConfiguration();
    }

    static getInstance(): ApiSyncManager {
        if (!ApiSyncManager.instance) {
            ApiSyncManager.instance = new ApiSyncManager();
        }
        return ApiSyncManager.instance;
    }

    // Configure sync manager
    async configure(config: Partial<SyncConfiguration>): Promise<void> {
        this.config = { ...this.config, ...config };
        await AsyncStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(this.config));

        // If auto sync is enabled, start it
        if (this.config.autoSyncEnabled && this.config.apiEndpoint) {
            await this.startAutoSync();
        } else {
            this.stopAutoSync();
        }
    }

    // Load configuration from storage
    private async loadConfiguration(): Promise<void> {
        try {
            const stored = await AsyncStorage.getItem(STORAGE_KEYS.CONFIG);
            if (stored) {
                this.config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
            }

            const stats = await AsyncStorage.getItem(STORAGE_KEYS.STATS);
            if (stats) {
                this.stats = JSON.parse(stats);
            }
        } catch (error) {
            console.error('Error loading API sync configuration:', error);
        }
    }

    // Start automatic synchronization
    async startAutoSync(): Promise<void> {
        if (this.autoSyncTimer) {
            this.stopAutoSync();
        }

        if (!this.config.apiEndpoint) {
            console.warn('Cannot start auto sync: API endpoint not configured');
            return;
        }

        console.log(`Starting auto sync with interval: ${this.config.syncInterval}ms`);

        // Perform initial sync
        await this.performManualSync();

        // Schedule periodic syncs
        this.autoSyncTimer = setInterval(async () => {
            try {
                await this.performManualSync();
            } catch (error) {
                console.error('Auto sync error:', error);
            }
        }, this.config.syncInterval);
    }

    // Stop automatic synchronization
    stopAutoSync(): void {
        if (this.autoSyncTimer) {
            clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
            console.log('Auto sync stopped');
        }
    }

    // Check if auto sync is enabled
    isAutoSyncEnabled(): boolean {
        return this.config.autoSyncEnabled && this.autoSyncTimer !== null;
    }

    // Perform manual sync
    async performManualSync(): Promise<SyncResult> {
        if (this.isSyncing) {
            console.log('Sync already in progress, skipping...');
            throw new Error('Sync already in progress');
        }

        this.isSyncing = true;
        const startTime = Date.now();

        try {
            const result = await this.syncWithRetry();

            // Update stats
            this.stats.totalSyncs++;
            if (result.success) {
                this.stats.successfulSyncs++;
                this.stats.totalDataReceived += result.newCount;
            } else {
                this.stats.failedSyncs++;
            }
            this.stats.lastSyncDuration = result.syncDuration;

            await this.saveStats();
            await this.saveSyncHistory(result);

            // Emit event for listeners
            DeviceEventEmitter.emit('ApiSyncCompleted', result);

            return result;
        } finally {
            this.isSyncing = false;
        }
    }

    // Sync with retry logic
    private async syncWithRetry(): Promise<SyncResult> {
        let lastError: any = null;

        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                console.log(`Sync attempt ${attempt}/${this.config.retryAttempts}`);
                return await this.performSync();
            } catch (error: any) {
                lastError = error;
                console.error(`Sync attempt ${attempt} failed:`, error.message);

                if (attempt < this.config.retryAttempts) {
                    await this.delay(this.config.retryDelay * attempt);
                }
            }
        }

        // All attempts failed
        const failedResult: SyncResult = {
            success: false,
            timestamp: new Date().toISOString(),
            addedUrls: [],
            modifiedUrls: [],
            removedUrls: [],
            oldCount: 0,
            newCount: 0,
            error: lastError?.message || 'Sync failed after all retry attempts',
            dataChecksum: '',
            syncDuration: 0,
        };

        await this.createNotification({
            type: 'sync_error',
            title: 'API Sync Failed',
            message: failedResult.error || 'Unknown error',
            data: { attempts: this.config.retryAttempts },
        });

        return failedResult;
    }

    // Perform the actual sync
    private async performSync(): Promise<SyncResult> {
        const startTime = Date.now();

        try {
            // Fetch data from API
            const response = await fetch(this.config.apiEndpoint, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                timeout: 30000,
            });

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }

            const apiResponse: APIResponse = await response.json();

            if (!apiResponse.data || !Array.isArray(apiResponse.data)) {
                throw new Error('Invalid API response format');
            }

            const newData = apiResponse.data;
            const previousData = await this.getCachedData();

            // Compare and detect changes
            const changes = this.detectChanges(previousData, newData);

            // Save new data to cache
            await this.cacheData(newData);

            const result: SyncResult = {
                success: true,
                timestamp: new Date().toISOString(),
                newData,
                previousData,
                ...changes,
                dataChecksum: this.generateChecksum(newData),
                syncDuration: Date.now() - startTime,
            };

            this.lastSyncTime = new Date();

            // Create notifications for changes
            if (changes.addedUrls.length > 0) {
                await this.createNotification({
                    type: 'new_urls',
                    title: 'New URLs Available',
                    message: `${changes.addedUrls.length} new URLs detected from API`,
                    data: changes.addedUrls,
                });
            }

            if (changes.modifiedUrls.length > 0) {
                await this.createNotification({
                    type: 'modified_urls',
                    title: 'URLs Updated',
                    message: `${changes.modifiedUrls.length} URLs were modified`,
                    data: changes.modifiedUrls,
                });
            }

            if (changes.removedUrls.length > 0) {
                await this.createNotification({
                    type: 'removed_urls',
                    title: 'URLs Removed',
                    message: `${changes.removedUrls.length} URLs were removed`,
                    data: changes.removedUrls,
                });
            }

            return result;
        } catch (error: any) {
            throw new Error(`Sync failed: ${error.message}`);
        }
    }

    // Detect changes between old and new data
    private detectChanges(
        oldData: APIURLItem[],
        newData: APIURLItem[],
    ): {
        addedUrls: APIURLItem[];
        modifiedUrls: APIURLItem[];
        removedUrls: APIURLItem[];
        oldCount: number;
        newCount: number;
    } {
        const oldMap = new Map(oldData.map(item => [item.id, item]));
        const newMap = new Map(newData.map(item => [item.id, item]));

        const addedUrls: APIURLItem[] = [];
        const modifiedUrls: APIURLItem[] = [];
        const removedUrls: APIURLItem[] = [];

        // Find added and modified
        for (const [id, newItem] of newMap) {
            const oldItem = oldMap.get(id);
            if (!oldItem) {
                addedUrls.push(newItem);
            } else if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
                modifiedUrls.push(newItem);
            }
        }

        // Find removed
        for (const [id, oldItem] of oldMap) {
            if (!newMap.has(id)) {
                removedUrls.push(oldItem);
            }
        }

        return {
            addedUrls,
            modifiedUrls,
            removedUrls,
            oldCount: oldData.length,
            newCount: newData.length,
        };
    }

    // Cache data locally
    private async cacheData(data: APIURLItem[]): Promise<void> {
        await AsyncStorage.setItem(
            STORAGE_KEYS.CACHED_DATA,
            JSON.stringify({
                data,
                timestamp: new Date().toISOString(),
                checksum: this.generateChecksum(data),
            }),
        );
    }

    // Get cached data
    private async getCachedData(): Promise<APIURLItem[]> {
        try {
            const cached = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_DATA);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);

                // Check if cache is still valid
                const cacheAge = Date.now() - new Date(timestamp).getTime();
                if (cacheAge < this.config.cacheMaxAge) {
                    return data;
                }
            }
        } catch (error) {
            console.error('Error reading cached data:', error);
        }
        return [];
    }

    // Get latest synced data
    async getLatestSyncedData(): Promise<{
        data: APIURLItem[];
        timestamp: string;
        checksum: string;
    } | null> {
        try {
            const cached = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_DATA);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (error) {
            console.error('Error getting latest synced data:', error);
        }
        return null;
    }

    // Generate checksum for data integrity
    private generateChecksum(data: APIURLItem[]): string {
        const str = JSON.stringify(data.map(item => ({
            id: item.id,
            url: item.url,
            updated_at: item.updated_at,
        })));

        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    // Create notification
    private async createNotification(
        notification: Omit<SyncNotification, 'id' | 'timestamp' | 'acknowledged'>,
    ): Promise<void> {
        const newNotification: SyncNotification = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            acknowledged: false,
            ...notification,
        };

        const notifications = await this.getPendingNotifications();
        notifications.push(newNotification);

        await AsyncStorage.setItem(
            STORAGE_KEYS.NOTIFICATIONS,
            JSON.stringify(notifications),
        );
    }

    // Get pending notifications
    async getPendingNotifications(): Promise<SyncNotification[]> {
        try {
            const stored = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Error getting notifications:', error);
            return [];
        }
    }

    // Acknowledge notification
    async acknowledgeNotification(id: string): Promise<void> {
        const notifications = await this.getPendingNotifications();
        const updated = notifications.map(n =>
            n.id === id ? { ...n, acknowledged: true } : n,
        );
        await AsyncStorage.setItem(
            STORAGE_KEYS.NOTIFICATIONS,
            JSON.stringify(updated),
        );
    }

    // Clear old notifications
    async clearOldNotifications(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<void> {
        const notifications = await this.getPendingNotifications();
        const cutoff = Date.now() - olderThanMs;
        const filtered = notifications.filter(
            n => new Date(n.timestamp).getTime() > cutoff,
        );
        await AsyncStorage.setItem(
            STORAGE_KEYS.NOTIFICATIONS,
            JSON.stringify(filtered),
        );
    }

    // Save sync history
    private async saveSyncHistory(result: SyncResult): Promise<void> {
        try {
            const history = await this.getSyncHistory();
            history.unshift(result);

            // Keep only last 50 sync results
            const trimmed = history.slice(0, 50);

            await AsyncStorage.setItem(
                STORAGE_KEYS.SYNC_HISTORY,
                JSON.stringify(trimmed),
            );
        } catch (error) {
            console.error('Error saving sync history:', error);
        }
    }

    // Get sync history
    async getSyncHistory(): Promise<SyncResult[]> {
        try {
            const stored = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_HISTORY);
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Error getting sync history:', error);
            return [];
        }
    }

    // Save stats
    private async saveStats(): Promise<void> {
        await AsyncStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(this.stats));
    }

    // Get stats
    getStats() {
        return {
            ...this.stats,
            lastSyncTime: this.lastSyncTime?.toISOString() || null,
            isSyncing: this.isSyncing,
            autoSyncEnabled: this.isAutoSyncEnabled(),
        };
    }

    // Get configuration
    getConfiguration(): SyncConfiguration {
        return { ...this.config };
    }

    // Clear all data
    async clearAllData(): Promise<void> {
        await Promise.all([
            AsyncStorage.removeItem(STORAGE_KEYS.CACHED_DATA),
            AsyncStorage.removeItem(STORAGE_KEYS.SYNC_HISTORY),
            AsyncStorage.removeItem(STORAGE_KEYS.NOTIFICATIONS),
        ]);
    }

    // Utility: delay function
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
export const apiSyncManager = ApiSyncManager.getInstance();
export default ApiSyncManager;