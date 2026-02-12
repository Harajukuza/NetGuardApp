import { useState, useEffect, useCallback, useRef } from 'react';
import {
  NativeModules,
  DeviceEventEmitter,
  Platform,
  Alert,
} from 'react-native';

const { NetGuardBackgroundService } = NativeModules;

export interface URLItem {
  id: string;
  url: string;
  lastChecked?: Date;
  status?: 'active' | 'inactive' | 'checking';
}

export interface CallbackConfig {
  name: string;
  url: string;
}

export interface ServiceStats {
  isRunning: boolean;
  startTime: number;
  totalChecks: number;
  successfulCallbacks: number;
  failedCallbacks: number;
  lastCheckTime: number;
  uptime?: number;
}

export interface BackgroundServiceHook {
  // Service state
  isServiceRunning: boolean;
  serviceStats: ServiceStats | null;
  isLoading: boolean;
  error: string | null;

  // Service controls
  startBackgroundService: (
    urls: URLItem[],
    callbackConfig?: CallbackConfig,
    intervalMinutes?: number,
  ) => Promise<boolean>;
  stopBackgroundService: () => Promise<boolean>;
  updateServiceConfig: (
    urls: URLItem[],
    callbackConfig?: CallbackConfig,
    intervalMinutes?: number,
  ) => Promise<boolean>;
  performManualCheck: (
    urls: URLItem[],
    callbackConfig?: CallbackConfig,
  ) => Promise<boolean>;

  // Utility functions
  refreshServiceStatus: () => Promise<void>;
  requestBatteryOptimization: () => Promise<boolean>;

  // Service availability
  isSupported: boolean;
}

