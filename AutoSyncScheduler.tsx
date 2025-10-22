/**
 * Auto-Sync Scheduler Service
 * Handles automatic API synchronization and URL monitoring without requiring app to be active
 * Features:
 * - Independent background scheduling
 * - Auto URL discovery and updates
 * - Configuration persistence
 * - Service health monitoring
 * - Cross-platform compatibility
 */

import {
  Platform,
  AppRegistry,
  DeviceEventEmitter,
  NativeModules,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundJob from 'react-native-background-actions';
import { apiSyncManager } from './ApiSyncManager';
import type { APIURLItem, SyncResult } from './ApiSyncManager';

// Constants
const AUTO_SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes
const URL_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes for URL changes
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes for service health
const MAX_CONSECUTIVE_FAILURES = 3;
const SERVICE_NOTIFICATION_ID = 'auto-sync-service';

// Storage keys
const STORAGE_KEYS = {
  SCHEDULER_CONFIG: '@AutoSync:config',
  SCHEDULER_STATE: '@AutoSync:state',
  LAST_URL_COUNT: '@AutoSync:lastUrlCount',
  SERVICE_STATS: '@AutoSync:stats',
  HEALTH_STATUS: '@AutoSync:health',
};

// Interfaces
interface SchedulerConfig {
  enabled: boolean;
  apiEndpoint: string;
  selectedCallbackName: string;
  syncInterval: number;
  urlCheckInterval: number;
  autoUpdateUrls: boolean;
  callbackConfig: {
    name: string;
    url: string;
  };
}

interface SchedulerState {
  isRunning: boolean;
  lastSyncTime: string | null;
  lastUrlCheck: string | null;
  consecutiveFailures: number;
  currentUrlCount: number;
  serviceStartTime: string | null;
}

interface SchedulerStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  urlUpdates: number;
  newUrlsDiscovered: number;
  serviceRestarts: number;
  uptime: number;
  lastHealthCheck: string | null;
}

interface AutoSyncNotification {
  id: string;
  type: 'new_urls' | 'sync_success' | 'sync_failed' | 'service_restarted';
  title: string;
  message: string;
  timestamp: string;
  data?: any;
}

class AutoSyncScheduler {
  private static instance: AutoSyncScheduler;
  private config: SchedulerConfig;
  private state: SchedulerState;
  private stats: SchedulerStats;
  private isDestroyed: boolean = false;
  private backgroundTaskId: string | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private notifications: AutoSyncNotification[] = [];

  private constructor() {
    this.config = {
      enabled: false,
      apiEndpoint: '',
      selectedCallbackName: '',
      syncInterval: AUTO_SYNC_INTERVAL,
      urlCheckInterval: URL_CHECK_INTERVAL,
      autoUpdateUrls: true,
      callbackConfig: {
        name: '',
        url: '',
      },
    };

    this.state = {
      isRunning: false,
      lastSyncTime: null,
      lastUrlCheck: null,
      consecutiveFailures: 0,
      currentUrlCount: 0,
      serviceStartTime: null,
    };

    this.stats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      urlUpdates: 0,
      newUrlsDiscovered: 0,
      serviceRestarts: 0,
      uptime: 0,
      lastHealthCheck: null,
    };

