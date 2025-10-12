/**
 * Background Service Manager
 * Handles background service operations with fallback support
 */

import { Platform, AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Try to import background service library
let BackgroundActions: any = null;
let isBackgroundServiceAvailable = false;

try {
  BackgroundActions = require('react-native-background-actions').default;
  isBackgroundServiceAvailable = true;
  console.log('✅ Background service library loaded successfully');
} catch (error) {
  console.warn('⚠️ Background service library not available, using fallback mode');
}

// Fallback timer for when background service is not available
let fallbackInterval: NodeJS.Timeout | null = null;
let fallbackTaskRunning = false;

// Service configuration
export interface ServiceConfig {
  taskName: string;
  taskTitle: string;
  taskDesc: string;
  taskIcon?: {
    name: string;
    type: string;
  };
  color?: string;
  linkingURI?: string;
  parameters?: any;
}

// Service status
export interface ServiceStatus {
  isRunning: boolean;
  isAvailable: boolean;
  mode: 'native' | 'fallback' | 'none';
  startTime: Date | null;
  lastCheckTime: Date | null;
  error?: string;
}

class BackgroundServiceManager {
  private static instance: BackgroundServiceManager;
  private currentTask: any = null;
  private serviceStatus: ServiceStatus = {
    isRunning: false,
    isAvailable: isBackgroundServiceAvailable,
    mode: 'none',
    startTime: null,
    lastCheckTime: null,
  };
  private appStateSubscription: any = null;
  private currentAppState: AppStateStatus = AppState.currentState;

  private constructor() {
    this.initializeAppStateListener();
  }

  public static getInstance(): BackgroundServiceManager {
    if (!BackgroundServiceManager.instance) {
      BackgroundServiceManager.instance = new BackgroundServiceManager();
    }
    return BackgroundServiceManager.instance;
  }

  private initializeAppStateListener() {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange
    );
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    console.log(`App state changed from ${this.currentAppState} to ${nextAppState}`);

    if (this.currentAppState.match(/inactive|background/) && nextAppState === 'active') {
      // App has come to foreground
      if (fallbackTaskRunning) {
        console.log('App returned to foreground, fallback task still running');
      }
    }

    this.currentAppState = nextAppState;

    // In fallback mode, pause interval when app is in background on iOS
    if (Platform.OS === 'ios' && this.serviceStatus.mode === 'fallback') {
      if (nextAppState === 'background' && fallbackInterval) {
        console.log('iOS: Pausing fallback interval in background');
        this.pauseFallbackInterval();
      } else if (nextAppState === 'active' && fallbackTaskRunning && !fallbackInterval) {
        console.log('iOS: Resuming fallback interval in foreground');
        this.resumeFallbackInterval();
      }
    }
  };

  public async start(
    task: (taskData: any) => Promise<void>,
    options: ServiceConfig
  ): Promise<boolean> {
    try {
      console.log('🚀 Starting background service...');

      // Try native background service first
      if (isBackgroundServiceAvailable && BackgroundActions) {
        try {
          await BackgroundActions.start(task, options);

          this.serviceStatus = {
            isRunning: true,
            isAvailable: true,
            mode: 'native',
            startTime: new Date(),
            lastCheckTime: null,
          };

          await this.saveServiceStatus();
          console.log('✅ Native background service started successfully');
          return true;
        } catch (nativeError: any) {
          console.error('❌ Native background service failed:', nativeError.message);
          // Fall through to fallback mode
        }
      }

      // Fallback mode: Use interval timer
      console.log('📱 Starting fallback interval mode...');
      return await this.startFallbackMode(task, options);

    } catch (error: any) {
      console.error('❌ Failed to start background service:', error.message);
      this.serviceStatus.error = error.message;
      await this.saveServiceStatus();
      return false;
    }
  }

  private async startFallbackMode(
    task: (taskData: any) => Promise<void>,
    options: ServiceConfig
  ): Promise<boolean> {
    if (fallbackTaskRunning) {
      console.log('⚠️ Fallback task already running');
      return false;
    }

    const intervalMinutes = options.parameters?.interval || 60;
    const intervalMs = intervalMinutes * 60000;

    console.log(`🔄 Starting fallback interval (${intervalMinutes} minutes)`);

    fallbackTaskRunning = true;
    this.currentTask = task;

    // Run task immediately
    this.executeFallbackTask(task, options);

    // Set up interval
    fallbackInterval = setInterval(() => {
      if (this.currentAppState === 'active' || Platform.OS === 'android') {
        this.executeFallbackTask(task, options);
      }
    }, intervalMs);

    this.serviceStatus = {
      isRunning: true,
      isAvailable: false,
      mode: 'fallback',
      startTime: new Date(),
      lastCheckTime: null,
    };

    await this.saveServiceStatus();
    console.log('✅ Fallback interval started successfully');
    return true;
  }

  private async executeFallbackTask(
    task: (taskData: any) => Promise<void>,
    options: ServiceConfig
  ) {
    try {
      console.log('⏰ Executing fallback task...');

      this.serviceStatus.lastCheckTime = new Date();
      await this.saveServiceStatus();

      await task(options);

      console.log('✅ Fallback task completed');
    } catch (error: any) {
      console.error('❌ Fallback task error:', error.message);
      this.serviceStatus.error = error.message;
      await this.saveServiceStatus();
    }
  }

  private pauseFallbackInterval() {
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
      console.log('⏸️ Fallback interval paused');
    }
  }

  private resumeFallbackInterval() {
    if (fallbackTaskRunning && !fallbackInterval && this.currentTask) {
      const intervalMinutes = 60; // Default interval
      const intervalMs = intervalMinutes * 60000;

      fallbackInterval = setInterval(() => {
        if (this.currentTask) {
          this.executeFallbackTask(this.currentTask, {
            taskName: 'URLMonitorTask',
            taskTitle: '🔍 URL Monitor Active',
            taskDesc: 'Monitoring URLs...',
            parameters: { interval: intervalMinutes }
          });
        }
      }, intervalMs);

      console.log('▶️ Fallback interval resumed');
    }
  }

  public async stop(): Promise<boolean> {
    try {
      console.log('🛑 Stopping background service...');

      // Stop native service if available
      if (isBackgroundServiceAvailable && BackgroundActions && BackgroundActions.isRunning()) {
        try {
          await BackgroundActions.stop();
          console.log('✅ Native background service stopped');
        } catch (error: any) {
          console.error('⚠️ Error stopping native service:', error.message);
        }
      }

      // Stop fallback interval
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
        fallbackTaskRunning = false;
        this.currentTask = null;
        console.log('✅ Fallback interval stopped');
      }

      this.serviceStatus = {
        isRunning: false,
        isAvailable: isBackgroundServiceAvailable,
        mode: 'none',
        startTime: null,
        lastCheckTime: null,
      };

      await this.saveServiceStatus();
      return true;

    } catch (error: any) {
      console.error('❌ Failed to stop background service:', error.message);
      this.serviceStatus.error = error.message;
      await this.saveServiceStatus();
      return false;
    }
  }

  public isRunning(): boolean {
    if (isBackgroundServiceAvailable && BackgroundActions) {
      try {
        const nativeRunning = BackgroundActions.isRunning();
        if (nativeRunning) return true;
      } catch (error) {
        console.warn('Could not check native service status:', error);
      }
    }

    return fallbackTaskRunning;
  }

  public getStatus(): ServiceStatus {
    return { ...this.serviceStatus };
  }

  private async saveServiceStatus() {
    try {
      await AsyncStorage.setItem(
        'SERVICE_STATUS',
        JSON.stringify({
          ...this.serviceStatus,
          startTime: this.serviceStatus.startTime?.toISOString(),
          lastCheckTime: this.serviceStatus.lastCheckTime?.toISOString(),
        })
      );
    } catch (error) {
      console.error('Failed to save service status:', error);
    }
  }

  public async loadServiceStatus(): Promise<ServiceStatus> {
    try {
      const savedStatus = await AsyncStorage.getItem('SERVICE_STATUS');
      if (savedStatus) {
        const parsed = JSON.parse(savedStatus);
        return {
          ...parsed,
          startTime: parsed.startTime ? new Date(parsed.startTime) : null,
          lastCheckTime: parsed.lastCheckTime ? new Date(parsed.lastCheckTime) : null,
        };
      }
    } catch (error) {
      console.error('Failed to load service status:', error);
    }

    return this.serviceStatus;
  }

  public cleanup() {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  public async updateOptions(options: Partial<ServiceConfig>): Promise<boolean> {
    try {
      if (this.isRunning()) {
        console.log('🔄 Updating service options...');

        // Store current task
        const currentTask = this.currentTask;

        // Stop current service
        await this.stop();

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Restart with new options
        if (currentTask) {
          const newOptions: ServiceConfig = {
            taskName: options.taskName || 'URLMonitorTask',
            taskTitle: options.taskTitle || '🔍 URL Monitor Active',
            taskDesc: options.taskDesc || 'Monitoring URLs...',
            taskIcon: options.taskIcon,
            color: options.color || '#ff6600',
            linkingURI: options.linkingURI || 'netguard://monitor',
            parameters: options.parameters || { interval: 60 },
          };

          return await this.start(currentTask, newOptions);
        }
      }

      return true;
    } catch (error: any) {
      console.error('Failed to update service options:', error.message);
      return false;
    }
  }

  // Helper method to check if we can use native background service
  public canUseNativeService(): boolean {
    return isBackgroundServiceAvailable && BackgroundActions !== null;
  }

  // Get descriptive mode text
  public getModeDescription(): string {
    switch (this.serviceStatus.mode) {
      case 'native':
        return '🚀 Native Background Service (Full Features)';
      case 'fallback':
        return '📱 Fallback Mode (Limited Background)';
      case 'none':
        return '🔴 Service Not Running';
      default:
        return '❓ Unknown Mode';
    }
  }
}

// Export singleton instance
export default BackgroundServiceManager.getInstance();

// Export types
export type { ServiceStatus, ServiceConfig };