export const useBackgroundService = (): BackgroundServiceHook => {
  const [isServiceRunning, setIsServiceRunning] = useState(false);
  const [serviceStats, setServiceStats] = useState<ServiceStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState(
    Platform.OS === 'android' && !!NetGuardBackgroundService,
  );

  const eventSubscriptions = useRef<any[]>([]);

  // Clear error after some time
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 10000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Setup event listeners
  useEffect(() => {
    if (!isSupported) return;

    const subscriptions = [
      DeviceEventEmitter.addListener(
        'onServiceStatsUpdate',
        (stats: ServiceStats) => {
          console.log('📊 Service stats updated:', stats);
          setServiceStats(stats);
          setIsServiceRunning(stats.isRunning);
        },
      ),

      DeviceEventEmitter.addListener('onServiceStarted', (data: any) => {
        console.log('🟢 Service started:', data);
        setIsServiceRunning(true);
        refreshServiceStatus();
      }),

      DeviceEventEmitter.addListener('onServiceStopped', (data: any) => {
        console.log('🔴 Service stopped:', data);
        setIsServiceRunning(false);
        setServiceStats(null);
      }),

      DeviceEventEmitter.addListener('onServiceError', (errorData: any) => {
        console.error('❌ Service error:', errorData);
        setError(`Service error: ${errorData.message || 'Unknown error'}`);
      }),

      DeviceEventEmitter.addListener('onCheckCompleted', (results: any) => {
        console.log('✅ Check completed:', results);
        // Could emit this to parent component if needed
      }),
    ];

    eventSubscriptions.current = subscriptions;

    // Initial status check
    refreshServiceStatus();

    return () => {
      subscriptions.forEach(subscription => subscription.remove());
      eventSubscriptions.current = [];
    };
  }, [isSupported]);

  const handleServiceCall = async <T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T | null> => {
    try {
      setError(null);
      setIsLoading(true);

      const result = await operation();
      console.log(`✅ ${operationName} completed successfully:`, result);

      return result;
    } catch (err: any) {
      const errorMessage = err.message || `${operationName} failed`;
      console.error(`❌ ${operationName} error:`, err);

      setError(errorMessage);

      // Show user-friendly error alert
      Alert.alert('Service Error', `${operationName} failed: ${errorMessage}`, [
        { text: 'OK' },
      ]);

      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const startBackgroundService = useCallback(
    async (
      urls: URLItem[],
      callbackConfig?: CallbackConfig,
      intervalMinutes: number = 60,
    ): Promise<boolean> => {
      if (!isSupported) {
        setError('Background service not supported on this platform');
        return false;
      }

      if (!urls || urls.length === 0) {
        setError('No URLs provided to monitor');
        return false;
      }

      const result = await handleServiceCall(async () => {
        const serviceResult =
          await NetGuardBackgroundService.startBackgroundService(
            urls,
            callbackConfig || null,
            intervalMinutes,
          );

        if (serviceResult?.success) {
          setIsServiceRunning(true);
          // Refresh status after a short delay
          setTimeout(refreshServiceStatus, 2000);
          return true;
        } else {
          throw new Error(serviceResult?.message || 'Failed to start service');
        }
      }, 'Start background service');

      return result === true;
    },
    [isSupported],
  );

  const stopBackgroundService = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Background service not supported on this platform');
      return false;
    }

    const result = await handleServiceCall(async () => {
      const serviceResult =
        await NetGuardBackgroundService.stopBackgroundService();

      if (serviceResult?.success) {
        setIsServiceRunning(false);
        setServiceStats(null);
        return true;
      } else {
        throw new Error(serviceResult?.message || 'Failed to stop service');
      }
    }, 'Stop background service');

    return result === true;
  }, [isSupported]);

  const updateServiceConfig = useCallback(
    async (
      urls: URLItem[],
      callbackConfig?: CallbackConfig,
      intervalMinutes: number = 60,
    ): Promise<boolean> => {
      if (!isSupported) {
        setError('Background service not supported on this platform');
        return false;
      }

      const result = await handleServiceCall(async () => {
        const serviceResult =
          await NetGuardBackgroundService.updateServiceConfiguration(
            urls,
            callbackConfig || null,
            intervalMinutes,
          );

        if (serviceResult?.success) {
          // Refresh status after update
          setTimeout(refreshServiceStatus, 2000);
          return true;
        } else {
          throw new Error(
            serviceResult?.message || 'Failed to update service configuration',
          );
        }
      }, 'Update service configuration');

      return result === true;
    },
    [isSupported],
  );

  const performManualCheck = useCallback(
    async (
      urls: URLItem[],
      callbackConfig?: CallbackConfig,
    ): Promise<boolean> => {
      if (!isSupported) {
        setError('Background service not supported on this platform');
        return false;
      }

      if (!urls || urls.length === 0) {
        setError('No URLs provided for manual check');
        return false;
      }

      const result = await handleServiceCall(async () => {
        const serviceResult =
          await NetGuardBackgroundService.performManualCheck(
            urls,
            callbackConfig || null,
          );

        if (serviceResult?.success) {
          return true;
        } else {
          throw new Error(
            serviceResult?.message || 'Failed to perform manual check',
          );
        }
      }, 'Perform manual check');

      return result === true;
    },
    [isSupported],
  );

  const refreshServiceStatus = useCallback(async (): Promise<void> => {
    if (!isSupported) return;

    try {
      const status = await NetGuardBackgroundService.getServiceStatus();

      if (status) {
        console.log('📊 Service status refreshed:', status);

        setServiceStats(status);
        setIsServiceRunning(status.isRunning);
      }
    } catch (err: any) {
      console.warn('⚠️ Failed to refresh service status:', err.message);
      // Don't show error to user for status refresh failures
    }
  }, [isSupported]);

  const requestBatteryOptimization = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Battery optimization not supported on this platform');
      return false;
    }

    const result = await handleServiceCall(async () => {
      const optimizationResult =
        await NetGuardBackgroundService.requestBatteryOptimizationExemption();

      if (optimizationResult?.success) {
        return true;
      } else {
        throw new Error(
          optimizationResult?.message ||
            'Failed to request battery optimization exemption',
        );
      }
    }, 'Request battery optimization exemption');

    return result === true;
  }, [isSupported]);

  return {
    // Service state
    isServiceRunning,
    serviceStats,
    isLoading,
    error,

    // Service controls
    startBackgroundService,
    stopBackgroundService,
    updateServiceConfig,
    performManualCheck,

    // Utility functions
    refreshServiceStatus,
    requestBatteryOptimization,

    // Service availability
    isSupported,
  };
};

export default useBackgroundService;