    this.initialize();
  }

  public static getInstance(): AutoSyncScheduler {
    if (!AutoSyncScheduler.instance) {
      AutoSyncScheduler.instance = new AutoSyncScheduler();
    }
    return AutoSyncScheduler.instance;
  }

  /**
   * Initialize the scheduler
   */
  private async initialize(): Promise<void> {
    try {
      await this.loadConfiguration();
      await this.loadState();
      await this.loadStats();

      if (this.config.enabled && this.state.isRunning) {
        // Auto-start if it was running before
        await this.startScheduler();
      }

      this.log('AutoSyncScheduler initialized');
    } catch (error) {
      this.log('Error initializing scheduler', error);
    }
  }

  /**
   * Configure the scheduler
   */
  public async configure(newConfig: Partial<SchedulerConfig>): Promise<void> {
    try {
      this.config = { ...this.config, ...newConfig };
      await this.saveConfiguration();

      // Configure ApiSyncManager
      if (this.config.apiEndpoint) {
        await apiSyncManager.configure({
          apiEndpoint: this.config.apiEndpoint,
          autoSyncEnabled: this.config.enabled,
          syncInterval: this.config.syncInterval,
          strictValidation: false,
        });
      }

      this.log('Scheduler configured', newConfig);
    } catch (error) {
      this.log('Error configuring scheduler', error);
      throw error;
    }
  }

  /**
   * Start the auto-sync scheduler
   */
  public async startScheduler(): Promise<boolean> {
    try {
      if (this.isDestroyed || this.state.isRunning) {
        return false;
      }

      if (!this.config.apiEndpoint) {
        throw new Error('API endpoint not configured');
      }

      // Start background task
      const backgroundOptions = {
        taskName: 'AutoSyncScheduler',
        taskTitle: '🔄 Auto-Sync Active',
        taskDesc: `Monitoring ${this.state.currentUrlCount} URLs automatically`,
        taskIcon: {
          name: 'ic_launcher',
          type: 'mipmap',
        },
        color: '#4CAF50',
        linkingURI: 'netguard://autosync',
        parameters: {
          config: this.config,
          startTime: Date.now(),
        },
      };

      await BackgroundJob.start(
        this.backgroundTaskFunction.bind(this),
        backgroundOptions
      );

      // Update state
      this.state.isRunning = true;
      this.state.serviceStartTime = new Date().toISOString();
      this.state.consecutiveFailures = 0;
      await this.saveState();

      // Start health monitoring
      this.startHealthMonitoring();

      // Start ApiSyncManager auto sync
      if (this.config.enabled) {
        await apiSyncManager.startAutoSync();
      }

      this.log('Auto-sync scheduler started');

      // Add notification
      await this.addNotification({
        type: 'service_restarted',
        title: '✅ Auto-Sync Started',
        message: 'Background URL monitoring is now active',
        data: { urlCount: this.state.currentUrlCount },
      });

      return true;
    } catch (error) {
      this.log('Failed to start scheduler', error);
      this.state.isRunning = false;
      await this.saveState();
      return false;
    }
  }

  /**
   * Stop the auto-sync scheduler
   */
  public async stopScheduler(): Promise<void> {
    try {
      this.log('Stopping auto-sync scheduler');

      // Stop background task
      await BackgroundJob.stop();

      // Stop health monitoring
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }

      // Stop ApiSyncManager
      apiSyncManager.stopAutoSync();

      // Update state
      this.state.isRunning = false;
      this.state.serviceStartTime = null;
      await this.saveState();

      this.log('Auto-sync scheduler stopped');
    } catch (error) {
      this.log('Error stopping scheduler', error);
    }
  }

  /**
   * Main background task function
   */
  private async backgroundTaskFunction(taskData: any): Promise<void> {
    const config = taskData.parameters?.config as SchedulerConfig;
    if (!config) {
      this.log('Background task: No config provided');
      return;
    }

    this.log('Background task started');

    let lastSync = 0;
    let lastUrlCheck = 0;
    let consecutiveFailures = 0;

    while (BackgroundJob.isRunning() && !this.isDestroyed) {
      try {
        const now = Date.now();

        // Check for URL changes more frequently
        if (now - lastUrlCheck > this.config.urlCheckInterval) {
          const urlsChanged = await this.checkForUrlChanges();
          if (urlsChanged) {
            this.log('URL changes detected, triggering sync');
            lastSync = 0; // Force immediate sync
          }
          lastUrlCheck = now;
        }

        // Perform API sync
        if (now - lastSync > this.config.syncInterval) {
          const syncResult = await this.performBackgroundSync();

          if (syncResult.success) {
            consecutiveFailures = 0;
            this.stats.successfulSyncs++;
            await this.handleSuccessfulSync(syncResult);
          } else {
            consecutiveFailures++;
            this.stats.failedSyncs++;
            await this.handleFailedSync(syncResult, consecutiveFailures);
          }

          this.stats.totalSyncs++;
          await this.saveStats();
          lastSync = now;
        }

        // Update stats
        this.stats.uptime = this.state.serviceStartTime
          ? Math.floor((now - new Date(this.state.serviceStartTime).getTime()) / 1000)
          : 0;

        // Wait before next iteration
        await this.sleep(30000); // Check every 30 seconds

      } catch (error) {
        this.log('Background task error', error);
        consecutiveFailures++;

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.log('Too many consecutive failures, restarting service');
          await this.restartService();
          consecutiveFailures = 0;
        }

        await this.sleep(60000); // Wait 1 minute on error
      }
    }

    this.log('Background task stopped');
  }

  /**
   * Check for URL changes from API
   */
  private async checkForUrlChanges(): Promise<boolean> {
    try {
      if (!this.config.apiEndpoint || !this.config.autoUpdateUrls) {
        return false;
      }

      // Quick check for data changes
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(this.config.apiEndpoint, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'If-Modified-Since': this.state.lastUrlCheck || '',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 304) {
          // Not modified
          return false;
        }

        if (response.ok) {
          const data = await response.json();
          let newCount = 0;

          if (Array.isArray(data)) {
            newCount = data.length;
          } else if (data.data && Array.isArray(data.data)) {
            newCount = data.data.length;
          }

          const hasChanged = newCount !== this.state.currentUrlCount;

          if (hasChanged) {
            this.state.currentUrlCount = newCount;
            this.state.lastUrlCheck = new Date().toISOString();
            await this.saveState();

            this.log(`URL count changed: ${this.state.currentUrlCount} -> ${newCount}`);
            return true;
          }
        }

        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      this.log('Error checking URL changes', error);
      return false;
    }
  }

  /**
   * Perform background sync
   */
  private async performBackgroundSync(): Promise<SyncResult> {
    try {
      this.log('Performing background sync');

      const result = await apiSyncManager.performManualSync();

      this.state.lastSyncTime = result.timestamp;
      await this.saveState();

      return result;
    } catch (error: any) {
      this.log('Background sync failed', error);

      return {
        success: false,
        timestamp: new Date().toISOString(),
        previousCount: 0,
        newCount: 0,
        addedUrls: [],
        removedUrls: [],
        modifiedUrls: [],
        dataChecksum: '',
        syncDuration: 0,
        error: error.message || 'Unknown error',
        retryAttempt: 0,
      };
    }
  }

  /**
   * Handle successful sync
   */
  private async handleSuccessfulSync(result: SyncResult): Promise<void> {
    this.state.consecutiveFailures = 0;

    if (result.addedUrls && result.addedUrls.length > 0) {
      this.stats.newUrlsDiscovered += result.addedUrls.length;
      this.stats.urlUpdates++;

      await this.addNotification({
        type: 'new_urls',
        title: '🆕 New URLs Discovered',
        message: `Found ${result.addedUrls.length} new URLs automatically`,
        data: { newUrls: result.addedUrls },
      });

      // Update local URL storage if needed
      await this.updateLocalUrlStorage(result);
    }

    await this.saveState();
  }

  /**
   * Handle failed sync
   */
  private async handleFailedSync(result: SyncResult, consecutiveFailures: number): Promise<void> {
    this.state.consecutiveFailures = consecutiveFailures;

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await this.addNotification({
        type: 'sync_failed',
        title: '❌ Auto-Sync Failed',
        message: `${consecutiveFailures} consecutive failures. Service will restart.`,
        data: { error: result.error, consecutiveFailures },
      });
    }

    await this.saveState();
  }

  /**
   * Update local URL storage with new data
   */
  private async updateLocalUrlStorage(result: SyncResult): Promise<void> {
    try {
      if (!result.newData) return;

      // Filter URLs for selected callback name
      const filteredUrls = this.config.selectedCallbackName
        ? result.newData.filter(item => item.callback_name === this.config.selectedCallbackName)
        : result.newData;

      // Convert to app format
      const urls = filteredUrls.map((item, index) => ({
        id: `auto_${item.id || Date.now()}_${index}`,
        url: item.url,
        status: 'checking' as const,
        checkHistory: [],
      }));

      // Update stored URLs
      await AsyncStorage.setItem('@Enhanced:urls', JSON.stringify(urls));

      // Update callback config if needed
      if (filteredUrls.length > 0 && filteredUrls[0].callback_url) {
        const callbackConfig = {
          name: this.config.selectedCallbackName || filteredUrls[0].callback_name,
          url: filteredUrls[0].callback_url,
        };
        await AsyncStorage.setItem('@Enhanced:callback', JSON.stringify(callbackConfig));
      }

      this.log(`Updated local storage with ${urls.length} URLs`);
    } catch (error) {
      this.log('Error updating local URL storage', error);
    }
  }

  /**
   * Restart service
   */
  private async restartService(): Promise<void> {
    try {
      this.log('Restarting auto-sync service');

      await this.stopScheduler();
      await this.sleep(5000); // Wait 5 seconds
      await this.startScheduler();

      this.stats.serviceRestarts++;
      await this.saveStats();

      await this.addNotification({
        type: 'service_restarted',
        title: '🔄 Service Restarted',
        message: 'Auto-sync service was automatically restarted',
        data: { restartCount: this.stats.serviceRestarts },
      });

    } catch (error) {
      this.log('Error restarting service', error);
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        const isHealthy = await this.performHealthCheck();

        if (!isHealthy) {
          this.log('Health check failed, attempting restart');
          await this.restartService();
        }

        this.stats.lastHealthCheck = new Date().toISOString();
        await this.saveStats();

      } catch (error) {
        this.log('Health check error', error);
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(): Promise<boolean> {
    try {
      // Check if background job is still running
      const isBackgroundRunning = BackgroundJob.isRunning();

      if (!isBackgroundRunning && this.state.isRunning) {
        this.log('Health check: Background job stopped unexpectedly');
        return false;
      }

      // Check if last sync was too long ago
      if (this.state.lastSyncTime) {
        const lastSyncMs = new Date(this.state.lastSyncTime).getTime();
        const timeSinceLastSync = Date.now() - lastSyncMs;
        const maxAllowedDelay = this.config.syncInterval * 2; // Allow 2x the interval

        if (timeSinceLastSync > maxAllowedDelay) {
          this.log('Health check: Last sync too long ago');
          return false;
        }
      }

      // Check consecutive failures
      if (this.state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.log('Health check: Too many consecutive failures');
        return false;
      }

      return true;
    } catch (error) {
      this.log('Health check error', error);
      return false;
    }
  }

  /**
   * Add notification
   */
  private async addNotification(notification: Omit<AutoSyncNotification, 'id' | 'timestamp'>): Promise<void> {
    const fullNotification: AutoSyncNotification = {
      ...notification,
      id: `autosync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    this.notifications.unshift(fullNotification);

    // Keep only last 20 notifications
    if (this.notifications.length > 20) {
      this.notifications = this.notifications.slice(0, 20);
    }

    await this.saveNotifications();
    this.log('Notification added', notification.title);
  }

  /**
   * Get notifications
   */
  public getNotifications(): AutoSyncNotification[] {
    return [...this.notifications];
  }

  /**
   * Clear notifications
   */
  public async clearNotifications(): Promise<void> {
    this.notifications = [];
    await this.saveNotifications();
  }

  /**
   * Get current status
   */
  public getStatus() {
    return {
      config: { ...this.config },
      state: { ...this.state },
      stats: { ...this.stats },
      notifications: this.notifications.length,
      isHealthy: this.state.consecutiveFailures < MAX_CONSECUTIVE_FAILURES,
    };
  }

  /**
   * Check if scheduler is running
   */
  public isRunning(): boolean {
    return this.state.isRunning && BackgroundJob.isRunning();
  }

  /**
   * Destroy the scheduler
   */
  public async destroy(): Promise<void> {
    this.isDestroyed = true;
    await this.stopScheduler();
    this.log('AutoSyncScheduler destroyed');
  }

  /**
   * Storage operations
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const configStr = await AsyncStorage.getItem(STORAGE_KEYS.SCHEDULER_CONFIG);
      if (configStr) {
        this.config = { ...this.config, ...JSON.parse(configStr) };
      }
    } catch (error) {
      this.log('Error loading configuration', error);
    }
  }

  private async saveConfiguration(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SCHEDULER_CONFIG, JSON.stringify(this.config));
    } catch (error) {
      this.log('Error saving configuration', error);
    }
  }

  private async loadState(): Promise<void> {
    try {
      const stateStr = await AsyncStorage.getItem(STORAGE_KEYS.SCHEDULER_STATE);
      if (stateStr) {
        this.state = { ...this.state, ...JSON.parse(stateStr) };
      }
    } catch (error) {
      this.log('Error loading state', error);
    }
  }

  private async saveState(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SCHEDULER_STATE, JSON.stringify(this.state));
    } catch (error) {
      this.log('Error saving state', error);
    }
  }

  private async loadStats(): Promise<void> {
    try {
      const statsStr = await AsyncStorage.getItem(STORAGE_KEYS.SERVICE_STATS);
      if (statsStr) {
        this.stats = { ...this.stats, ...JSON.parse(statsStr) };
      }
    } catch (error) {
      this.log('Error loading stats', error);
    }
  }

  private async saveStats(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SERVICE_STATS, JSON.stringify(this.stats));
    } catch (error) {
      this.log('Error saving stats', error);
    }
  }

  private async saveNotifications(): Promise<void> {
    try {
      await AsyncStorage.setItem('AUTOSYNC_NOTIFICATIONS', JSON.stringify(this.notifications));
    } catch (error) {
      this.log('Error saving notifications', error);
    }
  }

  private async loadNotifications(): Promise<void> {
    try {
      const notificationsStr = await AsyncStorage.getItem('AUTOSYNC_NOTIFICATIONS');
      if (notificationsStr) {
        this.notifications = JSON.parse(notificationsStr);
      }
    } catch (error) {
      this.log('Error loading notifications', error);
    }
  }

  /**
   * Utility functions
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private log(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    console.log(`[AutoSyncScheduler ${timestamp}] ${message}`, data || '');
  }
}

// Export singleton instance
export const autoSyncScheduler = AutoSyncScheduler.getInstance();
export default AutoSyncScheduler;

// Register HeadlessJS task for the scheduler
if (Platform.OS === 'android') {
  const AutoSyncHeadlessTask = async (taskData: any) => {
    console.log('[AutoSync HeadlessTask] Starting');

    try {
      const scheduler = AutoSyncScheduler.getInstance();

      // Perform sync operation
      const status = scheduler.getStatus();

      if (status.config.enabled && status.config.apiEndpoint) {
        // This will be handled by the main background task
        console.log('[AutoSync HeadlessTask] Service is running');
      }

      return { success: true, timestamp: new Date().toISOString() };
    } catch (error: any) {
      console.error('[AutoSync HeadlessTask] Error:', error);
      return { success: false, error: error.message };
    }
  };

  AppRegistry.registerHeadlessTask('AutoSyncHeadlessTask', () => AutoSyncHeadlessTask);
}
