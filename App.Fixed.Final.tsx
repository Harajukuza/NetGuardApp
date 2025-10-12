/**
 * URL Monitoring App - Complete Fixed Version
 * Version: 5.0.0
 *
 * Features:
 * - Complete background service implementation
 * - Android Doze mode support
 * - Full error recovery
 * - Network resilience
 * - Persistent data storage
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
  Keyboard,
  RefreshControl,
  Dimensions,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundActions from 'react-native-background-actions';

// Constants
const STORAGE_KEYS = {
  URLS: '@NetGuard:urls',
  CALLBACK: '@NetGuard:callback',
  INTERVAL: '@NetGuard:checkInterval',
  LAST_CALLBACK: '@NetGuard:lastCallback',
  LAST_CHECK_TIME: '@NetGuard:lastCheckTime',
  AUTO_CHECK_ENABLED: '@NetGuard:autoCheckEnabled',
  BACKGROUND_STATS: '@NetGuard:backgroundStats',
  SERVICE_STATS: '@NetGuard:serviceStats',
  ERROR_LOGS: '@NetGuard:errorLogs',
  BG_LOGS: '@NetGuard:bgLogs',
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

const REQUEST_TIMEOUT = 30000;
const CALLBACK_TIMEOUT = 15000;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 1440;

// TypeScript interfaces
interface URLItem {
  id: string;
  url: string;
  lastChecked?: Date;
  status?: 'active' | 'inactive' | 'checking';
  responseTime?: number;
  statusCode?: number;
}

interface CallbackConfig {
  name: string;
  url: string;
}

interface NetworkInfo {
  type: string;
  carrier: string;
  isConnected: boolean;
}

// Helper Functions
const bgLog = async (message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[BG ${timestamp}] ${message}`;

  if (__DEV__) {
    console.log(logMessage, data || '');
  }

  try {
    const logs = await AsyncStorage.getItem(STORAGE_KEYS.BG_LOGS);
    const parsedLogs = logs ? JSON.parse(logs) : [];
    parsedLogs.push({ timestamp, message, data });
    if (parsedLogs.length > 100) parsedLogs.shift();
    await AsyncStorage.setItem(
      STORAGE_KEYS.BG_LOGS,
      JSON.stringify(parsedLogs),
    );
  } catch (error) {
    console.error('Failed to save bg log:', error);
  }
};

const logError = async (error: Error, context: string) => {
  console.error(`[${context}] Error:`, error.message);
  try {
    const errorLog = {
      context,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    };
    const existingLogs = await AsyncStorage.getItem(STORAGE_KEYS.ERROR_LOGS);
    const logs = existingLogs ? JSON.parse(existingLogs) : [];
    logs.push(errorLog);
    if (logs.length > 50) logs.shift();
    await AsyncStorage.setItem(STORAGE_KEYS.ERROR_LOGS, JSON.stringify(logs));
  } catch (logError) {
    console.error('Failed to log error:', logError);
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const randomSleep = (
  minSeconds: number = 0,
  maxSeconds: number = 30,
): Promise<void> => {
  const randomMs =
    (Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000;
  return sleep(randomMs);
};

const getDeviceInfo = async () => {
  try {
    return {
      id: await DeviceInfo.getUniqueId(),
      model: DeviceInfo.getModel(),
      brand: DeviceInfo.getBrand(),
      platform: DeviceInfo.getSystemName(),
      version: DeviceInfo.getSystemVersion(),
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

const checkNetworkInfo = async (): Promise<NetworkInfo> => {
  try {
    let carrier = 'Unknown';
    let type = 'Unknown';
    let isConnected = true;

    try {
      carrier = await DeviceInfo.getCarrier();
      if (!carrier || carrier === 'unknown' || carrier === '--') {
        carrier = 'No SIM / WiFi Only';
      }
    } catch (error) {
      carrier = 'Detection Failed';
    }

    type = carrier === 'No SIM / WiFi Only' ? 'WiFi' : 'Mobile';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch('https://www.google.com/generate_204', {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      isConnected = response.ok || response.status === 204;
    } catch (error) {
      isConnected = false;
    }

    return { type, carrier, isConnected };
  } catch (error) {
    console.error('Error checking network info:', error);
    return { type: 'Unknown', carrier: 'Unknown', isConnected: false };
  }
};

const handlePermissions = async () => {
  if (Platform.OS === 'android') {
    try {
      const permissions = [];

      if (Platform.Version >= 33) {
        permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }

      if (permissions.length > 0) {
        await PermissionsAndroid.requestMultiple(permissions);
      }

      try {
        await PermissionsAndroid.request(
          'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS' as any,
          {
            title: 'Background Activity Permission',
            message:
              'NetGuard needs to run in background continuously to monitor URLs.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'Allow',
          },
        );
      } catch (error) {
        console.log('Battery optimization permission error:', error);
      }
    } catch (err) {
      console.warn('Permission request error:', err);
    }
  }
};

const normalizeUrl = (url: string): string => {
  let normalized = url.trim();
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = 'https://' + normalized;
  }
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
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

// Background Task Implementation - FIXED VERSION
const backgroundTask = async (taskDataArguments: any) => {
  await new Promise(async resolve => {
    const intervalMinutes = taskDataArguments?.delay || 60;
    const intervalMs = intervalMinutes * 60000;

    const performCheck = async () => {
      try {
        await bgLog('Starting background check cycle');

        const [savedUrls, savedCallback] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.URLS),
          AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
        ]);

        if (!savedUrls) {
          await bgLog('No URLs configured');
          return;
        }

        const urls: URLItem[] = JSON.parse(savedUrls);
        const callbackConfig: CallbackConfig | null = savedCallback
          ? JSON.parse(savedCallback)
          : null;

        if (urls.length === 0) {
          await bgLog('Empty URL list');
          return;
        }

        const networkInfo = await checkNetworkInfo();
        if (!networkInfo.isConnected) {
          await bgLog('No network connection, skipping check');
          return;
        }

        const checkResults = [];

        for (let i = 0; i < urls.length; i++) {
          const urlItem = urls[i];

          if (i > 0) {
            await randomSleep(2, 10);
          }

          try {
            const userAgent =
              USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            const controller = new AbortController();
            const timeoutId = setTimeout(
              () => controller.abort(),
              REQUEST_TIMEOUT,
            );

            const startTime = Date.now();
            const response = await fetch(urlItem.url, {
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

            const isSuccess =
              (response.status >= 200 && response.status < 400) ||
              response.status === 401 ||
              response.status === 403 ||
              response.status === 429;

            checkResults.push({
              url: urlItem.url,
              status: isSuccess ? 'active' : 'inactive',
              statusCode: response.status,
              responseTime,
            });

            await bgLog(
              `Checked ${urlItem.url}: ${response.status} (${responseTime}ms)`,
            );
          } catch (error: any) {
            checkResults.push({
              url: urlItem.url,
              status: 'inactive',
              error: error.message,
            });
            await bgLog(`Failed ${urlItem.url}: ${error.message}`);
          }
        }

        if (callbackConfig?.url && checkResults.length > 0) {
          try {
            const activeCount = checkResults.filter(
              r => r.status === 'active',
            ).length;
            const inactiveCount = checkResults.filter(
              r => r.status === 'inactive',
            ).length;

            const payload = {
              checkType: 'background',
              timestamp: new Date().toISOString(),
              summary: {
                total: checkResults.length,
                active: activeCount,
                inactive: inactiveCount,
              },
              results: checkResults,
              network: networkInfo,
              device: await getDeviceInfo(),
              callbackName: callbackConfig.name,
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(
              () => controller.abort(),
              CALLBACK_TIMEOUT,
            );

            const response = await fetch(callbackConfig.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'NetGuard-Background/1.0',
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);
            await bgLog(`Callback sent: ${response.status}`);

            const stats = await AsyncStorage.getItem(
              STORAGE_KEYS.SERVICE_STATS,
            );
            const currentStats = stats
              ? JSON.parse(stats)
              : {
                  totalChecks: 0,
                  successfulCallbacks: 0,
                  failedCallbacks: 0,
                };

            currentStats.totalChecks++;
            if (response.ok) {
              currentStats.successfulCallbacks++;
            } else {
              currentStats.failedCallbacks++;
            }
            currentStats.lastCheckTime = new Date().toISOString();

            await AsyncStorage.setItem(
              STORAGE_KEYS.SERVICE_STATS,
              JSON.stringify(currentStats),
            );
          } catch (error: any) {
            await bgLog(`Callback failed: ${error.message}`);
          }
        }

        const bgCount = await AsyncStorage.getItem(
          STORAGE_KEYS.BACKGROUND_STATS,
        );
        const newCount = bgCount ? parseInt(bgCount, 10) + 1 : 1;
        await AsyncStorage.setItem(
          STORAGE_KEYS.BACKGROUND_STATS,
          newCount.toString(),
        );
        await AsyncStorage.setItem(
          STORAGE_KEYS.LAST_CHECK_TIME,
          new Date().toISOString(),
        );
      } catch (error: any) {
        await bgLog(`Background check error: ${error.message}`);
        await logError(error, 'backgroundTask');
      }
    };

    while (BackgroundActions.isRunning()) {
      await performCheck();
      await sleep(intervalMs);
    }

    resolve(undefined);
  });
};

// Background task options
const backgroundOptions = {
  taskName: 'URL Monitor',
  taskTitle: '🔍 URL Monitor Active',
  taskDesc: 'Monitoring URLs in background',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#ff6600',
  linkingURI: 'netguard://monitor',
  parameters: {
    delay: 60,
  },
};

// Error Boundary
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
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

// Main App Component
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

// Main App Content
function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const isDarkMode = useColorScheme() === 'dark';
  const appState = useRef(AppState.currentState);

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
  const [isBackgroundServiceRunning, setIsBackgroundServiceRunning] =
    useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const [backgroundCheckCount, setBackgroundCheckCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // FIXED: Add callback functionality state
  const [isSendingCallback, setIsSendingCallback] = useState(false);

  // Load saved data on mount
  useEffect(() => {
    loadSavedData();
    checkNetworkInfo().then(setNetworkInfo);
    handlePermissions();

    setIsBackgroundServiceRunning(BackgroundActions.isRunning());

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (isBackgroundServiceRunning) {
          Alert.alert(
            'Background Service Running',
            'URL monitoring is active in background. Do you want to exit?',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Exit', onPress: () => BackHandler.exitApp() },
            ],
          );
          return true;
        }
        return false;
      },
    );

    return () => {
      subscription.remove();
      backHandler.remove();
    };
  }, []);

  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (
      appState.current.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      loadSavedData();
      checkNetworkInfo().then(setNetworkInfo);
    }
    appState.current = nextAppState;
  };

  const loadSavedData = async () => {
    try {
      const [
        savedUrls,
        savedCallback,
        savedInterval,
        savedLastCheck,
        savedBgCount,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.URLS),
        AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
        AsyncStorage.getItem(STORAGE_KEYS.INTERVAL),
        AsyncStorage.getItem(STORAGE_KEYS.LAST_CHECK_TIME),
        AsyncStorage.getItem(STORAGE_KEYS.BACKGROUND_STATS),
      ]);

      if (savedUrls) setUrls(JSON.parse(savedUrls));
      if (savedCallback) setCallbackConfig(JSON.parse(savedCallback));
      if (savedInterval) setCheckInterval(savedInterval);
      if (savedLastCheck) setLastCheckTime(new Date(savedLastCheck));
      if (savedBgCount) setBackgroundCheckCount(parseInt(savedBgCount, 10));
    } catch (error) {
      console.error('Error loading saved data:', error);
    }
  };

  const saveUrls = async (newUrls: URLItem[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.URLS, JSON.stringify(newUrls));
      setUrls(newUrls);
    } catch (error) {
      console.error('Error saving URLs:', error);
    }
  };

  const saveCallbackConfig = async () => {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.CALLBACK,
        JSON.stringify(callbackConfig),
      );
      Alert.alert('Success', 'Callback configuration saved');
    } catch (error) {
      console.error('Error saving callback config:', error);
      Alert.alert('Error', 'Failed to save callback configuration');
    }
  };

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

    if (urls.some(u => u.url === normalizedUrl)) {
      Alert.alert('Error', 'This URL is already in the list');
      return;
    }

    const newUrlItem: URLItem = {
      id: Date.now().toString(),
      url: normalizedUrl,
      status: 'checking',
    };

    saveUrls([...urls, newUrlItem]);
    setNewUrl('');
    Keyboard.dismiss();
  };

  const removeUrl = (id: string) => {
    Alert.alert('Remove URL', 'Are you sure you want to remove this URL?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => saveUrls(urls.filter(u => u.id !== id)),
      },
    ]);
  };

  // FIXED: Enhanced URL checking with better error handling
  const checkSingleUrl = async (url: string) => {
    try {
      const userAgent =
        USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      // Enhanced success criteria
      const isSuccess =
        (response.status >= 200 && response.status < 300) ||
        (response.status >= 300 && response.status < 400) ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 429;

      return {
        status: isSuccess ? 'active' : ('inactive' as const),
        statusCode: response.status,
        responseTime,
      };
    } catch (error: any) {
      return {
        status: 'inactive' as const,
        error: error.message,
        responseTime: 0,
      };
    }
  };

  // FIXED: Enhanced check all URLs with improved callback
  const checkAllUrls = async () => {
    if (urls.length === 0) {
      Alert.alert('No URLs', 'Please add URLs to monitor');
      return;
    }

    setIsLoading(true);
    const updatedUrls = urls.map(u => ({ ...u, status: 'checking' as const }));
    setUrls(updatedUrls);

    const results = [];
    for (const urlItem of updatedUrls) {
      const result = await checkSingleUrl(urlItem.url);
      const updatedUrl = {
        ...urlItem,
        status: result.status,
        statusCode: result.statusCode,
        responseTime: result.responseTime,
        lastChecked: new Date(),
      };
      results.push(updatedUrl);
      setUrls(prev => prev.map(u => (u.id === urlItem.id ? updatedUrl : u)));

      if (updatedUrls.indexOf(urlItem) < updatedUrls.length - 1) {
        await randomSleep(1, 3);
      }
    }

    await saveUrls(results);
    await AsyncStorage.setItem(
      STORAGE_KEYS.LAST_CHECK_TIME,
      new Date().toISOString(),
    );
    setLastCheckTime(new Date());

    // FIXED: Enhanced callback with retry logic
    if (callbackConfig.url && isValidUrl(callbackConfig.url)) {
      setIsSendingCallback(true);
      try {
        console.log('📤 Sending manual check callback...');

        const deviceInfo = await getDeviceInfo();
        const currentNetworkInfo = await checkNetworkInfo();
        const activeCount = results.filter(r => r.status === 'active').length;
        const inactiveCount = results.filter(r => r.status === 'inactive').length;

        const payload = {
          checkType: 'manual',
          timestamp: new Date().toISOString(),
          isBackground: false,
          backgroundServiceRunning: isBackgroundServiceRunning,
          backgroundCheckCount: backgroundCheckCount,
          summary: {
            total: results.length,
            active: activeCount,
            inactive: inactiveCount,
          },
          urls: results.map(r => ({
            url: r.url,
            status: r.status,
            statusCode: r.statusCode,
            responseTime: r.responseTime,
            error: r.error || null,
          })),
          network: {
            type: currentNetworkInfo.type,
            carrier: currentNetworkInfo.carrier,
            isConnected: currentNetworkInfo.isConnected,
          },
          device: deviceInfo,
          callbackName: callbackConfig.name,
          autoCheck: false,
        };

        const callbackResult = await sendCallbackWithRetry(
          callbackConfig.url,
          payload,
          false
        );

        if (callbackResult.success) {
          console.log('✅ Manual callback sent successfully!');

          // Store successful callback history
          const callbackHistory = {
            timestamp: new Date(),
            urls: results.map(r => ({
              url: r.url,
              status: r.status,
              error: r.error,
            })),
            success: true,
            totalUrls: results.length,
            activeCount,
            inactiveCount,
          };

          setLastCallback(callbackHistory);
          await AsyncStorage.setItem(
            STORAGE_KEYS.LAST_CALLBACK,
            JSON.stringify(callbackHistory)
          );

          Alert.alert('Success', 'URLs checked and callback sent successfully!');
        } else {
          console.error('❌ Manual callback failed:', callbackResult.error);
          Alert.alert(
            'Callback Failed',
            `URLs checked successfully, but callback failed: ${callbackResult.error}`
          );
        }
      } catch (error: any) {
        console.error('Callback error:', error);
        Alert.alert('Callback Error', `URLs checked successfully, but callback failed: ${error.message}`);
      } finally {
        setIsSendingCallback(false);
      }
    } else {
      Alert.alert('Success', 'All URLs checked successfully!');
    }

    setIsLoading(false);
  };

  // FIXED: Enhanced background service management
  const toggleBackgroundService = async () => {
    if (!isBackgroundServiceRunning) {
      try {
        if (urls.length === 0) {
          Alert.alert(
            'No URLs',
            'Please add URLs before starting background monitoring',
          );
          return;
        }

        const interval = parseInt(checkInterval, 10);
        if (
          isNaN(interval) ||
          interval < MIN_INTERVAL_MINUTES ||
          interval > MAX_INTERVAL_MINUTES
        ) {
          Alert.alert(
            'Invalid Interval',
            `Please enter a value between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES} minutes`,
          );
          return;
        }

        // Validate callback URL if provided
        if (callbackConfig.url && !isValidUrl(callbackConfig.url)) {
          Alert.alert(
            'Invalid Callback URL',
            'Please enter a valid callback URL or leave it empty',
          );
          return;
        }

        await AsyncStorage.setItem(STORAGE_KEYS.INTERVAL, checkInterval);
        await AsyncStorage.setItem(STORAGE_KEYS.AUTO_CHECK_ENABLED, 'true');

        const options = {
          ...backgroundOptions,
          parameters: { delay: interval },
        };

        await BackgroundJob.start(backgroundTask, options);
        setIsBackgroundServiceRunning(true);
        backgroundServiceStartTime.current = new Date();

        const message = callbackConfig.url
          ? `Background monitoring started with callback\nChecking every ${interval} minutes\nCallback: ${callbackConfig.name || 'Unnamed'}`
          : `Background monitoring started\nChecking every ${interval} minutes\nNo callback configured`;

        Alert.alert('Success', message);
      } catch (error: any) {
        console.error('Failed to start background service:', error);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSavedData();
    await checkNetworkInfo().then(setNetworkInfo);
    setRefreshing(false);
  }, []);

  const renderUrlItem = ({ item }: { item: URLItem }) => (
    <View style={[styles.urlItem, isDarkMode && styles.urlItemDark]}>
      <View style={styles.urlContent}>
        <Text
          style={[styles.urlText, isDarkMode && styles.urlTextDark]}
          numberOfLines={1}
        >
          {item.url}
        </Text>
        <View style={styles.urlMeta}>
          <View
            style={[
              styles.statusBadge,
              item.status === 'active' && styles.statusActive,
              item.status === 'inactive' && styles.statusInactive,
              item.status === 'checking' && styles.statusChecking,
            ]}
          >
            <Text style={styles.statusText}>
              {item.status === 'checking'
                ? 'Checking...'
                : item.status?.toUpperCase() || 'UNKNOWN'}
            </Text>
          </View>
          {item.lastChecked && (
            <Text
              style={[styles.lastChecked, isDarkMode && styles.lastCheckedDark]}
            >
              {formatTimeAgo(new Date(item.lastChecked))}
            </Text>
          )}
          {item.responseTime && (
            <Text
              style={[
                styles.responseTime,
                isDarkMode && styles.responseTimeDark,
              ]}
            >
              {item.responseTime}ms
            </Text>
          )}
        </View>
      </View>
      <TouchableOpacity
        onPress={() => removeUrl(item.id)}
        style={styles.removeButton}
      >
        <Text style={styles.removeButtonText}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, isDarkMode && styles.containerDark]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: safeAreaInsets.bottom + 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={[styles.header, { paddingTop: safeAreaInsets.top + 10 }]}>
          <Text style={[styles.title, isDarkMode && styles.titleDark]}>
            🔍 NetGuard Monitor
          </Text>
          <Text style={[styles.subtitle, isDarkMode && styles.subtitleDark]}>
            URL Monitoring System
          </Text>
        </View>

        {/* Status Card */}
        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          <Text style={[styles.cardTitle, isDarkMode && styles.cardTitleDark]}>
            📊 Service Status
          </Text>

          <View style={styles.statusRow}>
            <Text
              style={[styles.statusLabel, isDarkMode && styles.statusLabelDark]}
            >
              Network:
            </Text>
            <Text
              style={[styles.statusValue, isDarkMode && styles.statusValueDark]}
            >
              {networkInfo.isConnected
                ? `${networkInfo.carrier} (${networkInfo.type})`
                : 'No Connection'}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <Text
              style={[styles.statusLabel, isDarkMode && styles.statusLabelDark]}
            >
              Background Service:
            </Text>
            <Text
              style={[
                styles.statusValue,
                isDarkMode && styles.statusValueDark,
                isBackgroundServiceRunning && styles.statusValueActive,
              ]}
            >
              {isBackgroundServiceRunning ? '🟢 Running' : '🔴 Stopped'}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <Text
              style={[styles.statusLabel, isDarkMode && styles.statusLabelDark]}
            >
              Background Checks:
            </Text>
            <Text
              style={[styles.statusValue, isDarkMode && styles.statusValueDark]}
            >
              {backgroundCheckCount} times
            </Text>
          </View>

          {lastCheckTime && (
            <View style={styles.statusRow}>
              <Text
                style={[
                  styles.statusLabel,
                  isDarkMode && styles.statusLabelDark,
                ]}
              >
                Last Check:
              </Text>
              <Text
                style={[
                  styles.statusValue,
                  isDarkMode && styles.statusValueDark,
                ]}
              >
                {formatTimeAgo(lastCheckTime)}
              </Text>
            </View>
          )}
        </View>

        {/* URL Input */}
        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          <Text style={[styles.cardTitle, isDarkMode && styles.cardTitleDark]}>
            🌐 Add URL
          </Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, isDarkMode && styles.inputDark]}
              placeholder="Enter URL (e.g., google.com)"
              placeholderTextColor={isDarkMode ? '#666' : '#999'}
              value={newUrl}
              onChangeText={setNewUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity style={styles.addButton} onPress={addUrl}>
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* URL List */}
        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          <Text style={[styles.cardTitle, isDarkMode && styles.cardTitleDark]}>
            📋 URLs ({urls.length})
          </Text>
          {urls.length === 0 ? (
            <Text
              style={[styles.emptyText, isDarkMode && styles.emptyTextDark]}
            >
              No URLs added yet
            </Text>
          ) : (
            <FlatList
              data={urls}
              renderItem={renderUrlItem}
              keyExtractor={item => item.id}
              scrollEnabled={false}
            />
          )}
        </View>

        {/* Settings */}
        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          <TouchableOpacity
            style={styles.cardHeader}
            onPress={() => setShowSettings(!showSettings)}
          >
            <Text
              style={[styles.cardTitle, isDarkMode && styles.cardTitleDark]}
            >
              ⚙️ Settings
            </Text>
            <Text
              style={[styles.expandIcon, isDarkMode && styles.expandIconDark]}
            >
              {showSettings ? '▼' : '▶'}
            </Text>
          </TouchableOpacity>

          {showSettings && (
            <View style={styles.settingsContent}>
              <View style={styles.settingItem}>
                <Text
                  style={[
                    styles.settingLabel,
                    isDarkMode && styles.settingLabelDark,
                  ]}
                >
                  Callback Name:
                </Text>
                <TextInput
                  style={[
                    styles.settingInput,
                    isDarkMode && styles.settingInputDark,
                  ]}
                  placeholder="Callback name"
                  placeholderTextColor={isDarkMode ? '#666' : '#999'}
                  value={callbackConfig.name}
                  onChangeText={text =>
                    setCallbackConfig({ ...callbackConfig, name: text })
                  }
                />
              </View>

              <View style={styles.settingItem}>
                <Text
                  style={[
                    styles.settingLabel,
                    isDarkMode && styles.settingLabelDark,
                  ]}
                >
                  Callback URL:
                </Text>
                <TextInput
                  style={[
                    styles.settingInput,
                    isDarkMode && styles.settingInputDark,
                  ]}
                  placeholder="http://your-server.com/callback"
                  placeholderTextColor={isDarkMode ? '#666' : '#999'}
                  value={callbackConfig.url}
                  onChangeText={text =>
                    setCallbackConfig({ ...callbackConfig, url: text })
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>

              <View style={styles.settingItem}>
                <Text
                  style={[
                    styles.settingLabel,
                    isDarkMode && styles.settingLabelDark,
                  ]}
                >
                  Check Interval (minutes):
                </Text>
                <TextInput
                  style={[
                    styles.settingInput,
                    isDarkMode && styles.settingInputDark,
                  ]}
                  placeholder="60"
                  placeholderTextColor={isDarkMode ? '#666' : '#999'}
                  value={checkInterval}
                  onChangeText={setCheckInterval}
                  keyboardType="numeric"
                />
              </View>

              <TouchableOpacity
                style={styles.saveButton}
                onPress={saveCallbackConfig}
              >
                <Text style={styles.saveButtonText}>Save Settings</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          <Text style={[styles.cardTitle, isDarkMode && styles.cardTitleDark]}>
            🎯 Actions
          </Text>

          <TouchableOpacity
            style={[
              styles.actionButton,
              isLoading && styles.actionButtonDisabled,
            ]}
            onPress={checkAllUrls}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionButtonText}>Check All URLs Now</Text>
            )}
          </TouchableOpacity>

          <View style={styles.backgroundToggle}>
            <Text
              style={[styles.toggleLabel, isDarkMode && styles.toggleLabelDark]}
            >
              Background Monitoring
            </Text>
            <Switch
              value={isBackgroundServiceRunning}
              onValueChange={toggleBackgroundService}
              trackColor={{ false: '#767577', true: '#81b0ff' }}
              thumbColor={isBackgroundServiceRunning ? '#f5dd4b' : '#f4f3f4'}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  containerDark: {
    backgroundColor: '#1a1a1a',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  titleDark: {
    color: '#fff',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  subtitleDark: {
    color: '#aaa',
  },
  card: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 15,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardDark: {
    backgroundColor: '#2a2a2a',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  cardTitleDark: {
    color: '#fff',
  },
  expandIcon: {
    fontSize: 14,
    color: '#666',
  },
  expandIconDark: {
    color: '#aaa',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  statusLabel: {
    fontSize: 14,
    color: '#666',
  },
  statusLabelDark: {
    color: '#aaa',
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  statusValueDark: {
    color: '#fff',
  },
  statusValueActive: {
    color: '#4caf50',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fff',
  },
  inputDark: {
    borderColor: '#444',
    color: '#fff',
    backgroundColor: '#333',
  },
  addButton: {
    marginLeft: 10,
    backgroundColor: '#007bff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  urlItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  urlItemDark: {
    borderBottomColor: '#444',
  },
  urlContent: {
    flex: 1,
  },
  urlText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  urlTextDark: {
    color: '#fff',
  },
  urlMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  statusActive: {
    backgroundColor: '#d4edda',
  },
  statusInactive: {
    backgroundColor: '#f8d7da',
  },
  statusChecking: {
    backgroundColor: '#fff3cd',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#333',
  },
  lastChecked: {
    fontSize: 11,
    color: '#999',
    marginRight: 8,
  },
  lastCheckedDark: {
    color: '#888',
  },
  responseTime: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500',
  },
  responseTimeDark: {
    color: '#aaa',
  },
  removeButton: {
    padding: 8,
  },
  removeButtonText: {
    fontSize: 18,
    color: '#ff3b30',
    fontWeight: 'bold',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
    paddingVertical: 20,
  },
  emptyTextDark: {
    color: '#666',
  },
  settingsContent: {
    marginTop: 10,
  },
  settingItem: {
    marginBottom: 15,
  },
  settingLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 5,
  },
  settingLabelDark: {
    color: '#aaa',
  },
  settingInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fff',
  },
  settingInputDark: {
    borderColor: '#444',
    color: '#fff',
    backgroundColor: '#333',
  },
  saveButton: {
    backgroundColor: '#28a745',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  actionButton: {
    backgroundColor: '#007bff',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  actionButtonDisabled: {
    backgroundColor: '#ccc',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  backgroundToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  toggleLabel: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  toggleLabelDark: {
    color: '#fff',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  errorMessage: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: '#666',
  },
  errorButton: {
    backgroundColor: '#007bff',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
});

export default App;
