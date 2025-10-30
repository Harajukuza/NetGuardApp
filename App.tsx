/* eslint-disable react-native/no-inline-styles */
/**
 * URL Monitoring App - Enhanced Version with Native Background Service
 * Features:
 * - Enhanced background service with native Android integration
 * - Improved stability and reliability
 * - Better error handling and recovery mechanisms
 * - Native callback handling for better performance
 * - Advanced statistics and monitoring
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  AppState,
  AppStateStatus,
  Platform,
  Modal,
  FlatList,
  PermissionsAndroid,
  BackHandler,
  NativeModules,
  DeviceEventEmitter,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
// import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EnhancedBackgroundService, {
  BackgroundServiceConfig,
  BackgroundServiceStats,
  URLCheckResult,
} from './EnhancedBackgroundService';

// Native module for Android background service
const { BackgroundServiceModule } = NativeModules;

// Constants
const STORAGE_KEYS = {
  URLS: '@Enhanced:urls',
  CALLBACK: '@Enhanced:callback',
  INTERVAL: '@Enhanced:checkInterval',
  LAST_CALLBACK: '@Enhanced:lastCallback',
  LAST_CHECK_TIME: '@Enhanced:lastCheckTime',
  AUTO_CHECK_ENABLED: '@Enhanced:autoCheckEnabled',
  API_ENDPOINT: '@Enhanced:apiEndpoint',
  SERVICE_CONFIG: '@Enhanced:serviceConfig',
  SELECTED_CALLBACK: '@Enhanced:selectedCallback',
  AUTO_SYNC_ENABLED: '@Enhanced:autoSyncEnabled',
};

const REQUEST_TIMEOUT = 30000;
// const CALLBACK_TIMEOUT = 15000;

// TypeScript interfaces
interface URLItem {
  id: string;
  url: string;
  lastChecked?: Date;
  status?: 'active' | 'inactive' | 'checking';
  checkHistory?: CheckRecord[];
}

interface CheckRecord {
  timestamp: Date;
  status: 'active' | 'inactive';
  responseTime?: number;
  statusCode?: number;
  errorMessage?: string;
}

interface CallbackConfig {
  name: string;
  url: string;
}

interface CallbackHistory {
  timestamp: Date;
  urls: Array<{
    url: string;
    status: 'active' | 'inactive';
    error?: string;
  }>;
  success: boolean;
  totalUrls: number;
  activeCount: number;
  inactiveCount: number;
}

interface APIURLItem {
  id: number;
  callback_name: string;
  url: string;
  callback_url: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface APIResponse {
  status: string;
  message: string;
  data: APIURLItem[];
}

interface NetworkInfo {
  type: string;
  carrier: string;
  isConnected: boolean;
}

// Enhanced Background Service instance
const backgroundService = EnhancedBackgroundService.getInstance();

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={isDarkMode ? '#1a1a1a' : '#f5f5f5'}
      />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const isDarkMode = useColorScheme() === 'dark';
  const isInitialMount = useRef(true);
  const appState = useRef(AppState.currentState);
  const lastActivityTime = useRef<Date>(new Date());

  // Define callbacks first
  const refreshNetworkInfo = useCallback(async () => {
    try {
      if (Platform.OS === 'android' && BackgroundServiceModule) {
        const nativeNetworkInfo =
          await BackgroundServiceModule.getNetworkInfo();
        setNetworkInfo({
          type: nativeNetworkInfo.type || 'Unknown',
          carrier: nativeNetworkInfo.carrier || 'Unknown',
          isConnected: nativeNetworkInfo.isConnected || false,
        });
      } else {
        setNetworkInfo({
          type: 'Unknown',
          carrier: 'iOS/Fallback',
          isConnected: true,
        });
      }
    } catch (error) {
      console.error('Error refreshing network info:', error);
    }
  }, []);

  const loadServiceStats = useCallback(async () => {
    try {
      const status = await backgroundService.getServiceStatus();
      setServiceStats(status.stats);
      setIsEnhancedServiceRunning(status.isRunning);

      if (Platform.OS === 'android' && BackgroundServiceModule) {
        const nativeStatus = await BackgroundServiceModule.getServiceStatus();
        setNativeServiceStats({
          totalChecks: nativeStatus.totalChecks || 0,
          successfulCallbacks: nativeStatus.successfulCallbacks || 0,
          failedCallbacks: nativeStatus.failedCallbacks || 0,
          lastCheckTime: nativeStatus.lastCheckTime || null,
        });
      }
    } catch (error) {
      console.error('Error loading service stats:', error);
    }
  }, []);

  const refreshServiceStatus = useCallback(async () => {
    try {
      await loadServiceStats();
      const logs = await backgroundService.getServiceLogs();
      setServiceLogs(logs.slice(-20));
      const results = await backgroundService.getLastResults();
      if (results) {
        setLastResults(results.results || []);
      }
    } catch (error) {
      console.error('Error refreshing service status:', error);
    }
  }, [loadServiceStats]);

  // State management
  const [urls, setUrls] = useState<URLItem[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [callbackConfig, setCallbackConfig] = useState<CallbackConfig>({
    name: '',
    url: '',
  });
  const [checkInterval, setCheckInterval] = useState('60');
  const [isLoading, setIsLoading] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo>({
    type: 'Unknown',
    carrier: 'Checking...',
    isConnected: true,
  });
  const [lastCallback, setLastCallback] = useState<CallbackHistory | null>(
    null,
  );
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);

  // Enhanced background service states
  const [isEnhancedServiceRunning, setIsEnhancedServiceRunning] =
    useState(false);
  const [serviceStats, setServiceStats] = useState<BackgroundServiceStats>({
    totalChecks: 0,
    successfulChecks: 0,
    failedChecks: 0,
    successfulCallbacks: 0,
    failedCallbacks: 0,
    lastCheckTime: null,
    uptime: 0,
    isRunning: false,
  });
  const [timeUntilNextCheck, setTimeUntilNextCheck] = useState<string>('');

  // API integration states
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [showAPIModal, setShowAPIModal] = useState(false);
  const [apiData, setApiData] = useState<APIURLItem[]>([]);
  const [apiCallbackNames, setApiCallbackNames] = useState<string[]>([]);
  const [selectedCallbackName, setSelectedCallbackName] = useState<string>('');
  const [isLoadingAPI, setIsLoadingAPI] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

  // Non-blocking API error message (avoid Alert.alert blocking behaviour)
  const [apiError, setApiError] = useState<string | null>(null);

  // Sync URLs from API for a given callback name (or selected one)
  const syncUrlsFromApi = useCallback(
    async (callbackNameParam?: string) => {
      const cbName = callbackNameParam || selectedCallbackName;
      try {
        if (!apiEndpoint || !cbName) {
          console.log('[syncUrlsFromApi] Missing apiEndpoint or callback name');
          setApiError('Missing API endpoint or callback name');
          return;
        }

        // Normalize and validate endpoint before fetch
        const endpoint = normalizeUrl(apiEndpoint);
        if (!isValidUrl(endpoint)) {
          console.warn('[syncUrlsFromApi] Invalid API endpoint:', apiEndpoint);
          setApiError('Invalid API endpoint URL');
          return;
        }
        setIsLoadingAPI(true);
        setApiError(null);

        const response = await fetch(endpoint, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: APIResponse = await response.json();

        if (data.status === 'success' && data.data) {
          const filteredData = data.data.filter(
            item => String(item.callback_name) === String(cbName),
          );

          if (filteredData.length === 0) {
            console.log(
              '[syncUrlsFromApi] No URLs found for selected callback',
              cbName,
            );
            setIsLoadingAPI(false);
            setApiError(`No URLs found for callback: ${cbName}`);
            return;
          }

          const callbackUrl = filteredData[0].callback_url;

          // Update callback config if URL changed
          setCallbackConfig(prev => {
            if (!prev || prev.url !== callbackUrl || prev.name !== cbName) {
              return { name: cbName, url: callbackUrl };
            }
            return prev;
          });

          // Create new URL items
          const newUrls: URLItem[] = filteredData.map(item => ({
            id: `${item.id}_${Date.now()}_${Math.random()}`,
            url: item.url,
            status: 'checking' as const,
            checkHistory: [],
          }));

          // Replace all URLs with new ones from API
          setUrls(newUrls);
          setSelectedCallbackName(cbName);
          await AsyncStorage.setItem(STORAGE_KEYS.SELECTED_CALLBACK, cbName);

          console.log(
            `[syncUrlsFromApi] Synced ${newUrls.length} URLs for callback: ${cbName}`,
          );
          setIsLoadingAPI(false);
          setApiError(null);
        }
      } catch (error) {
        console.error('Error syncing URLs from API:', error);
        setIsLoadingAPI(false);
        setApiError(error?.message || 'Failed to sync from API');
      }
    },
    [apiEndpoint, selectedCallbackName],
  );

  // Listen to background/headless events emitted from index.js for real-time UI updates
  useEffect(() => {
    const onApiSuccess = (payload: any) => {
      console.log('API_SYNC_SUCCESS', payload);
      // refresh saved data to pick up newly saved URLs/callback
      loadSavedData().catch(() => {});
      setApiError(null);
      setIsLoadingAPI(false);
    };

    const onApiError = (payload: any) => {
      console.warn('API_SYNC_ERROR', payload);
      setApiError(payload?.error || 'API sync failed');
      setIsLoadingAPI(false);
    };

    const onBackgroundResults = (payload: any) => {
      console.log('BACKGROUND_CHECK_RESULTS', payload);
      // ask saved data to refresh lastResults / UI
      loadSavedData().catch(() => {});
      // optionally set last results for immediate display
      if (payload?.results && Array.isArray(payload.results)) {
        setLastResults(payload.results);
      }
    };

    const onBackgroundError = (payload: any) => {
      console.warn('BACKGROUND_TASK_ERROR', payload);
      // show non-blocking error
      setApiError(payload?.error || 'Background task error');
    };

    const sub1 = DeviceEventEmitter.addListener(
      'API_SYNC_SUCCESS',
      onApiSuccess,
    );
    const sub2 = DeviceEventEmitter.addListener('API_SYNC_ERROR', onApiError);
    const sub3 = DeviceEventEmitter.addListener(
      'BACKGROUND_CHECK_RESULTS',
      onBackgroundResults,
    );
    const sub4 = DeviceEventEmitter.addListener(
      'BACKGROUND_TASK_ERROR',
      onBackgroundError,
    );

    return () => {
      sub1.remove();
      sub2.remove();
      sub3.remove();
      sub4.remove();
    };
  }, []);

  // Native service states
  const [useNativeService, setUseNativeService] = useState(
    Platform.OS === 'android',
  );
  const [nativeServiceStats, setNativeServiceStats] = useState({
    totalChecks: 0,
    successfulCallbacks: 0,
    failedCallbacks: 0,
    lastCheckTime: null,
  });

  // Debug and monitoring
  const [serviceLogs, setServiceLogs] = useState<any[]>([]);
  const [showServiceLogs, setShowServiceLogs] = useState(false);
  const [lastResults, setLastResults] = useState<URLCheckResult[]>([]);

  // Memoized sorted URLs for performance
  const sortedUrls = useMemo(() => {
    return [...urls].sort((a, b) => {
      const statusOrder = { checking: 0, inactive: 1, active: 2 };
      const aOrder = statusOrder[a.status || 'checking'];
      const bOrder = statusOrder[b.status || 'checking'];
      return aOrder - bOrder;
    });
  }, [urls]);

  // Initialize app and setup listeners
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await loadSavedData();
        await refreshNetworkInfo();
        await handlePermissions();
        await loadServiceStats();

        // Setup network change listener
        if (Platform.OS === 'android') {
          const networkListener = DeviceEventEmitter.addListener(
            'NetworkStateChanged',
            handleNetworkChange,
          );

          return () => networkListener.remove();
        }
      } catch (error: any) {
        console.error('App initialization error:', error);
      }
    };

    initializeApp();

    // Handle back button on Android
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (isEnhancedServiceRunning) {
          Alert.alert(
            'Background Service Running',
            'Enhanced URL monitoring is active. Exit anyway?',
            [
              { text: 'Stay', style: 'cancel' },
              {
                text: 'Exit',
                style: 'destructive',
                onPress: () => BackHandler.exitApp(),
              },
            ],
          );
          return true;
        }
        return false;
      },
    );

    return () => {
      backHandler.remove();
    };
  }, [isEnhancedServiceRunning]);

  // Periodic sync handler
  useEffect(() => {
    if (!isEnhancedServiceRunning || !autoSyncEnabled || !selectedCallbackName)
      return;

    const syncInterval = setInterval(() => {
      if (selectedCallbackName) syncUrlsFromApi(selectedCallbackName);
    }, parseInt(checkInterval, 10) * 60 * 1000); // Sync at the same interval as URL checks

    return () => clearInterval(syncInterval);
  }, [
    isEnhancedServiceRunning,
    autoSyncEnabled,
    selectedCallbackName,
    checkInterval,
    syncUrlsFromApi,
  ]);

  // App state change handler
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState: AppStateStatus) => {
        console.log('App State changed to:', nextAppState);
        lastActivityTime.current = new Date();

        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === 'active'
        ) {
          console.log('App returned to foreground - refreshing service status');
          refreshServiceStatus();
          refreshNetworkInfo();

          // Sync URLs if auto-sync is enabled
          if (autoSyncEnabled && selectedCallbackName) {
            syncUrlsFromApi(selectedCallbackName);
          }
        }

        appState.current = nextAppState;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [
    autoSyncEnabled,
    selectedCallbackName,
    syncUrlsFromApi,
    refreshServiceStatus,
    refreshNetworkInfo,
  ]);

  // Network change handler
  const handleNetworkChange = useCallback((netInfo: any) => {
    console.log('Network state changed:', netInfo);
    setNetworkInfo({
      type: netInfo.type || 'Unknown',
      carrier: getCarrierName(netInfo.type),
      isConnected: netInfo.isConnected || false,
    });
  }, []);

  // Helper functions
  const getCarrierName = (networkType: string) => {
    switch (networkType) {
      case 'wifi':
        return 'WiFi Connection';
      case 'mobile':
        return 'Mobile Data';
      case 'ethernet':
        return 'Ethernet';
      default:
        return 'Unknown Connection';
    }
  };

  const normalizeUrl = (url: string): string => {
    let normalized = url.trim();
    if (!normalized.match(/^https?:\/\//i)) {
      normalized = 'https://' + normalized;
    }
    return normalized.replace(/\/+$/, '');
  };

  const isValidUrl = (url: string): boolean => {
    try {
      const _unusedUrl = new URL(url);
      _unusedUrl.toString();
      return url.startsWith('http://') || url.startsWith('https://');
    } catch {
      return false;
    }
  };

  const formatTimeAgo = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return `${diffSecs}s ago`;
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const formatDateTime = (date: Date): string => {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
    if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
    return `${remainingSeconds}s`;
  };

  // Data management functions

  const loadSavedData = async () => {
    try {
      const [
        savedUrls,
        savedCallback,
        savedInterval,
        savedLastCallback,
        savedLastCheck,
        savedApiEndpoint,
        savedSelectedCallback,
        savedAutoSync,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.URLS),
        AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
        AsyncStorage.getItem(STORAGE_KEYS.INTERVAL),
        AsyncStorage.getItem(STORAGE_KEYS.LAST_CALLBACK),
        AsyncStorage.getItem(STORAGE_KEYS.LAST_CHECK_TIME),
        AsyncStorage.getItem(STORAGE_KEYS.API_ENDPOINT),
        AsyncStorage.getItem(STORAGE_KEYS.SELECTED_CALLBACK),
        AsyncStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED),
      ]);

      if (savedUrls) {
        const parsedUrls = JSON.parse(savedUrls);
        const urlsWithDates = parsedUrls.map((url: any) => ({
          ...url,
          lastChecked: url.lastChecked ? new Date(url.lastChecked) : undefined,
          checkHistory:
            url.checkHistory?.map((record: any) => ({
              ...record,
              timestamp: new Date(record.timestamp),
            })) || [],
        }));
        setUrls(urlsWithDates);
      }

      if (savedCallback) setCallbackConfig(JSON.parse(savedCallback));
      if (savedInterval) setCheckInterval(savedInterval);
      if (savedApiEndpoint) setApiEndpoint(savedApiEndpoint);
      if (savedSelectedCallback) setSelectedCallbackName(savedSelectedCallback);
      if (savedAutoSync) setAutoSyncEnabled(savedAutoSync === 'true');

      if (savedLastCallback) {
        const parsed = JSON.parse(savedLastCallback);
        setLastCallback({
          ...parsed,
          timestamp: new Date(parsed.timestamp),
        });
      }

      if (savedLastCheck) {
        setLastCheckTime(new Date(savedLastCheck));
      }

      // Load from API if we have an endpoint
      if (savedApiEndpoint && savedSelectedCallback) {
        await loadFromAPI();
      }
    } catch (error) {
      console.error('Error loading saved data:', error);
    }
  };

  const saveSavedData = useCallback(async () => {
    try {
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.URLS, JSON.stringify(urls)),
        AsyncStorage.setItem(
          STORAGE_KEYS.CALLBACK,
          JSON.stringify(callbackConfig),
        ),
        AsyncStorage.setItem(STORAGE_KEYS.INTERVAL, checkInterval),
        AsyncStorage.setItem(STORAGE_KEYS.API_ENDPOINT, apiEndpoint),
        AsyncStorage.setItem(
          STORAGE_KEYS.SELECTED_CALLBACK,
          selectedCallbackName,
        ),
        AsyncStorage.setItem(
          STORAGE_KEYS.AUTO_SYNC_ENABLED,
          autoSyncEnabled.toString(),
        ),
      ]);

      if (lastCheckTime) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.LAST_CHECK_TIME,
          lastCheckTime.toISOString(),
        );
      }
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }, [
    urls,
    callbackConfig,
    checkInterval,
    apiEndpoint,
    lastCheckTime,
    autoSyncEnabled,
    selectedCallbackName,
  ]);

  // Save data when state changes (debounced)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const saveTimer = setTimeout(saveSavedData, 500);
    return () => clearTimeout(saveTimer);
  }, [saveSavedData]);

  // Permission handling
  const handlePermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const permissions = [] as any;

        if ('WAKE_LOCK' in PermissionsAndroid.PERMISSIONS) {
          permissions.push(PermissionsAndroid.PERMISSIONS.WAKE_LOCK);
        }
        if ('FOREGROUND_SERVICE' in PermissionsAndroid.PERMISSIONS) {
          permissions.push(PermissionsAndroid.PERMISSIONS.FOREGROUND_SERVICE);
        }
        if ('ACCESS_NETWORK_STATE' in PermissionsAndroid.PERMISSIONS) {
          permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_NETWORK_STATE);
        }

        if (permissions.length > 0) {
          const granted = await PermissionsAndroid.requestMultiple(permissions);
          console.log('Permissions granted:', granted);
        }

        // Request battery optimization exemption
        try {
          const batteryOptimization = await PermissionsAndroid.request(
            'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS' as any,
            {
              title: 'Background Activity Permission',
              message:
                'NetGuard needs to run in background continuously. Please disable battery optimization.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'Allow',
            },
          );
          console.log('Battery optimization permission:', batteryOptimization);
        } catch (batteryError) {
          console.log(
            'Battery optimization request not available:',
            batteryError,
          );
        }
      } catch (err) {
        console.warn('Permission request error:', err);
      }
    }
  };

  // Service management functions

  const startEnhancedBackgroundService = async () => {
    try {
      // If auto-sync is enabled, sync before starting service
      if (autoSyncEnabled && selectedCallbackName) {
        await syncUrlsFromApi(selectedCallbackName);
      }

      if (urls.length === 0) {
        Alert.alert('No URLs', 'Please add URLs to monitor first');
        return;
      }

      if (!(callbackConfig && callbackConfig.url)) {
        Alert.alert('No Callback', 'Please configure callback URL first');
        return;
      }

      const config: BackgroundServiceConfig = {
        urls: urls.map(url => url.url),
        callbackConfig,
        intervalMinutes: parseInt(checkInterval, 10),
        retryAttempts: 3,
        timeoutMs: REQUEST_TIMEOUT,
      };

      console.log('Starting enhanced background service with config:', config);

      let success = false;

      if (
        useNativeService &&
        Platform.OS === 'android' &&
        BackgroundServiceModule
      ) {
        // Use native Android service
        try {
          const nativeConfig = {
            urls: JSON.stringify(config.urls),
            intervalMinutes: config.intervalMinutes,
            timeoutMs: config.timeoutMs,
            retryAttempts: config.retryAttempts,
            callbackUrl: config.callbackConfig?.url,
            callbackName: config.callbackConfig?.name,
          };

          const result =
            await BackgroundServiceModule.startEnhancedBackgroundService(
              nativeConfig,
            );
          success = result.success;
          console.log('Native service result:', result);
        } catch (error) {
          console.error(
            'Native service failed, falling back to JS service:',
            error,
          );
          success = await backgroundService.startService(config);
        }
      } else {
        // Use JavaScript service
        success = await backgroundService.startService(config);
      }

      if (success) {
        setIsEnhancedServiceRunning(true);
        await loadServiceStats();

        Alert.alert(
          'Enhanced Background Service Started',
          `URLs will be monitored every ${checkInterval} minutes with enhanced stability.\n\n` +
            '🔄 Service is now active\n' +
            '📱 You can now close or minimize the app\n' +
            '🔔 Persistent notification will be visible',
          [{ text: 'OK' }],
        );
      } else {
        Alert.alert('Error', 'Failed to start enhanced background service');
      }
    } catch (error: any) {
      console.error('Failed to start enhanced background service:', error);
      Alert.alert(
        'Error',
        'Failed to start enhanced background service: ' + error.message,
      );
    }
  };

  const stopEnhancedBackgroundService = async () => {
    try {
      console.log('Stopping enhanced background service');

      if (
        useNativeService &&
        Platform.OS === 'android' &&
        BackgroundServiceModule
      ) {
        try {
          await BackgroundServiceModule.stopEnhancedBackgroundService();
        } catch (error) {
          console.error('Native service stop failed:', error);
        }
      }

      await backgroundService.stopService();
      setIsEnhancedServiceRunning(false);
      await loadServiceStats();

      Alert.alert(
        'Enhanced Background Service Stopped',
        'URL monitoring has been stopped.',
      );
    } catch (error: any) {
      console.error('Failed to stop enhanced background service:', error);
      Alert.alert('Error', 'Failed to stop enhanced background service');
    }
  };

  const toggleEnhancedBackgroundService = async (enable: boolean) => {
    if (enable) {
      await startEnhancedBackgroundService();
    } else {
      await stopEnhancedBackgroundService();
    }
  };

  // URL management functions
  const addUrl = () => {
    if (!newUrl.trim()) {
      Alert.alert('Error', 'Please enter a URL');
      return;
    }

    const normalizedUrl = normalizeUrl(newUrl);

    if (!isValidUrl(normalizedUrl)) {
      Alert.alert('Error', 'Please enter a valid URL');
      return;
    }

    const newUrlItem: URLItem = {
      id: Date.now().toString(),
      url: normalizedUrl,
      lastChecked: new Date(),
      status: 'checking',
      checkHistory: [],
    };

    setUrls([...urls, newUrlItem]);
    setNewUrl('');
  };

  const removeUrl = (id: string) => {
    Alert.alert('Remove URL', 'Are you sure you want to remove this URL?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setUrls(urls.filter(url => url.id !== id));
        },
      },
    ]);
  };

  const clearAllData = () => {
    Alert.alert(
      'Clear All Data',
      'This will remove all URLs and settings. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isEnhancedServiceRunning) {
                await stopEnhancedBackgroundService();
              }

              await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
              setUrls([]);
              setCallbackConfig({ name: '', url: '' });
              setCheckInterval('60');
              setLastCallback(null);
              setLastCheckTime(null);
              setApiEndpoint('');
              setApiData([]);
              setApiCallbackNames([]);
              setSelectedCallbackName('');
              setServiceStats({
                totalChecks: 0,
                successfulChecks: 0,
                failedChecks: 0,
                successfulCallbacks: 0,
                failedCallbacks: 0,
                lastCheckTime: null,
                uptime: 0,
                isRunning: false,
              });

              Alert.alert('Success', 'All data cleared');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear data');
            }
          },
        },
      ],
    );
  };

  // Manual URL check function
  const performManualCheck = async () => {
    if (urls.length === 0) {
      Alert.alert('No URLs', 'Please add URLs to monitor first');
      return;
    }

    setIsLoading(true);
    setLastCheckTime(new Date());

    try {
      if (
        useNativeService &&
        Platform.OS === 'android' &&
        BackgroundServiceModule
      ) {
        // Use native check
        const config = {
          urls: JSON.stringify(urls.map(url => url.url)),
          timeoutMs: REQUEST_TIMEOUT,
          retryAttempts: 2,
          callbackUrl: callbackConfig?.url,
          callbackName: callbackConfig?.name,
        };

        const result = await BackgroundServiceModule.performNativeURLCheck(
          config,
        );
        console.log('Native manual check result:', result);

        if (result.success) {
          // Update UI with results
          Alert.alert(
            'Manual Check Completed',
            `Checked ${result.totalChecked} URLs\n` +
              `Active: ${result.activeCount}\n` +
              `Inactive: ${result.inactiveCount}`,
          );
        } else {
          Alert.alert('Check Failed', result.error || 'Unknown error occurred');
        }
      } else {
        // Fallback to JavaScript check
        Alert.alert(
          'Manual Check',
          'Manual check is not implemented in JavaScript version. Use the enhanced background service for reliable monitoring.',
        );
      }
    } catch (error: any) {
      console.error('Manual check error:', error);
      Alert.alert('Error', 'Failed to perform manual check: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // API integration functions
  const loadFromAPI = async () => {
    if (!apiEndpoint) {
      // non-blocking error and focus UI (avoid Alert which may block headless flows)
      setApiError('Please enter API endpoint URL');
      return;
    }

    // normalize and validate before trying
    const endpoint = normalizeUrl(apiEndpoint);
    if (!isValidUrl(endpoint)) {
      setApiError('Invalid API endpoint URL');
      return;
    }

    setIsLoadingAPI(true);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: APIResponse = await response.json();

      if (data.status === 'success' && data.data) {
        setApiData(data.data);
        const uniqueCallbackNames = [
          ...new Set(data.data.map(item => item.callback_name)),
        ];
        setApiCallbackNames(uniqueCallbackNames);
        // Provide inline success feedback
        setApiError(null);
        Alert.alert(
          'Success',
          `Loaded ${data.data.length} URLs from ${uniqueCallbackNames.length} callback configurations`,
        );
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (error: any) {
      setApiError(error?.message || 'Failed to load from API');
      console.error('Failed to load from API:', error);
    } finally {
      setIsLoadingAPI(false);
    }
  };

  const loadURLsForCallback = (callbackName: string) => {
    const filteredData = apiData.filter(
      item => item.callback_name === callbackName,
    );

    if (filteredData.length === 0) {
      Alert.alert('Error', 'No URLs found for this callback');
      return;
    }

    const callbackUrl = filteredData[0].callback_url;
    setCallbackConfig({ name: callbackName, url: callbackUrl });

    const newUrls: URLItem[] = filteredData.map(item => ({
      id: `${item.id}_${Date.now()}_${Math.random()}`,
      url: item.url,
      status: 'checking' as const,
      checkHistory: [],
    }));

    setUrls(prevUrls => [...prevUrls, ...newUrls]);
    setSelectedCallbackName(callbackName);
    setShowAPIModal(false);

    Alert.alert(
      'Success',
      `Loaded ${newUrls.length} URLs for callback: ${callbackName}\nCallback URL: ${callbackUrl}`,
    );
  };

  // Callback configuration
  const saveCallbackConfig = () => {
    const name = (callbackConfig?.name || '').trim();
    const urlVal = (callbackConfig?.url || '').trim();

    if (!name || !urlVal) {
      Alert.alert('Error', 'Please fill in both callback name and URL');
      return;
    }

    const normalizedCallbackUrl = normalizeUrl(urlVal);

    if (!isValidUrl(normalizedCallbackUrl)) {
      Alert.alert('Error', 'Please enter a valid callback URL');
      return;
    }

    const updatedConfig = { name, url: normalizedCallbackUrl };
    setCallbackConfig(updatedConfig);
    Alert.alert('Success', 'Callback configuration saved');
  };

  const saveInterval = () => {
    const interval = parseInt(checkInterval, 10);
    if (isNaN(interval) || interval < 1) {
      Alert.alert('Error', 'Please enter a valid interval (minimum 1 minute)');
      return;
    }

    Alert.alert('Success', `Check interval set to ${interval} minutes`);

    if (isEnhancedServiceRunning) {
      Alert.alert(
        'Restart Required',
        'Background service needs to restart with new interval. Restart now?',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Restart',
            onPress: async () => {
              await stopEnhancedBackgroundService();
              setTimeout(() => {
                startEnhancedBackgroundService();
              }, 1000);
            },
          },
        ],
      );
    }
  };

  // Styling
  const containerStyle = {
    ...styles.container,
    paddingTop: safeAreaInsets.top,
    backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5',
  };

  const cardStyle = {
    ...styles.card,
    backgroundColor: isDarkMode ? '#2a2a2a' : 'white',
  };

  const inputStyle = {
    ...styles.input,
    backgroundColor: isDarkMode ? '#3a3a3a' : '#f0f0f0',
    color: isDarkMode ? 'white' : 'black',
  };

  const textStyle = {
    color: isDarkMode ? 'white' : 'black',
  };

  return (
    <ScrollView style={containerStyle}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, textStyle]}>NetGuard Enhanced</Text>
          {lastCheckTime && (
            <Text style={[styles.lastCheckText, textStyle]}>
              Last check: {formatTimeAgo(lastCheckTime)}
            </Text>
          )}
        </View>

        {/* Enhanced Background Service Status */}
        <View
          style={[
            cardStyle,
            isEnhancedServiceRunning
              ? styles.serviceActiveCard
              : styles.serviceInactiveCard,
          ]}
        >
          <View style={styles.serviceHeader}>
            <Text style={[styles.serviceTitle, textStyle]}>
              {isEnhancedServiceRunning
                ? '🟢 Enhanced Service Active'
                : '🔴 Enhanced Service Stopped'}
            </Text>
            <Switch
              value={isEnhancedServiceRunning}
              onValueChange={toggleEnhancedBackgroundService}
              trackColor={{ false: '#767577', true: '#81b0ff' }}
              thumbColor={isEnhancedServiceRunning ? '#2196F3' : '#f4f3f4'}
            />
          </View>

          {isEnhancedServiceRunning && (
            <>
              <Text style={[styles.serviceDescription, textStyle]}>
                Monitoring {urls.length} URLs every {checkInterval} minutes with
                enhanced stability
              </Text>
              <Text style={[styles.serviceUptime, textStyle]}>
                Uptime: {formatUptime(serviceStats.uptime)}
              </Text>
            </>
          )}

          {timeUntilNextCheck && isEnhancedServiceRunning && (
            <Text style={[styles.countdownText, textStyle]}>
              Next check: {timeUntilNextCheck}
            </Text>
          )}
        </View>

        {/* Service Statistics */}
        {(serviceStats.totalChecks > 0 || isEnhancedServiceRunning) && (
          <View style={cardStyle}>
            <Text style={[styles.sectionTitle, textStyle]}>
              Enhanced Service Statistics
            </Text>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, textStyle]}>
                  {serviceStats.totalChecks}
                </Text>
                <Text style={[styles.statLabel, textStyle]}>Total Checks</Text>
              </View>
              <View style={styles.statItem}>
                <Text
                  style={[styles.statValue, textStyle, { color: '#4CAF50' }]}
                >
                  {serviceStats.successfulCallbacks}
                </Text>
                <Text style={[styles.statLabel, textStyle]}>Successful</Text>
              </View>
              <View style={styles.statItem}>
                <Text
                  style={[styles.statValue, textStyle, { color: '#F44336' }]}
                >
                  {serviceStats.failedCallbacks}
                </Text>
                <Text style={[styles.statLabel, textStyle]}>Failed</Text>
              </View>
            </View>
            {serviceStats.lastCheckTime && (
              <Text style={[styles.lastServiceCheck, textStyle]}>
                Last background check: {serviceStats.lastCheckTime}
              </Text>
            )}
          </View>
        )}

        {/* Native Service Toggle (Android only) */}
        {Platform.OS === 'android' && (
          <View style={cardStyle}>
            <Text style={[styles.sectionTitle, textStyle]}>
              Service Options
            </Text>
            <View style={styles.toggleRow}>
              <Text style={[styles.toggleLabel, textStyle]}>
                Use Native Android Service (Recommended)
              </Text>
              <Switch
                value={useNativeService}
                onValueChange={setUseNativeService}
                trackColor={{ false: '#767577', true: '#81b0ff' }}
                thumbColor={useNativeService ? '#2196F3' : '#f4f3f4'}
              />
            </View>
            <Text style={[styles.toggleDescription, textStyle]}>
              Native service provides better background stability and battery
              optimization
            </Text>
          </View>
        )}

        {/* Network Status */}
        <View style={cardStyle}>
          <Text style={[styles.sectionTitle, textStyle]}>Network Status</Text>
          <View style={styles.networkInfoContainer}>
            <View style={styles.networkRow}>
              <Text style={[styles.networkLabel, textStyle]}>Type:</Text>
              <Text
                style={[
                  styles.networkValue,
                  textStyle,
                  {
                    color:
                      networkInfo.type !== 'Unknown' ? '#4CAF50' : '#FF9800',
                  },
                ]}
              >
                {networkInfo.carrier}
              </Text>
            </View>
            <View style={styles.networkRow}>
              <Text style={[styles.networkLabel, textStyle]}>Status:</Text>
              <View style={styles.connectionStatus}>
                <View
                  style={[
                    styles.connectionIndicator,
                    {
                      backgroundColor: networkInfo.isConnected
                        ? '#4CAF50'
                        : '#F44336',
                    },
                  ]}
                />
                <Text style={[styles.networkValue, textStyle]}>
                  {networkInfo.isConnected ? 'Connected' : 'Disconnected'}
                </Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={refreshNetworkInfo}
          >
            <Text style={styles.refreshButtonText}>Refresh Network Info</Text>
          </TouchableOpacity>
        </View>

        {/* API Configuration Section */}
        <View style={cardStyle}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, textStyle]}>
              API Configuration
            </Text>
          </View>

          <TextInput
            style={inputStyle}
            placeholder="API Endpoint URL"
            placeholderTextColor={isDarkMode ? '#999' : '#666'}
            value={apiEndpoint}
            onChangeText={text => {
              setApiEndpoint(text);
              // clear error when user edits
              if (apiError) setApiError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Inline non-blocking error message */}
          {apiError ? (
            <Text style={{ color: '#F44336', marginTop: 8 }}>{apiError}</Text>
          ) : null}

          <View style={styles.apiButtonsRow}>
            <TouchableOpacity
              style={[styles.apiButton, isLoadingAPI && styles.buttonDisabled]}
              onPress={loadFromAPI}
              disabled={isLoadingAPI}
            >
              {isLoadingAPI ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.buttonText}>Load from API</Text>
              )}
            </TouchableOpacity>

            {apiCallbackNames.length > 0 && (
              <TouchableOpacity
                style={styles.apiButton}
                onPress={() => setShowAPIModal(true)}
              >
                <Text style={styles.buttonText}>
                  Select Callback ({apiCallbackNames.length})
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {selectedCallbackName && (
            <View style={[styles.toggleRow, styles.marginTop]}>
              <Text style={[styles.toggleLabel, textStyle]}>
                Auto-sync URLs from API
              </Text>
              <Switch
                value={autoSyncEnabled}
                onValueChange={async enabled => {
                  // If enabling auto-sync but no callback selected, try to auto-select
                  if (enabled && !selectedCallbackName) {
                    if (apiCallbackNames.length === 1) {
                      const only = apiCallbackNames[0];
                      setSelectedCallbackName(only);
                      await AsyncStorage.setItem(
                        STORAGE_KEYS.SELECTED_CALLBACK,
                        only,
                      );
                      await syncUrlsFromApi(only);
                      setAutoSyncEnabled(true);
                      await AsyncStorage.setItem(
                        STORAGE_KEYS.AUTO_SYNC_ENABLED,
                        'true',
                      );
                      return;
                    }

                    // If multiple callbacks available, prompt user to choose
                    Alert.alert(
                      'Select callback',
                      'Please select a callback before enabling auto-sync',
                    );
                    setShowAPIModal(true);
                    return;
                  }

                  setAutoSyncEnabled(enabled);
                  await AsyncStorage.setItem(
                    STORAGE_KEYS.AUTO_SYNC_ENABLED,
                    enabled ? 'true' : 'false',
                  );
                  if (enabled && selectedCallbackName) {
                    await syncUrlsFromApi(selectedCallbackName);
                  }
                }}
                trackColor={{ false: '#767577', true: '#81b0ff' }}
                thumbColor={autoSyncEnabled ? '#2196F3' : '#f4f3f4'}
              />
            </View>
          )}

          {selectedCallbackName && (
            <Text style={[styles.selectedCallbackText, textStyle]}>
              Current: {selectedCallbackName}
            </Text>
          )}
        </View>

        {/* URL Input Section */}
        <View style={cardStyle}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, textStyle]}>
              URLs to Monitor ({urls.length})
            </Text>
            {urls.length > 0 && (
              <TouchableOpacity onPress={clearAllData}>
                <Text style={styles.clearText}>Clear All</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={[inputStyle, styles.urlInput]}
              placeholder="Enter URL (e.g. google.com)"
              placeholderTextColor={isDarkMode ? '#999' : '#666'}
              value={newUrl}
              onChangeText={setNewUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.addButton} onPress={addUrl}>
              <Text style={styles.buttonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* URL List */}
          {sortedUrls.map(url => (
            <View key={url.id} style={styles.urlItem}>
              <View style={styles.urlInfo}>
                <Text style={[styles.urlText, textStyle]} numberOfLines={1}>
                  {url.url}
                </Text>
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusIndicator,
                      {
                        backgroundColor:
                          url.status === 'active'
                            ? '#4CAF50'
                            : url.status === 'inactive'
                            ? '#F44336'
                            : '#FFC107',
                      },
                    ]}
                  />
                  <Text style={[styles.statusText, textStyle]}>
                    {url.status || 'Unknown'}
                  </Text>
                  {url.lastChecked && (
                    <Text style={[styles.lastCheckedText, textStyle]}>
                      {` • ${formatTimeAgo(url.lastChecked)}`}
                    </Text>
                  )}
                </View>
              </View>
              <TouchableOpacity onPress={() => removeUrl(url.id)}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}

          {urls.length === 0 && (
            <Text style={[styles.emptyText, textStyle]}>No URLs added yet</Text>
          )}
        </View>

        {/* Callback Configuration */}
        <View style={cardStyle}>
          <Text style={[styles.sectionTitle, textStyle]}>
            Callback Configuration
          </Text>
          <TextInput
            style={inputStyle}
            placeholder="Callback Name"
            placeholderTextColor={isDarkMode ? '#999' : '#666'}
            value={callbackConfig.name}
            onChangeText={text =>
              setCallbackConfig(prev => ({ ...prev, name: text }))
            }
          />
          <TextInput
            style={[inputStyle, styles.marginTop]}
            placeholder="Callback URL (e.g. webhook.site/...)"
            placeholderTextColor={isDarkMode ? '#999' : '#666'}
            value={callbackConfig.url}
            onChangeText={text =>
              setCallbackConfig(prev => ({ ...prev, url: text }))
            }
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.button, styles.marginTop]}
            onPress={saveCallbackConfig}
          >
            <Text style={styles.buttonText}>Save Callback</Text>
          </TouchableOpacity>

          {/* Last Callback Info */}
          {lastCallback && (
            <View style={styles.callbackHistory}>
              <Text style={[styles.callbackHistoryTitle, textStyle]}>
                Last Callback:
              </Text>
              <Text style={[styles.callbackHistoryText, textStyle]}>
                Time: {formatDateTime(lastCallback.timestamp)}
              </Text>
              <Text style={[styles.callbackHistoryText, textStyle]}>
                Total URLs: {lastCallback.totalUrls} (
                <Text style={{ color: '#4CAF50', fontWeight: 'bold' }}>
                  {lastCallback.activeCount} active
                </Text>
                ,{' '}
                <Text style={{ color: '#F44336', fontWeight: 'bold' }}>
                  {lastCallback.inactiveCount} inactive
                </Text>
                )
              </Text>
              <Text style={[styles.callbackHistoryText, textStyle]}>
                Status:{' '}
                <Text
                  style={{
                    color: lastCallback.success ? '#4CAF50' : '#F44336',
                    fontWeight: 'bold',
                  }}
                >
                  {lastCallback.success ? 'Success' : 'Failed'}
                </Text>
              </Text>
            </View>
          )}
        </View>

        {/* Check Interval Settings */}
        <View style={cardStyle}>
          <Text style={[styles.sectionTitle, textStyle]}>
            Check Interval Settings
          </Text>

          <View style={styles.inputRow}>
            <TextInput
              style={[inputStyle, styles.intervalInput]}
              placeholder="Interval (minutes)"
              placeholderTextColor={isDarkMode ? '#999' : '#666'}
              value={checkInterval}
              onChangeText={setCheckInterval}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.button} onPress={saveInterval}>
              <Text style={styles.buttonText}>Set Interval</Text>
            </TouchableOpacity>
          </View>

          {/* Enhanced Service Tips */}
          <View style={styles.androidTips}>
            <Text style={[styles.androidTipsTitle, textStyle]}>
              💡 Enhanced Service Features:
            </Text>
            <Text style={[styles.androidTipsText, textStyle]}>
              • Native background execution for better reliability
            </Text>
            <Text style={[styles.androidTipsText, textStyle]}>
              • Automatic service restart on failure
            </Text>
            <Text style={[styles.androidTipsText, textStyle]}>
              • Callback retry mechanism with queue
            </Text>
            <Text style={[styles.androidTipsText, textStyle]}>
              • Health monitoring and statistics
            </Text>
          </View>
        </View>

        {/* Manual Check Button */}
        <TouchableOpacity
          style={[styles.checkButton, isLoading && styles.buttonDisabled]}
          onPress={performManualCheck}
          disabled={isLoading || urls.length === 0}
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.checkButtonText}>
              {useNativeService && Platform.OS === 'android'
                ? 'Native Manual Check'
                : 'Manual Check (Limited)'}
            </Text>
          )}
        </TouchableOpacity>

        {/* Service Logs Button (Debug) */}
        {__DEV__ && serviceLogs.length > 0 && (
          <TouchableOpacity
            style={styles.debugButton}
            onPress={() => setShowServiceLogs(true)}
          >
            <Text style={styles.buttonText}>
              View Service Logs ({serviceLogs.length})
            </Text>
          </TouchableOpacity>
        )}

        {/* Last Results Display */}
        {lastResults.length > 0 && (
          <View style={cardStyle}>
            <Text style={[styles.sectionTitle, textStyle]}>
              Last Background Check Results
            </Text>
            {lastResults.slice(0, 5).map((result, index) => (
              <View key={index} style={styles.resultItem}>
                <View
                  style={[
                    styles.statusIndicator,
                    {
                      backgroundColor:
                        result.status === 'active' ? '#4CAF50' : '#F44336',
                    },
                  ]}
                />
                <Text style={[styles.resultUrl, textStyle]} numberOfLines={1}>
                  {result.url}
                </Text>
                <Text style={[styles.resultTime, textStyle]}>
                  {result.responseTime}ms
                </Text>
              </View>
            ))}
            {lastResults.length > 5 && (
              <Text style={[styles.moreResults, textStyle]}>
                ... and {lastResults.length - 5} more
              </Text>
            )}
          </View>
        )}

        {/* Info Note */}
        <View style={styles.infoNote}>
          <Text style={[styles.infoNoteText, textStyle]}>
            ℹ️ NetGuard Enhanced uses multiple background strategies:
            {'\n\n'}
            🔄 Native Android services for maximum reliability
            {'\n'}
            📱 AlarmManager for scheduled checks
            {'\n'}
            🔋 Battery optimization handling
            {'\n'}
            📡 Automatic recovery and restart mechanisms
          </Text>
        </View>
      </View>

      {/* API Callback Selection Modal */}
      <Modal
        visible={showAPIModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAPIModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: isDarkMode ? '#2a2a2a' : 'white' },
            ]}
          >
            <Text style={[styles.modalTitle, textStyle]}>Select Callback</Text>

            <FlatList
              data={apiCallbackNames}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalItem}
                  onPress={() => loadURLsForCallback(item)}
                >
                  <Text style={[styles.modalItemText, textStyle]}>{item}</Text>
                  <Text style={[styles.modalItemCount, textStyle]}>
                    {apiData.filter(d => d.callback_name === item).length} URLs
                  </Text>
                </TouchableOpacity>
              )}
              style={styles.modalList}
            />

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowAPIModal(false)}
            >
              <Text style={styles.modalCloseButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Service Logs Modal */}
      {showServiceLogs && (
        <Modal
          visible={showServiceLogs}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowServiceLogs(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContent,
                {
                  backgroundColor: isDarkMode ? '#2a2a2a' : 'white',
                  maxHeight: '80%',
                },
              ]}
            >
              <Text
                style={[
                  styles.modalTitle,
                  { color: isDarkMode ? 'white' : 'black' },
                ]}
              >
                Enhanced Service Logs
              </Text>
              <ScrollView style={{ maxHeight: 400 }}>
                {serviceLogs
                  .slice(-50)
                  .reverse()
                  .map((log, index) => (
                    <View
                      key={index}
                      style={{
                        padding: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: '#eee',
                      }}
                    >
                      <Text style={{ fontSize: 10, color: '#666' }}>
                        {log.timestamp}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          color: isDarkMode ? 'white' : 'black',
                        }}
                      >
                        {log.message}
                      </Text>
                      {log.data && (
                        <Text style={{ fontSize: 10, color: '#888' }}>
                          {typeof log.data === 'string'
                            ? log.data
                            : JSON.stringify(log.data)}
                        </Text>
                      )}
                    </View>
                  ))}
              </ScrollView>
              <TouchableOpacity
                style={[styles.modalCloseButton, { marginTop: 10 }]}
                onPress={() => setShowServiceLogs(false)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { marginTop: 10 }]}
                onPress={async () => {
                  await backgroundService.clearServiceLogs();
                  setServiceLogs([]);
                  Alert.alert('Success', 'Service logs cleared');
                }}
              >
                <Text style={styles.buttonText}>Clear Logs</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  lastCheckText: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  serviceActiveCard: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
    borderWidth: 1,
  },
  serviceInactiveCard: {
    backgroundColor: '#FFEBEE',
    borderColor: '#F44336',
    borderWidth: 1,
  },
  serviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  serviceTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  serviceDescription: {
    fontSize: 14,
    opacity: 0.8,
    marginBottom: 4,
  },
  serviceUptime: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 4,
  },
  countdownText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
  },
  lastServiceCheck: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 8,
    textAlign: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  toggleLabel: {
    fontSize: 16,
    flex: 1,
    marginRight: 12,
  },
  toggleDescription: {
    fontSize: 12,
    opacity: 0.7,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  clearText: {
    color: '#F44336',
    fontSize: 14,
    fontWeight: '600',
  },
  networkInfoContainer: {
    marginBottom: 12,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  networkLabel: {
    fontSize: 14,
    fontWeight: '500',
    width: 80,
  },
  networkValue: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectionIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  refreshButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  refreshButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  urlInput: {
    flex: 1,
    marginRight: 8,
  },
  intervalInput: {
    flex: 1,
    marginRight: 8,
  },
  addButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  button: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  checkButton: {
    backgroundColor: '#FF9800',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  checkButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 18,
  },
  debugButton: {
    backgroundColor: '#9C27B0',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  urlItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  urlInfo: {
    flex: 1,
    marginRight: 12,
  },
  urlText: {
    fontSize: 14,
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    textTransform: 'capitalize',
  },
  lastCheckedText: {
    fontSize: 11,
    opacity: 0.7,
  },
  removeText: {
    color: '#F44336',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    marginVertical: 20,
    opacity: 0.6,
  },
  marginTop: {
    marginTop: 12,
  },
  callbackHistory: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
  },
  callbackHistoryTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  callbackHistoryText: {
    fontSize: 12,
    marginBottom: 2,
  },
  androidTips: {
    marginTop: 12,
    padding: 10,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    borderRadius: 8,
  },
  androidTipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  androidTipsText: {
    fontSize: 12,
    opacity: 0.8,
    marginLeft: 12,
    marginTop: 2,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  resultUrl: {
    flex: 1,
    fontSize: 12,
    marginLeft: 8,
  },
  resultTime: {
    fontSize: 10,
    opacity: 0.7,
  },
  moreResults: {
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.6,
    marginTop: 8,
  },
  infoNote: {
    marginTop: 20,
    padding: 12,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    borderRadius: 8,
  },
  infoNoteText: {
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.8,
    lineHeight: 18,
  },
  apiButtonsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  apiButton: {
    backgroundColor: '#9C27B0',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  selectedCallbackText: {
    fontSize: 14,
    marginTop: 8,
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxHeight: '70%',
    borderRadius: 12,
    padding: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalList: {
    maxHeight: 400,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  modalItemText: {
    fontSize: 16,
    flex: 1,
  },
  modalItemCount: {
    fontSize: 14,
    opacity: 0.6,
    marginLeft: 8,
  },
  modalCloseButton: {
    marginTop: 16,
    backgroundColor: '#F44336',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCloseButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default App;
