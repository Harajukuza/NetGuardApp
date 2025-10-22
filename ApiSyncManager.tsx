/**
 * Enhanced API Sync Manager
 * Provides reliable and intelligent API synchronization with data integrity checks
 * Features:
 * - Configurable sync intervals (30 minutes default)
 * - Retry mechanism with exponential backoff
 * - Data integrity validation with checksums
 * - Memory leak prevention
 * - Foreground/Background sync coordination
 * - Smart duplicate detection
 * - Comprehensive error handling
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform, DeviceEventEmitter } from 'react-native';
import DeviceInfo from 'react-native-device-info';

// Constants
const API_SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE = 5000; // 5 seconds
const REQUEST_TIMEOUT = 15000; // 15 seconds
const MAX_STORED_SYNC_HISTORY = 10;

// Storage keys
const STORAGE_KEYS = {
  API_ENDPOINT: '@ApiSyncManager:endpoint',
  SYNC_INTERVAL: '@ApiSyncManager:interval',
  LAST_SYNC_DATA: '@ApiSyncManager:lastSyncData',
  SYNC_STATS: '@ApiSyncManager:stats',
  SYNC_HISTORY: '@ApiSyncManager:history',
  PENDING_NOTIFICATIONS: '@ApiSyncManager:pendingNotifications',
  AUTO_SYNC_ENABLED: '@ApiSyncManager:autoSyncEnabled',
  DATA_CHECKSUM: '@ApiSyncManager:dataChecksum',
};

// TypeScript interfaces
export interface APIURLItem {
  id?: number;
  callback_name?: string;
  url?: string;
  callback_url?: string;
  is_active?: number;
  created_at?: string;
  updated_at?: string;
  // Support for different API formats
  title?: string;
  body?: string;
  userId?: number;
  [key: string]: any; // Allow additional properties
}

export interface APIResponse {
  status?: string;
  message?: string;
  data?: APIURLItem[];
  // Support direct array response
  [key: string]: any;
}

export interface SyncResult {
  success: boolean;
  timestamp: string;
  newData?: APIURLItem[];
  previousCount: number;
  newCount: number;
  addedUrls: APIURLItem[];
  removedUrls: APIURLItem[];
  modifiedUrls: APIURLItem[];
  dataChecksum: string;
  syncDuration: number;
  error?: string;
  retryAttempt: number;
}

export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  lastSyncTime: string | null;
  lastSuccessTime: string | null;
  consecutiveFailures: number;
  totalUrlsFound: number;
  totalNewUrls: number;
  averageSyncDuration: number;
  dataIntegrityChecks: number;
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

interface SyncConfig {
  apiEndpoint: string;
  syncInterval: number;
  autoSyncEnabled: boolean;
  maxRetries: number;
  timeoutMs: number;
  strictValidation?: boolean; // Allow disabling strict validation
}

class ApiSyncManager {
  private static instance: ApiSyncManager;
  private syncTimer: NodeJS.Timeout | null = null;
  private currentSyncPromise: Promise<SyncResult> | null = null;
  private isDestroyed: boolean = false;
  private appStateSubscription: any = null;
  private lastActivity: Date = new Date();
  private syncInProgress: boolean = false;
  private stats: SyncStats;
  private config: SyncConfig;
  private pendingNotifications: SyncNotification[] = [];

  private constructor() {
    this.stats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastSyncTime: null,
      lastSuccessTime: null,
      consecutiveFailures: 0,
      totalUrlsFound: 0,
      totalNewUrls: 0,
      averageSyncDuration: 0,
      dataIntegrityChecks: 0,
    };

    this.config = {
      apiEndpoint: '',
      syncInterval: API_SYNC_INTERVAL,
      autoSyncEnabled: false,
      maxRetries: MAX_RETRY_ATTEMPTS,
      timeoutMs: REQUEST_TIMEOUT,
      strictValidation: false, // Default to flexible validation for URL monitoring
    };

    this.initializeManager();
  }

  public static getInstance(): ApiSyncManager {
    if (!ApiSyncManager.instance) {
      ApiSyncManager.instance = new ApiSyncManager();
    }
    return ApiSyncManager.instance;
  }

  /**
   * Initialize the API Sync Manager
   */
  private async initializeManager() {
    try {
      await this.loadConfiguration();
      await this.loadStats();
      await this.loadPendingNotifications();
      this.setupAppStateListener();
      this.log('ApiSyncManager initialized successfully');
    } catch (error) {
      this.log('Failed to initialize ApiSyncManager', error);
    }
  }

  /**
   * Configure the sync manager
   */
  public async configure(config: Partial<SyncConfig>): Promise<void> {
    try {
      this.config = { ...this.config, ...config };
      await this.saveConfiguration();

      // Restart sync timer if interval changed
      if (config.syncInterval && this.syncTimer) {
        this.stopAutoSync();
        if (this.config.autoSyncEnabled) {
          this.startAutoSync();
        }
      }

      this.log('Configuration updated', config);
    } catch (error) {
      this.log('Failed to configure sync manager', error);
      throw error;
    }
  }

  /**
   * Enable or disable strict validation
   */
  public async setStrictValidation(enabled: boolean): Promise<void> {
    this.config.strictValidation = enabled;
    await this.saveConfiguration();
    this.log(`Strict validation ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if strict validation is enabled
   */
  public isStrictValidationEnabled(): boolean {
    return this.config.strictValidation || false;
  }

  /**
   * Start automatic background synchronization
   */
  public async startAutoSync(): Promise<void> {
    try {
      if (this.isDestroyed) {
        throw new Error('ApiSyncManager has been destroyed');
      }

      if (!this.config.apiEndpoint) {
        throw new Error('API endpoint not configured');
      }

      this.stopAutoSync(); // Stop existing timer
      this.config.autoSyncEnabled = true;
      await this.saveConfiguration();

      // Start sync timer
      this.syncTimer = setInterval(() => {
        if (!this.syncInProgress && AppState.currentState === 'active') {
          this.performSync('automatic').catch(error => {
            this.log('Auto sync failed', error);
          });
        }
      }, this.config.syncInterval);

      // Perform initial sync
      await this.performSync('initial');

      this.log(
        `Auto sync started with interval: ${this.config.syncInterval}ms`,
      );
    } catch (error) {
      this.log('Failed to start auto sync', error);
      throw error;
    }
  }

  /**
   * Stop automatic synchronization
   */
  public stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.config.autoSyncEnabled = false;
    this.saveConfiguration().catch(error => {
      this.log('Failed to save configuration after stopping sync', error);
    });
    this.log('Auto sync stopped');
  }

  /**
   * Perform manual synchronization
   */
  public async performManualSync(): Promise<SyncResult> {
    return this.performSync('manual');
  }

  /**
   * Core synchronization logic with retry mechanism
   */
  private async performSync(
    source: 'initial' | 'manual' | 'automatic',
  ): Promise<SyncResult> {
    // Return existing promise if sync is already in progress
    if (this.currentSyncPromise) {
      this.log('Sync already in progress, returning existing promise');
      return this.currentSyncPromise;
    }

    this.syncInProgress = true;
    const startTime = Date.now();

    this.currentSyncPromise = this.executeSyncWithRetry(source, startTime);

    try {
      const result = await this.currentSyncPromise;
      return result;
    } finally {
      this.currentSyncPromise = null;
      this.syncInProgress = false;
    }
  }

  /**
   * Execute sync with retry mechanism
   */
  private async executeSyncWithRetry(
    source: string,
    startTime: number,
  ): Promise<SyncResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.log(
          `Sync attempt ${attempt}/${this.config.maxRetries} (${source})`,
        );

        const result = await this.executeSingleSync(startTime, attempt);

        if (result.success) {
          await this.updateStats(result, true);
          await this.saveSyncHistory(result);

          // Check for changes and create notifications
          if (
            result.addedUrls.length > 0 ||
            result.modifiedUrls.length > 0 ||
            result.removedUrls.length > 0
          ) {
            await this.createChangeNotifications(result);
          }

          this.log('Sync completed successfully', {
            newCount: result.newCount,
            previousCount: result.previousCount,
            duration: result.syncDuration,
          });

          return result;
        }
      } catch (error: any) {
        lastError = error;
        this.log(`Sync attempt ${attempt} failed`, error);

        // Wait before retry (exponential backoff)
        if (attempt < this.config.maxRetries) {
          const delay = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
          await this.delay(delay);
        }
      }
    }

    // All retries failed
    const failedResult: SyncResult = {
      success: false,
      timestamp: new Date().toISOString(),
      previousCount: 0,
      newCount: 0,
      addedUrls: [],
      removedUrls: [],
      modifiedUrls: [],
      dataChecksum: '',
      syncDuration: Date.now() - startTime,
      error: lastError?.message || 'All retry attempts failed',
      retryAttempt: this.config.maxRetries,
    };

    await this.updateStats(failedResult, false);
    await this.createErrorNotification(failedResult);

    return failedResult;
  }

  /**
   * Execute a single sync operation
   */
  private async executeSingleSync(
    startTime: number,
    attempt: number,
  ): Promise<SyncResult> {
    // Load previous data for comparison
    const previousDataStr = await AsyncStorage.getItem(
      STORAGE_KEYS.LAST_SYNC_DATA,
    );
    const previousData: APIURLItem[] = previousDataStr
      ? JSON.parse(previousDataStr).data || []
      : [];
    const previousChecksum =
      (await AsyncStorage.getItem(STORAGE_KEYS.DATA_CHECKSUM)) || '';

    // Fetch new data from API
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      const response = await fetch(this.config.apiEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `NetGuard-ApiSync/2.0 (${Platform.OS})`,
          'Cache-Control': 'no-cache',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `HTTP error! status: ${response.status} - ${response.statusText}`,
        );
      }

      const apiResponse: APIResponse = await response.json();

      // Handle different API response formats
      let newData: APIURLItem[] = [];

      if (Array.isArray(apiResponse)) {
        // Direct array response (like jsonplaceholder)
        newData = apiResponse as APIURLItem[];
      } else if (apiResponse && Array.isArray(apiResponse.data)) {
        // Wrapped response with data property
        newData = apiResponse.data;
      } else if (
        apiResponse &&
        apiResponse.status === 'success' &&
        Array.isArray(apiResponse.data)
      ) {
        // Standard format with success status
        newData = apiResponse.data;
      } else {
        throw new Error(
          'Invalid API response format: expected array or object with data array',
        );
      }
      const newChecksum = this.calculateDataChecksum(newData);
      const syncDuration = Date.now() - startTime;

      // Data integrity check
      const integrityCheck = this.validateDataIntegrity(newData);
      if (!integrityCheck.valid) {
        throw new Error(`Data integrity check failed: ${integrityCheck.error}`);
      }

      // Compare with previous data
      const changes = this.compareData(previousData, newData);

      // Save new data
      const syncData = {
        data: newData,
        timestamp: new Date().toISOString(),
        source: 'api_sync',
        checksum: newChecksum,
        metadata: {
          syncDuration,
          attempt,
          totalItems: newData.length,
          dataIntegrityPassed: true,
        },
      };

      await AsyncStorage.setItem(
        STORAGE_KEYS.LAST_SYNC_DATA,
        JSON.stringify(syncData),
      );
      await AsyncStorage.setItem(STORAGE_KEYS.DATA_CHECKSUM, newChecksum);

      // Update stats
      await this.incrementStat('dataIntegrityChecks');

      return {
        success: true,
        timestamp: new Date().toISOString(),
        newData,
        previousCount: previousData.length,
        newCount: newData.length,
        addedUrls: changes.added,
        removedUrls: changes.removed,
        modifiedUrls: changes.modified,
        dataChecksum: newChecksum,
        syncDuration,
        retryAttempt: attempt,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Calculate data checksum for integrity verification
   */
  private calculateDataChecksum(data: APIURLItem[]): string {
    // Sort data by composite key for URL monitoring consistency
    const sortedData = [...data].sort((a, b) => {
      const getKey = (item: APIURLItem) => {
        const parts = [];
        if (item.id) parts.push(item.id);
        if (item.url) parts.push(item.url);
        if (item.callback_name) parts.push(item.callback_name);
        if (item.title) parts.push(item.title);
        return parts.length > 0 ? parts.join('|') : JSON.stringify(item);
      };

      return getKey(a).localeCompare(getKey(b));
    });

    // Create normalized data for checksum (exclude volatile fields)
    const normalizedData = sortedData.map(item => {
      const normalized: any = {};
      for (const [key, value] of Object.entries(item)) {
        if (!['created_at', 'updated_at'].includes(key)) {
          normalized[key] = value;
        }
      }
      return normalized;
    });

    const dataString = JSON.stringify(normalizedData);

    // Simple checksum calculation (you can use crypto for better security)
    let hash = 0;
    for (let i = 0; i < dataString.length; i++) {
      const char = dataString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(16);
  }

  /**
   * Validate data integrity
   */
  private validateDataIntegrity(data: APIURLItem[]): {
    valid: boolean;
    error?: string;
  } {
    try {
      // Check if data is array
      if (!Array.isArray(data)) {
        return { valid: false, error: 'Data is not an array' };
      }

      // Check each item structure
      for (const item of data) {
        if (!item || typeof item !== 'object') {
          return { valid: false, error: 'Invalid item structure' };
        }

        // Flexible field validation based on data type
        if (item.url) {
          // URL validation if url field exists
          try {
            new URL(item.url);
          } catch {
            return {
              valid: false,
              error: `Invalid URL format in item ${item.id || 'unknown'}`,
            };
          }
        }

        if (item.callback_url) {
          // Callback URL validation if callback_url field exists
          try {
            new URL(item.callback_url);
          } catch {
            return {
              valid: false,
              error: `Invalid callback URL format in item ${
                item.id || 'unknown'
              }`,
            };
          }
        }

        // Ensure at least some identifier exists
        if (!item.id && !item.title && !item.url) {
          return {
            valid: false,
            error: 'Item must have at least one identifier (id, title, or url)',
          };
        }
      }

      // Check for duplicates - flexible for URL monitoring scenarios
      if (this.config.strictValidation) {
        const identifiers = data.map((item, index) => {
          // Create composite key for URL monitoring scenario
          const parts = [];

          if (item.id) parts.push(`id:${item.id}`);
          if (item.url) parts.push(`url:${item.url}`);
          if (item.callback_name) parts.push(`callback:${item.callback_name}`);
          if (item.title) parts.push(`title:${item.title}`);

          // If no identifiable fields, use index + content hash
          if (parts.length === 0) {
            const contentHash = JSON.stringify(item).slice(0, 50);
            parts.push(`index:${index}`, `hash:${contentHash}`);
          }

          return parts.join('|');
        });

        const uniqueIdentifiers = new Set(identifiers);
        if (identifiers.length !== uniqueIdentifiers.size) {
          const duplicates = identifiers.filter(
            (id, index) => identifiers.indexOf(id) !== index,
          );
          return {
            valid: false,
            error: `Duplicate items found: ${duplicates
              .slice(0, 3)
              .join(', ')}`,
          };
        }
      } else {
        // For URL monitoring, allow "duplicates" as they might be same URL with different callbacks
        this.log(
          'Flexible validation mode: Allowing potential duplicates for URL monitoring',
        );
      }

      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Compare two datasets and return differences
   */
  private compareData(
    oldData: APIURLItem[],
    newData: APIURLItem[],
  ): {
    added: APIURLItem[];
    removed: APIURLItem[];
    modified: APIURLItem[];
  } {
    // Create maps using composite identifiers for URL monitoring
    const getItemKey = (item: APIURLItem): string => {
      // For URL monitoring, use combination of id, url, and callback_name
      const parts = [];

      if (item.id) parts.push(`id:${item.id}`);
      if (item.url) parts.push(`url:${item.url}`);
      if (item.callback_name) parts.push(`callback:${item.callback_name}`);

      // If no standard identifiers, use content-based key
      if (parts.length === 0) {
        if (item.title) parts.push(`title:${item.title}`);
        else parts.push(`content:${JSON.stringify(item).slice(0, 100)}`);
      }

      return parts.join('|');
    };

    const oldMap = new Map(oldData.map(item => [getItemKey(item), item]));
    const newMap = new Map(newData.map(item => [getItemKey(item), item]));

    const added: APIURLItem[] = [];
    const removed: APIURLItem[] = [];
    const modified: APIURLItem[] = [];

    // Find added and modified items
    for (const [key, newItem] of newMap) {
      const oldItem = oldMap.get(key);
      if (!oldItem) {
        added.push(newItem);
      } else if (this.hasItemChanged(oldItem, newItem)) {
        modified.push(newItem);
      }
    }

    // Find removed items
    for (const [key, oldItem] of oldMap) {
      if (!newMap.has(key)) {
        removed.push(oldItem);
      }
    }

    return { added, removed, modified };
  }

  /**
   * Check if an item has changed
   */
  private hasItemChanged(oldItem: APIURLItem, newItem: APIURLItem): boolean {
    // Compare all available fields dynamically
    const allFields = new Set([
      ...Object.keys(oldItem),
      ...Object.keys(newItem),
    ]);

    for (const field of allFields) {
      // Skip comparison for volatile fields
      if (['created_at', 'updated_at'].includes(field)) continue;

      if (oldItem[field] !== newItem[field]) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create notifications for data changes
   */
  private async createChangeNotifications(result: SyncResult): Promise<void> {
    const notifications: SyncNotification[] = [];

    if (result.addedUrls.length > 0) {
      notifications.push({
        id: `new_urls_${Date.now()}`,
        type: 'new_urls',
        title: '🆕 New URLs Found',
        message: `Found ${result.addedUrls.length} new URLs from API`,
        timestamp: new Date().toISOString(),
        data: result.addedUrls,
        acknowledged: false,
      });
    }

    if (result.modifiedUrls.length > 0) {
      notifications.push({
        id: `modified_urls_${Date.now()}`,
        type: 'modified_urls',
        title: '📝 URLs Modified',
        message: `${result.modifiedUrls.length} URLs have been updated`,
        timestamp: new Date().toISOString(),
        data: result.modifiedUrls,
        acknowledged: false,
      });
    }

    if (result.removedUrls.length > 0) {
      notifications.push({
        id: `removed_urls_${Date.now()}`,
        type: 'removed_urls',
        title: '🗑️ URLs Removed',
        message: `${result.removedUrls.length} URLs have been removed from API`,
        timestamp: new Date().toISOString(),
        data: result.removedUrls,
        acknowledged: false,
      });
    }

    if (notifications.length > 0) {
      this.pendingNotifications.push(...notifications);
      await this.savePendingNotifications();
      this.log('Created change notifications', { count: notifications.length });
    }
  }

  /**
   * Create error notification
   */
  private async createErrorNotification(result: SyncResult): Promise<void> {
    const notification: SyncNotification = {
      id: `sync_error_${Date.now()}`,
      type: 'sync_error',
      title: '❌ Sync Failed',
      message: result.error || 'Unknown sync error occurred',
      timestamp: new Date().toISOString(),
      data: { retryAttempt: result.retryAttempt },
      acknowledged: false,
    };

    this.pendingNotifications.push(notification);
    await this.savePendingNotifications();
    this.log('Created error notification', result.error);
  }

  /**
   * Get pending notifications
   */
  public async getPendingNotifications(): Promise<SyncNotification[]> {
    return [...this.pendingNotifications];
  }

  /**
   * Acknowledge notification
   */
  public async acknowledgeNotification(notificationId: string): Promise<void> {
    const notification = this.pendingNotifications.find(
      n => n.id === notificationId,
    );
    if (notification) {
      notification.acknowledged = true;
      await this.savePendingNotifications();
      this.log('Notification acknowledged', notificationId);
    }
  }

  /**
   * Clear all acknowledged notifications
   */
  public async clearAcknowledgedNotifications(): Promise<void> {
    this.pendingNotifications = this.pendingNotifications.filter(
      n => !n.acknowledged,
    );
    await this.savePendingNotifications();
    this.log('Acknowledged notifications cleared');
  }

  /**
   * Get latest synced data
   */
  public async getLatestSyncedData(): Promise<{
    data: APIURLItem[];
    timestamp: string;
    checksum: string;
  } | null> {
    try {
      const syncDataStr = await AsyncStorage.getItem(
        STORAGE_KEYS.LAST_SYNC_DATA,
      );
      if (!syncDataStr) return null;

      const syncData = JSON.parse(syncDataStr);
      return {
        data: syncData.data || [],
        timestamp: syncData.timestamp,
        checksum: syncData.checksum || '',
      };
    } catch (error) {
      this.log('Failed to get latest synced data', error);
      return null;
    }
  }

  /**
   * Get sync statistics
   */
  public getStats(): SyncStats {
    return { ...this.stats };
  }

  /**
   * Get sync history
   */
  public async getSyncHistory(): Promise<SyncResult[]> {
    try {
      const historyStr = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_HISTORY);
      return historyStr ? JSON.parse(historyStr) : [];
    } catch (error) {
      this.log('Failed to get sync history', error);
      return [];
    }
  }

  /**
   * Check if auto sync is enabled
   */
  public isAutoSyncEnabled(): boolean {
    return this.config.autoSyncEnabled;
  }

  /**
   * Get current configuration
   */
  public getConfiguration(): SyncConfig {
    return { ...this.config };
  }

  /**
   * Update statistics
   */
  private async updateStats(
    result: SyncResult,
    success: boolean,
  ): Promise<void> {
    this.stats.totalSyncs++;
    this.stats.lastSyncTime = result.timestamp;

    if (success) {
      this.stats.successfulSyncs++;
      this.stats.lastSuccessTime = result.timestamp;
      this.stats.consecutiveFailures = 0;
      this.stats.totalUrlsFound = result.newCount;
      this.stats.totalNewUrls += result.addedUrls.length;

      // Update average sync duration
      this.stats.averageSyncDuration = Math.round(
        (this.stats.averageSyncDuration * (this.stats.successfulSyncs - 1) +
          result.syncDuration) /
          this.stats.successfulSyncs,
      );
    } else {
      this.stats.failedSyncs++;
      this.stats.consecutiveFailures++;
    }

    await this.saveStats();
  }

  /**
   * Increment specific stat
   */
  private async incrementStat(statName: keyof SyncStats): Promise<void> {
    if (typeof this.stats[statName] === 'number') {
      (this.stats[statName] as number)++;
      await this.saveStats();
    }
  }

  /**
   * Save sync history
   */
  private async saveSyncHistory(result: SyncResult): Promise<void> {
    try {
      const history = await this.getSyncHistory();
      history.unshift(result);

      // Keep only recent history
      const trimmedHistory = history.slice(0, MAX_STORED_SYNC_HISTORY);

      await AsyncStorage.setItem(
        STORAGE_KEYS.SYNC_HISTORY,
        JSON.stringify(trimmedHistory),
      );
    } catch (error) {
      this.log('Failed to save sync history', error);
    }
  }

  /**
   * Setup app state listener
   */
  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      nextAppState => {
        this.log('App state changed to:', nextAppState);
        this.lastActivity = new Date();

        if (
          nextAppState === 'active' &&
          this.config.autoSyncEnabled &&
          !this.syncInProgress
        ) {
          // Perform sync when app becomes active
          setTimeout(() => {
            this.performSync('app_active').catch(error => {
              this.log('App active sync failed', error);
            });
          }, 2000); // Wait 2 seconds for app to stabilize
        }
      },
    );
  }

  /**
   * Cleanup and destroy the manager
   */
  public async destroy(): Promise<void> {
    this.isDestroyed = true;
    this.stopAutoSync();

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // Wait for current sync to complete
    if (this.currentSyncPromise) {
      try {
        await this.currentSyncPromise;
      } catch (error) {
        this.log('Error waiting for sync completion during destroy', error);
      }
    }

    this.log('ApiSyncManager destroyed');
  }

  /**
   * Storage operations
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const [endpoint, interval, autoSync, strictValidation] =
        await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.API_ENDPOINT),
          AsyncStorage.getItem(STORAGE_KEYS.SYNC_INTERVAL),
          AsyncStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED),
          AsyncStorage.getItem('STRICT_VALIDATION'),
        ]);

      if (endpoint) this.config.apiEndpoint = endpoint;
      if (interval) this.config.syncInterval = parseInt(interval, 10);
      if (autoSync) this.config.autoSyncEnabled = JSON.parse(autoSync);
      if (strictValidation)
        this.config.strictValidation = JSON.parse(strictValidation);
    } catch (error) {
      this.log('Failed to load configuration', error);
    }
  }

  private async saveConfiguration(): Promise<void> {
    try {
      await Promise.all([
        AsyncStorage.setItem(
          STORAGE_KEYS.API_ENDPOINT,
          this.config.apiEndpoint,
        ),
        AsyncStorage.setItem(
          STORAGE_KEYS.SYNC_INTERVAL,
          this.config.syncInterval.toString(),
        ),
        AsyncStorage.setItem(
          STORAGE_KEYS.AUTO_SYNC_ENABLED,
          JSON.stringify(this.config.autoSyncEnabled),
        ),
        AsyncStorage.setItem(
          'STRICT_VALIDATION',
          JSON.stringify(this.config.strictValidation || false),
        ),
      ]);
    } catch (error) {
      this.log('Failed to save configuration', error);
    }
  }

  private async loadStats(): Promise<void> {
    try {
      const statsStr = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_STATS);
      if (statsStr) {
        this.stats = { ...this.stats, ...JSON.parse(statsStr) };
      }
    } catch (error) {
      this.log('Failed to load stats', error);
    }
  }

  private async saveStats(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.SYNC_STATS,
        JSON.stringify(this.stats),
      );
    } catch (error) {
      this.log('Failed to save stats', error);
    }
  }

  private async loadPendingNotifications(): Promise<void> {
    try {
      const notificationsStr = await AsyncStorage.getItem(
        STORAGE_KEYS.PENDING_NOTIFICATIONS,
      );
      if (notificationsStr) {
        this.pendingNotifications = JSON.parse(notificationsStr);
      }
    } catch (error) {
      this.log('Failed to load pending notifications', error);
    }
  }

  private async savePendingNotifications(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.PENDING_NOTIFICATIONS,
        JSON.stringify(this.pendingNotifications),
      );
    } catch (error) {
      this.log('Failed to save pending notifications', error);
    }
  }

  /**
   * Utility functions
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private log(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    console.log(`[ApiSyncManager ${timestamp}] ${message}`, data || '');
  }
}

export default ApiSyncManager;

// Export singleton instance
export const apiSyncManager = ApiSyncManager.getInstance();
