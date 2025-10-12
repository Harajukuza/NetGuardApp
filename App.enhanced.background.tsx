/**
 * NetGuard Pro - Enhanced with Native Android Background Service
 *
 * Features:
 * - Native Android Foreground Service for true background monitoring
 * - WorkManager integration for periodic tasks
 * - Power Management (Doze Mode, Battery Optimization) handling
 * - Automatic service restart after system kill/reboot
 * - Comprehensive error handling and retry mechanisms
 * - Background service statistics and monitoring
 * - Deep integration with existing React Native background actions
 *
 * This version maintains all existing functionality while adding robust
 * native Android background service capabilities.
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
  Linking,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundJob from 'react-native-background-actions';
import useBackgroundService from './src/hooks/useBackgroundService';

// Constants
const STORAGE_KEYS = {
  URLS: 'urls',
  CALLBACK: 'callback',
  INTERVAL: 'checkInterval',
  LAST_CALLBACK: 'lastCallback',
  LAST_CHECK_TIME: 'lastCheckTime',
  AUTO_CHECK_ENABLED: 'autoCheckEnabled',
  NEXT_CHECK_TIME: 'nextCheckTime',
  API_ENDPOINT: 'apiEndpoint',
  BACKGROUND_STATS: 'backgroundStats',
  SERVICE_STATS: 'serviceStats',
  NATIVE_SERVICE_ENABLED: 'nativeServiceEnabled',
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

const REQUEST_TIMEOUT = 30000; // 30 seconds
const CALLBACK_TIMEOUT = 15000; // 15 seconds

// Debug Mode Detection
const isDebugMode = () => {
  return __DEV__ && typeof atob !== 'undefined';
};

// Enhanced logging for background services
const bgLog = (message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[BG ${timestamp}] ${message}`;

  if (isDebugMode()) {
    console.log(logMessage, data || '');
  }

  // Store logs for later retrieval when debugger is not attached
  AsyncStorage.getItem('bgLogs')
    .then(logs => {
      const parsedLogs = logs ? JSON.parse(logs) : [];
      parsedLogs.push({ timestamp, message, data });
      // Keep only last 100 logs
      if (parsedLogs.length > 100) {
        parsedLogs.shift();
      }
      AsyncStorage.setItem('bgLogs', JSON.stringify(parsedLogs));
    })
    .catch(() => {});
};

// Helper Functions
const logError = async (error: Error, context: string) => {
  console.error(`[${context}] Error:`, error.message);
  try {
    const errorLog = {
      context,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    };
    const existingLogs = await AsyncStorage.getItem('errorLogs');
    const logs = existingLogs ? JSON.parse(existingLogs) : [];
    logs.push(errorLog);
    // Keep only last 50 errors
    if (logs.length > 50) {
      logs.shift();
    }
    await AsyncStorage.setItem('errorLogs', JSON.stringify(logs));
  } catch (logError) {
    console.error('Failed to log error:', logError);
  }
};

const randomSleep = (
  minSeconds: number = 0,
  maxSeconds: number = 30,
): Promise<void> => {
  const randomMs =
    (Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000;
  return new Promise(resolve => setTimeout(resolve, randomMs));
};

const getDeviceInfo = async () => {
  try {
    const deviceId = await DeviceInfo.getUniqueId();
    const deviceModel = DeviceInfo.getModel();
    const deviceBrand = DeviceInfo.getBrand();
    const systemVersion = DeviceInfo.getSystemVersion();
    const systemName = DeviceInfo.getSystemName();

    return {
      id: deviceId,
      model: deviceModel,
      brand: deviceBrand,
      platform: systemName,
      version: systemVersion,
    };
  } catch (error) {
    console.error('Error getting device info:', error);
    return {
      id: 'unknown',
      model: 'unknown',
      brand: 'unknown',
      platform: Platform.OS,
      version: 'unknown',
    };
  }
};

const checkNetworkInfo = async () => {
  try {
    let carrier = 'Unknown';
    let type = 'Unknown';
    let isConnected = true;

    // Get carrier name
    try {
      carrier = await DeviceInfo.getCarrier();
      if (!carrier || carrier === 'unknown' || carrier === '--') {
        carrier = 'No SIM / WiFi Only';
      }
    } catch (error) {
      console.log('Carrier detection error:', error);
      carrier = 'Detection Failed';
    }

    // Basic network type detection
    type = carrier === 'No SIM / WiFi Only' ? 'WiFi' : 'Mobile';

    // Check connectivity
    try {
      const response = await fetch('https://www.google.com/generate_204', {
        method: 'HEAD',
        timeout: 5000,
      } as any);
      isConnected = response.ok || response.status === 204;
    } catch (error) {
      isConnected = false;
    }

    return {
      type,
      carrier,
      isConnected,
    };
  } catch (error) {
    console.error('Error checking network info:', error);
    return {
      type: 'Unknown',
      carrier: 'Unknown',
      isConnected: false,
    };
  }
};

const handlePermissions = async () => {
  if (Platform.OS === 'android') {
    try {
      const permissions = [] as any;
      // Check if permissions are available before adding them
      if ('WAKE_LOCK' in PermissionsAndroid.PERMISSIONS) {
        permissions.push(PermissionsAndroid.PERMISSIONS.WAKE_LOCK);
      }
      if ('FOREGROUND_SERVICE' in PermissionsAndroid.PERMISSIONS) {
        permissions.push(PermissionsAndroid.PERMISSIONS.FOREGROUND_SERVICE);
      }

      // Add POST_NOTIFICATIONS for Android 13+
      if ('POST_NOTIFICATIONS' in PermissionsAndroid.PERMISSIONS) {
        permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
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

const normalizeUrl = (url: string): string => {
  let normalized = url.trim();

  // Remove any leading/trailing whitespace
  normalized = normalized.replace(/^\s+|\s+$/g, '');

  // Add https:// if no protocol is specified
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = 'https://' + normalized;
  }

  // Ensure URL ends without trailing slash for consistency
  normalized = normalized.replace(/\/+$/, '');

  return normalized;
};

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return url.startsWith('http://') || url.startsWith('https://');
  } catch (error) {
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
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  };
  return date.toLocaleString('en-US', options);
};

const getNetworkDisplayText = (networkInfo?: {
  type: string;
  carrier: string;
  isConnected: boolean;
}): string => {
  if (!networkInfo) {
    return 'Unknown';
  }

  const { carrier, type, isConnected } = networkInfo;

  if (!isConnected) {
    return 'No Connection';
  }

  if (type === 'WiFi') {
    return `WiFi (${carrier})`;
  }

  if (carrier && carrier !== 'Unknown' && carrier !== 'Detection Failed') {
    return `${carrier} (${type})`;
  }

  return type;
};

// Error Boundary Component
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Application Error:', error, errorInfo);
    logError(error, 'ErrorBoundary');
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>⚠️ Something went wrong</Text>
          <Text style={styles.errorMessage}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </Text>
          <TouchableOpacity
            style={styles.errorButton}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.errorButtonText}>Restart App</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

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
  isRedirect?: boolean;
  errorType?: 'timeout' | 'network' | 'abort' | 'unknown';
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

interface DetailedCheckResult {
  status: 'active' | 'inactive';
  statusCode?: number;
  statusText?: string;
  isRedirect?: boolean;
  redirectUrl?: string;
  errorType?: 'timeout' | 'network' | 'abort' | 'unknown';
  errorMessage?: string;
}

// Background task configuration
const backgroundTaskOptions = {
  taskName: 'URLMonitorTask',
  taskTitle: '🔍 URL Monitor Active',
  taskDesc: 'Monitoring URLs in background...',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#ff6600',
  linkingURI: 'netguard://monitor',
  parameters: {
    delay: 1000,
  },
};

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar
          barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          backgroundColor={isDarkMode ? '#1a1a1a' : '#f5f5f5'}
        />
        <AppContent />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const isDarkMode = useColorScheme() === 'dark';
  const isInitialMount = useRef(true);
  const appState = useRef(AppState.currentState);
  const backgroundServiceStartTime = useRef<Date | null>(null);
  const lastActivityTime = useRef<Date>(new Date());

  // Native background service hook
  const {
    isServiceRunning: isNativeServiceRunning,
    serviceStats: nativeServiceStats,
    isLoading: isNativeServiceLoading,
    error: nativeServiceError,
    startBackgroundService: startNativeService,
    stopBackgroundService: stopNativeService,
    updateServiceConfig: updateNativeServiceConfig,
    performManualCheck: performNativeManualCheck,
    refreshServiceStatus: refreshNativeServiceStatus,
    requestBatteryOptimization,
    isSupported: isNativeServiceSupported,
  } = useBackgroundService();

  // State management
  const [urls, setUrls] = useState<URLItem[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [callbackConfig, setCallbackConfig] = useState<CallbackConfig>({
    name: '',
    url: '',
  });
  const [checkInterval, setCheckInterval] = useState('60');
  const [isLoading, setIsLoading] = useState(false);
  const [networkInfo, setNetworkInfo] = useState({
    type: 'Unknown',
    carrier: 'Checking...',
    isConnected: true,
  });
  const [lastCallback, setLastCallback] = useState<CallbackHistory | null>(
    null,
  );
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);

  // Service mode selection
  const [useNativeService, setUseNativeService] = useState(true);

  // Background service states (for React Native background-actions fallback)
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(false);
  const [isBackgroundServiceRunning, setIsBackgroundServiceRunning] =
    useState(false);
  const [nextCheckTime, setNextCheckTime] = useState<Date | null>(null);
  const [timeUntilNextCheck, setTimeUntilNextCheck] = useState<string>('');

  // API integration states
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [showAPIModal, setShowAPIModal] = useState(false);
  const [apiData, setApiData] = useState<APIURLItem[]>([]);
  const [apiCallbackNames, setApiCallbackNames] = useState<string[]>([]);
  const [selectedCallbackName, setSelectedCallbackName] = useState<string>('');
  const [isLoadingAPI, setIsLoadingAPI] = useState(false);
  const [debugLogs, setDebugLogs] = useState<any[]>([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  // Background check stats
  const [backgroundCheckCount, setBackgroundCheckCount] = useState(0);

  // Computed values
  const effectiveServiceRunning = useNativeService
    ? isNativeServiceRunning
    : isBackgroundServiceRunning;

  const effectiveServiceStats = useNativeService && nativeServiceStats
    ? {
        isRunning: nativeServiceStats.isRunning,
        startTime: nativeServiceStats.startTime ? new Date(nativeServiceStats.startTime) : null,
        totalChecks: nativeServiceStats.totalChecks,
        lastCheckTime: nativeServiceStats.lastCheckTime ? new Date(nativeServiceStats.lastCheckTime) : null,
        totalUptime: nativeServiceStats.uptime || 0,
        successfulCallbacks: nativeServiceStats.successfulCallbacks,
        failedCallbacks: nativeServiceStats.failedCallbacks,
      }
    : null;

  // Memoized values for performance
  const sortedUrls = useMemo(() => {
    return [...urls].sort((a, b) => {
      const statusOrder = { checking: 0, inactive: 1, active: 2 };
      const aOrder = statusOrder[a.status || 'checking'];
      const bOrder = statusOrder[b.status || 'checking'];
      return aOrder - bOrder;
    });
  }, [urls]);

  // Initialize app
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await loadSavedData();
        const networkInfo = await checkNetworkInfo();
        setNetworkInfo(networkInfo);
        await handlePermissions();
        await loadBackgroundStats();

        // Check for native service support and preference
        const nativeServicePref = await AsyncStorage.getItem(STORAGE_KEYS.NATIVE_SERVICE_ENABLED);
        if (nativeServicePref !== null) {
          setUseNativeService(JSON.parse(nativeServicePref));
        }

        // Initialize native service status
        if (isNativeServiceSupported) {
          await refreshNativeServiceStatus();
        }
      } catch (error: any) {
        console.error('App initialization error:', error);
        await logError(error, 'initializeApp');
      }
    };

    initializeApp();

    // Handle back button on Android
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (effectiveServiceRunning) {
          Alert.alert(
            'Background Service Running',
            'URL monitoring is active in background. Exit anyway?',
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
  }, [effectiveServiceRunning, isNativeServiceSupported]);

  // Handle app state changes
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
          console.log('App returned to foreground');
          loadBackgroundStats();

          if (isNativeServiceSupported) {
            refreshNativeServiceStatus();
          }

          // Check if we missed any scheduled checks (for RN background-actions)
          if (!useNativeService && autoCheckEnabled && nextCheckTime) {
            const now = new Date();
            if (now >= nextCheckTime) {
              console.log('Missed scheduled check, running now');
              // Trigger manual check
              const intervalMinutes = parseInt(checkInterval, 10);
              const newNext = new Date(now.getTime() + intervalMinutes * 60000);
              setNextCheckTime(newNext);
            }
          }
        }

        appState.current = nextAppState;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [useNativeService, autoCheckEnabled, nextCheckTime, checkInterval, isNativeServiceSupported]);

  // Save native service preference
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.NATIVE_SERVICE_ENABLED, JSON.stringify(useNativeService))
      .catch(error => console.error('Failed to save native service preference:', error));
  }, [useNativeService]);

  // Save URLs when they change (but not on initial load)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const saveTimer = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.URLS, JSON.stringify(urls));
        await AsyncStorage.setItem(STORAGE_KEYS.INTERVAL, checkInterval);
        await AsyncStorage.setItem(
          STORAGE_KEYS.AUTO_CHECK_ENABLED,
          JSON.stringify(autoCheckEnabled),
        );
        if (lastCheckTime) {
          await AsyncStorage.setItem(
            STORAGE_KEYS.LAST_CHECK_TIME,
            lastCheckTime.toISOString(),
          );
        }
        if (nextCheckTime) {
          await AsyncStorage.setItem(
            STORAGE_KEYS.NEXT_CHECK_TIME,
            nextCheckTime.toISOString(),
          );
        }
        if (apiEndpoint) {
          await AsyncStorage.setItem(STORAGE_KEYS.API_ENDPOINT, apiEndpoint);
        }
      } catch (error: any) {
        console.error('Error saving data:', error);
        await logError(error, 'saveData');
      }
    }, 500);

    return () => clearTimeout(saveTimer);
  }, [
    urls,
    checkInterval,
    lastCheckTime,
    autoCheckEnabled,
    nextCheckTime,
    apiEndpoint,
  ]);

  // Save last callback history
  useEffect(() => {
    if (lastCallback) {
      AsyncStorage.setItem(
        STORAGE_KEYS.LAST_CALLBACK,
        JSON.stringify(lastCallback),
      ).catch(error => console.error('Error saving last callback:', error));
    }
  }, [lastCallback]);

  // Load saved data from AsyncStorage
  const loadSavedData = async () => {
    try {
      const [
        savedUrls,
        savedCallback,
        savedInterval,
        savedLastCallback,
        savedLastCheck,
        savedAutoCheck,
        savedNextCheck,
        savedApiEndpoint,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.URLS),
        AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
        AsyncStorage.getItem(STORAGE_KEYS.INTERVAL),
        AsyncStorage.getItem(STORAGE_KEYS.LAST_CALLBACK),
        AsyncStorage.getItem(STORAGE_KEYS.LAST_CHECK_TIME),
        AsyncStorage.getItem(STORAGE_KEYS.AUTO_CHECK_ENABLED),
        AsyncStorage.getItem(STORAGE_KEYS.NEXT_CHECK_TIME),
        AsyncStorage.getItem(STORAGE_KEYS.API_ENDPOINT),
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

      if (savedCallback) {
        setCallbackConfig(JSON.parse(savedCallback));
      }

      if (savedInterval) {
        setCheckInterval(savedInterval);
      }

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

      if (savedAutoCheck) {
        setAutoCheckEnabled(JSON.parse(savedAutoCheck));
      }

      if (savedNextCheck) {
        const nextCheck = new Date(savedNextCheck);
        if (nextCheck > new Date()) {
          setNextCheckTime(nextCheck);
        }
      }

      if (savedApiEndpoint) {
        setApiEndpoint(savedApiEndpoint);
      }
    } catch (error) {
      console.error('Error loading saved data:', error);
    }
  };

  // Load background stats
  const loadBackgroundStats = async () => {
    try {
      const stats = await AsyncStorage.getItem(STORAGE_KEYS.BACKGROUND_STATS);
      if (stats) {
        setBackgroundCheckCount(parseInt(stats, 10) || 0);
      }
    } catch (error: any) {
      console.error('Error loading background stats:', error);
      await logError(error, 'loadBackgroundStats');
    }
  };

  // Network info refresh
  const refreshNetworkInfo = async () => {
    const networkInfo = await checkNetworkInfo();
    setNetworkInfo(networkInfo);
  };

  // Start background service (unified)
  const startBackgroundService = async () => {
    if (urls.length === 0) {
      Alert.alert('No URLs', 'Please add URLs to monitor first');
      return;
    }

    const intervalMinutes = parseInt(checkInterval, 10);

    if (useNativeService && isNativeServiceSupported) {
      // Use native Android service
      try {
        const success = await startNativeService(urls, callbackConfig, intervalMinutes);
        if (success) {
          Alert.alert(
            'Native Service Started',
            `Native Android service is now monitoring ${urls.length} URLs every ${intervalMinutes} minutes.\n\n` +
            '🔄 True background monitoring active\n' +
            '📱 Persistent notification visible\n' +
            '🔋 Optimized for battery efficiency\n' +
            '🚀 Works even when app is closed',
            [{ text: 'OK' }],
          );
        }
      } catch (error: any) {
        console.error('Failed to start native service:', error);
        Alert.alert('Error', `Failed to start native service: ${error.message}`);
      }
    } else {
      // Fallback to React Native background-actions
      try {
        if (BackgroundJob.isRunning()) {
          console.log('Background service already running');
          return;
        }

        console.log('Starting React Native background service...');

        const options = {
          ...backgroundTaskOptions,
          parameters: {
            ...backgroundTaskOptions.parameters,
            interval: intervalMinutes,
          },
        };

        await BackgroundJob.start(backgroundTask, options);
        setIsBackgroundServiceRunning(true);
        backgroundServiceStartTime.current = new Date();

        Alert.alert(
          'Background Service Started',
          `URLs will be monitored every ${checkInterval} minutes in background using React Native background actions.\n\n` +
          'Note: For more reliable monitoring, consider using Native Service mode.',
          [{ text: 'OK' }],
        );
      } catch (error: any) {
        console.error('Failed to start background service:', error);
        Alert.alert('Error', 'Failed to start background service');
      }
    }
  };

  // Stop background service (unified)
  const stopBackgroundService = async () => {
    if (useNativeService && isNativeServiceSupported) {
      // Stop native service
      try {
        const success = await stopNativeService();
        if (success) {
          Alert.alert(
            'Native Service Stopped',
            'Native Android background service has been stopped.',
          );
        }
      } catch (error: any) {
        console.error('Failed to stop native service:', error);
        Alert.alert('Error', `Failed to stop native service: ${error.message}`);
      }
    } else {
      // Stop React Native background-actions service
      try {
        console.log('Stopping React Native background service...');
        await BackgroundJob.stop();
        setIsBackgroundServiceRunning(false);
        backgroundServiceStartTime.current = null;

        Alert.alert(
          'Background Service Stopped',
          'React Native background service has been stopped.',
        );
      } catch (error: any) {
        console.error('Failed to stop background service:', error);
        Alert.alert('Error', 'Failed to stop background service');
      }
    }
  };

  // Toggle background service
  const toggleBackgroundService = async (enable: boolean) => {
    if (enable) {
      await startBackgroundService();
    } else {
      await stopBackgroundService();
    }
  };

  // Enhanced URL checking with retry
  const checkUrlWithRetry = async (
    url: string,
    maxRetries: number = 2,
  ): Promise<DetailedCheckResult>
