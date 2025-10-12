/**
 * URL Monitoring App - Production Ready Version 2.0
 * Enhanced with complete error handling and optimizations
 * Features:
 * - Monitor multiple URLs with persistent background execution
 * - True background service using react-native-background-actions
 * - Enhanced network carrier detection
 * - Batch callbacks with detailed statistics
 * - Persistent storage and data recovery
 * - Advanced background service management
 * - API integration for loading URLs
 * - Comprehensive background execution monitoring
 * - Error Boundary for crash prevention
 * - Performance optimizations with useMemo
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
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundJob from 'react-native-background-actions';

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
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

const REQUEST_TIMEOUT = 30000; // 30 seconds - increased for better reliability
const CALLBACK_TIMEOUT = 15000; // 15 seconds for callback requests

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
        // Fallback to generic description
        carrier = 'No SIM / WiFi Only';
      }
    } catch (error) {
      console.log('Carrier detection error:', error);
      carrier = 'Detection Failed';
    }

    // Basic network type detection
    // Since isWifiEnabled is not available, use a simple check
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

interface BackgroundServiceStats {
  isRunning: boolean;
  startTime: Date | null;
  totalChecks: number;
  lastCheckTime: Date | null;
  totalUptime: number;
  successfulCallbacks: number;
  failedCallbacks: number;
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

  // Background service states
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(false);
  const [isBackgroundServiceRunning, setIsBackgroundServiceRunning] =
    useState(false);
  const [nextCheckTime, setNextCheckTime] = useState<Date | null>(null);
  const [timeUntilNextCheck, setTimeUntilNextCheck] = useState<string>('');
  const [serviceStats, setServiceStats] = useState<BackgroundServiceStats>({
    isRunning: false,
    startTime: null,
    totalChecks: 0,
    lastCheckTime: null,
    totalUptime: 0,
    successfulCallbacks: 0,
    failedCallbacks: 0,
  });

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

  // Memoized values for performance
  const sortedUrls = useMemo(() => {
    return [...urls].sort((a, b) => {
      const statusOrder = { checking: 0, inactive: 1, active: 2 };
      const aOrder = statusOrder[a.status || 'checking'];
      const bOrder = statusOrder[b.status || 'checking'];
      return aOrder - bOrder;
    });
  }, [urls]);

  // Update service statistics
  const updateServiceStats = useCallback(
    async (updates: Partial<BackgroundServiceStats>) => {
      try {
        const savedStats = await AsyncStorage.getItem(
          STORAGE_KEYS.SERVICE_STATS,
        );
        const currentStats: BackgroundServiceStats = savedStats
          ? JSON.parse(savedStats)
          : {
              isRunning: false,
              startTime: null,
              totalChecks: 0,
              lastCheckTime: null,
              totalUptime: 0,
              successfulCallbacks: 0,
              failedCallbacks: 0,
            };

        const updatedStats = {
          ...currentStats,
          ...updates,
          totalChecks: currentStats.totalChecks + (updates.totalChecks || 0),
          successfulCallbacks:
            currentStats.successfulCallbacks +
            (updates.successfulCallbacks || 0),
          failedCallbacks:
            currentStats.failedCallbacks + (updates.failedCallbacks || 0),
        };

        if (updates.lastCheckTime) {
          updatedStats.lastCheckTime = updates.lastCheckTime;
        }

        await AsyncStorage.setItem(
          STORAGE_KEYS.SERVICE_STATS,
          JSON.stringify(updatedStats),
        );
        setServiceStats(updatedStats);
      } catch (error) {
        console.error('Error updating service stats:', error);
      }
    },
    [],
  );

  // Initialize performBackgroundUrlCheck as a ref to avoid dependency issues
  const performBackgroundUrlCheckRef =
    useRef<
      (
        currentUrls: URLItem[],
        callbackConfig: CallbackConfig | null,
      ) => Promise<void>
    >();

  // Background task function
  const backgroundTask = useCallback(async (taskData: any) => {
    bgLog('🔄 Background task started', { taskData });

    // Update service start time
    if (!backgroundServiceStartTime.current) {
      backgroundServiceStartTime.current = new Date();
    }

    const intervalMinutes = taskData.parameters?.interval || 60;
    const intervalMs = intervalMinutes * 60000;

    while (BackgroundJob.isRunning()) {
      try {
        bgLog('🔔 Background check triggered', {
          time: new Date().toISOString(),
        });

        // Load current data from storage
        const [savedUrls, savedCallback] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.URLS),
          AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
        ]);

        if (!savedUrls) {
          bgLog('No URLs to check in background');
          await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
          continue;
        }

        const currentUrls = JSON.parse(savedUrls);
        const currentCallbackConfig = savedCallback
          ? JSON.parse(savedCallback)
          : null;

        if (currentUrls.length === 0) {
          bgLog('No URLs configured');
          await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
          continue;
        }

        // Update service stats
        await updateServiceStats({
          totalChecks: 1,
          lastCheckTime: new Date(),
        });

        // Perform URL checks
        if (performBackgroundUrlCheckRef.current) {
          await performBackgroundUrlCheckRef.current(
            currentUrls,
            currentCallbackConfig,
          );
        }

        // Wait for next interval
        await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
      } catch (error: any) {
        bgLog('Background task error', { error: error.message });
        await logError(error, 'backgroundTask');
        await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
      }
    }

    bgLog('🛑 Background task stopped');
  }, []);

  // Enhanced URL checking with retry
  const checkUrlWithRetry = async (
    url: string,
    maxRetries: number = 2,
  ): Promise<DetailedCheckResult> => {
    let lastError: DetailedCheckResult | null = null;
    console.log('🎯🎯🎯 FETCHING URL:', url);
    console.log('Time:', new Date().toISOString());
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📡 Attempt ${attempt + 1}: Fetching ${url}`);
        const randomUserAgent =
          USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.log(
            `⏱️ Request timeout for ${url} after ${REQUEST_TIMEOUT}ms`,
          );
          controller.abort();
        }, REQUEST_TIMEOUT);

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'User-Agent': randomUserAgent,
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          const isSuccess =
            (response.status >= 200 && response.status < 300) ||
            (response.status >= 300 && response.status < 400) ||
            response.status === 401 ||
            response.status === 403 ||
            response.status === 429;

          console.log(
            `✅ URL Check Complete: ${url} - Status: ${response.status}`,
          );

          return {
            status: isSuccess ? 'active' : 'inactive',
            statusCode: response.status,
            statusText: response.statusText,
            isRedirect: response.redirected,
            redirectUrl: response.url !== url ? response.url : undefined,
          };
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
      } catch (error: any) {
        let errorType: DetailedCheckResult['errorType'] = 'unknown';
        let errorMessage = error.message;

        if (error.name === 'AbortError') {
          errorType = 'timeout';
          errorMessage = 'Request timeout';
        } else if (
          error.message.includes('Failed to fetch') ||
          error.message.includes('Network')
        ) {
          errorType = 'network';
          errorMessage = 'Network error';
        }

        lastError = {
          status: 'inactive',
          errorType,
          errorMessage,
        };

        if (attempt < maxRetries) {
          await new Promise<void>(resolve =>
            setTimeout(resolve, 1000 * (attempt + 1)),
          );
          continue;
        }
      }
    }

    return (
      lastError || {
        status: 'inactive',
        errorType: 'unknown',
        errorMessage: 'Unknown error',
      }
    );
  };

  // Background URL checking function
  const performBackgroundUrlCheck = useCallback(
    async (currentUrls: URLItem[], callbackConfig: CallbackConfig | null) => {
      bgLog(`Checking ${currentUrls.length} URLs in background`);

      const checkResults: Array<{
        url: string;
        status: 'active' | 'inactive';
        error?: string;
        responseTime?: number;
        statusCode?: number;
        isRedirect?: boolean;
      }> = [];

      // Check each URL
      for (let i = 0; i < currentUrls.length; i++) {
        const urlItem = currentUrls[i];

        if (i > 0) {
          await randomSleep(5, 30);
        }

        const startTime = Date.now();

        try {
          const result = await checkUrlWithRetry(urlItem.url);
          const responseTime = Date.now() - startTime;

          checkResults.push({
            url: urlItem.url,
            status: result.status,
            responseTime,
            statusCode: result.statusCode,
            isRedirect: result.isRedirect,
            error: result.errorMessage,
          });
        } catch (error: any) {
          const responseTime = Date.now() - startTime;
          await logError(error, `backgroundCheck:${urlItem.url}`);

          checkResults.push({
            url: urlItem.url,
            status: 'inactive',
            error: error.message || 'Network request failed',
            responseTime,
          });
        }
      }

      // Send callback if configured
      if (callbackConfig && callbackConfig.url && checkResults.length > 0) {
        await sendBackgroundCallbackRef.current?.(checkResults, callbackConfig);
      }

      // Update background check count
      try {
        const newCount = backgroundCheckCount + 1;
        await AsyncStorage.setItem(
          STORAGE_KEYS.BACKGROUND_STATS,
          newCount.toString(),
        );
      } catch (error: any) {
        console.error('Error updating background stats:', error);
        await logError(error, 'updateBackgroundStats');
      }
    },
    [backgroundCheckCount],
  );

  // Send callback from background
  const sendBackgroundCallback = useCallback(
    async (
      results: Array<{
        url: string;
        status: 'active' | 'inactive';
        error?: string;
        responseTime?: number;
      }>,
      callbackConfig: CallbackConfig,
    ) => {
      if (!callbackConfig.url || !isValidUrl(callbackConfig.url)) {
        return;
      }

      console.log(
        `Sending background callback to ${callbackConfig.url} for ${results.length} URLs`,
      );

      try {
        const deviceInfo = await getDeviceInfo();

        const activeCount = results.filter(r => r.status === 'active').length;
        const inactiveCount = results.filter(
          r => r.status === 'inactive',
        ).length;

        const payload = {
          checkType: 'background_batch',
          timestamp: new Date().toISOString(),
          isBackground: true,
          backgroundServiceRunning: true,
          summary: {
            total: results.length,
            active: activeCount,
            inactive: inactiveCount,
          },
          urls: results.map(result => ({
            url: result.url,
            status: result.status,
            error: result.error || null,
            responseTime: result.responseTime,
          })),
          network: {
            type: networkInfo.type,
            carrier: networkInfo.carrier,
            displayName: getNetworkDisplayText(networkInfo),
          },
          device: deviceInfo,
          callbackName: callbackConfig.name,
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.log(`⏱️ Callback timeout after ${CALLBACK_TIMEOUT}ms`);
          controller.abort();
        }, CALLBACK_TIMEOUT);

        console.log('🚀 Attempting to send callback...');
        const response = await fetch(callbackConfig.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NetGuard-Background/1.0',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        console.log(`📨 Callback response received: ${response.status}`);

        const callbackRecord: CallbackHistory = {
          timestamp: new Date(),
          urls: results.map(r => ({
            url: r.url,
            status: r.status,
            error: r.error,
          })),
          success: response.ok,
          totalUrls: results.length,
          activeCount,
          inactiveCount,
        };

        // Update service stats
        await updateServiceStats({
          successfulCallbacks: response.ok ? 1 : 0,
          failedCallbacks: response.ok ? 0 : 1,
        });

        // Save callback history
        await AsyncStorage.setItem(
          STORAGE_KEYS.LAST_CALLBACK,
          JSON.stringify(callbackRecord),
        );

        console.log(
          `Background callback ${response.ok ? 'successful' : 'failed'}`,
        );
      } catch (err: any) {
        console.error(
          'Error sending enhanced background callback:',
          err.message,
        );
        await logError(err, 'sendEnhancedBackgroundCallback');

        // Update failed callback count
        await updateServiceStats({
          failedCallbacks: 1,
        });
      }
    },
    [networkInfo],
  );

  // Create refs for functions that need to be referenced before definition
  const sendBackgroundCallbackRef = useRef<typeof sendBackgroundCallback>();
  const checkAllUrlsRef = useRef<typeof checkAllUrls>();
  const sendBatchCallbackRef = useRef<typeof sendBatchCallback>();

  // Assign refs
  performBackgroundUrlCheckRef.current = performBackgroundUrlCheck;
  sendBackgroundCallbackRef.current = sendBackgroundCallback;

  // Initialize app
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await loadSavedData();
        const networkInfo = await checkNetworkInfo();
        setNetworkInfo(networkInfo);
        await handlePermissions();
        await loadBackgroundStats();
      } catch (error: any) {
        console.error('App initialization error:', error);
        await logError(error, 'initializeApp');
      }
    };

    initializeApp();
    loadServiceStats();

    // Handle back button on Android
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (isBackgroundServiceRunning) {
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
  }, [isBackgroundServiceRunning]);

  // Load service statistics
  const loadServiceStats = async () => {
    try {
      const stats = await AsyncStorage.getItem(STORAGE_KEYS.SERVICE_STATS);
      if (stats) {
        const parsedStats = JSON.parse(stats);
        setServiceStats({
          ...parsedStats,
          startTime: parsedStats.startTime
            ? new Date(parsedStats.startTime)
            : null,
          lastCheckTime: parsedStats.lastCheckTime
            ? new Date(parsedStats.lastCheckTime)
            : null,
        });
      }
    } catch (error) {
      console.error('Error loading service stats:', error);
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

  // Handle app state changes with improved background service management
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
          loadServiceStats();

          // Update service running state
          setIsBackgroundServiceRunning(BackgroundJob.isRunning());

          // Check if we missed any scheduled checks
          if (autoCheckEnabled && nextCheckTime) {
            const now = new Date();
            if (now >= nextCheckTime) {
              console.log('Missed scheduled check, running now');
              checkAllUrlsRef.current?.();

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
  }, [autoCheckEnabled, nextCheckTime, checkInterval]);

  // Start background service
  const startBackgroundService = async () => {
    try {
      // Check for debugger and warn user
      if (isDebugMode()) {
        Alert.alert(
          '⚠️ Debugger Detected',
          'Background service may not work properly with debugger attached. For best results:\n\n' +
            '1. Stop remote debugging (shake device → Stop Debugging)\n' +
            '2. Use console logs instead\n' +
            '3. View logs with: adb logcat\n\n' +
            'Continue anyway?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Continue',
              onPress: () => startBackgroundServiceInternal(),
            },
          ],
        );
        return;
      }

      await startBackgroundServiceInternal();
    } catch (error: any) {
      console.error('Failed to start background service internal:', error);
      await logError(error, 'startBackgroundServiceInternal');
      throw error;
    }
  };

  const startBackgroundServiceInternal = async () => {
    try {
      if (BackgroundJob.isRunning()) {
        console.log('Background service already running');
        return;
      }

      if (urls.length === 0) {
        Alert.alert('No URLs', 'Please add URLs to monitor first');
        return;
      }

      console.log('Starting background service...');

      const intervalMinutes = parseInt(checkInterval, 10);
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

      // Update service stats
      await updateServiceStats({
        isRunning: true,
        startTime: new Date(),
      });

      console.log('✅ Background service started successfully');

      Alert.alert(
        'Background Service Started',
        `URLs will be monitored every ${checkInterval} minutes in background.\n\n` +
          '🔄 Service is now active\n' +
          '📱 You can now close or minimize the app\n' +
          "🔔 You'll see a persistent notification",
        [{ text: 'OK' }],
      );
    } catch (error: any) {
      console.error('Failed to start background service:', error);
      await logError(error, 'startBackgroundService');
      Alert.alert('Error', 'Failed to start background service');
    }
  };

  // Stop background service
  const stopBackgroundService = async () => {
    try {
      console.log('Stopping background service...');

      await BackgroundJob.stop();

      setIsBackgroundServiceRunning(false);
      backgroundServiceStartTime.current = null;

      // Update service stats
      await updateServiceStats({
        isRunning: false,
      });

      console.log('🛑 Background service stopped');

      Alert.alert(
        'Background Service Stopped',
        'URL monitoring has been stopped.',
      );
    } catch (error: any) {
      console.error('Failed to stop background service:', error);
      await logError(error, 'stopBackgroundService');
      Alert.alert('Error', 'Failed to stop background service');
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

  // Update countdown timer
  useEffect(() => {
    if (nextCheckTime && (autoCheckEnabled || isBackgroundServiceRunning)) {
      const updateCountdown = () => {
        const now = new Date();
        const diff = nextCheckTime.getTime() - now.getTime();

        if (diff <= 0) {
          setTimeUntilNextCheck('Checking now...');
        } else {
          const minutes = Math.floor(diff / 60000);
          const seconds = Math.floor((diff % 60000) / 1000);
          setTimeUntilNextCheck(`${minutes}m ${seconds}s`);
        }
      };

      updateCountdown();
      const interval = setInterval(updateCountdown, 1000);

      return () => clearInterval(interval);
    } else {
      setTimeUntilNextCheck('');
    }
  }, [nextCheckTime, autoCheckEnabled, isBackgroundServiceRunning]);

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

  // Load data from API (keep existing implementation)
  const loadFromAPI = async () => {
    if (!apiEndpoint) {
      Alert.alert('Error', 'Please enter API endpoint URL');
      return;
    }

    setIsLoadingAPI(true);
    try {
      const response = await fetch(apiEndpoint, {
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
        Alert.alert(
          'Success',
          `Loaded ${data.data.length} URLs from ${uniqueCallbackNames.length} callback configurations`,
        );
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (error: any) {
      Alert.alert('Error', `Failed to load from API: ${error.message}`);
    } finally {
      setIsLoadingAPI(false);
    }
  };

  // Load URLs for selected callback
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

  // Save callback configuration
  const handleSaveCallback = async () => {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.CALLBACK,
        JSON.stringify(callbackConfig),
      );
    } catch (error) {
      console.error('Error saving callback:', error);
    }
  };

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

  // Network info refresh
  const refreshNetworkInfo = async () => {
    const networkInfo = await checkNetworkInfo();
    setNetworkInfo(networkInfo);
  };

  // Get formatted network display
  const getFormattedNetworkText = () => {
    return getNetworkDisplayText(networkInfo);
  };

  // Add new URL
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
    checkSingleUrlImmediate(newUrlItem);
  };

  // Check single URL immediately (for individual adds)
  const checkSingleUrlImmediate = async (urlItem: URLItem) => {
    const startTime = Date.now();

    try {
      const result = await checkUrlWithRetry(urlItem.url);
      const responseTime = Date.now() - startTime;

      const checkRecord: CheckRecord = {
        timestamp: new Date(),
        status: result.status,
        responseTime,
        statusCode: result.statusCode,
        isRedirect: result.isRedirect,
        errorType: result.errorType,
        errorMessage: result.errorMessage,
      };

      updateUrlStatus(urlItem.id, result.status, checkRecord);
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const checkRecord: CheckRecord = {
        timestamp: new Date(),
        status: 'inactive',
        responseTime,
        errorType: 'unknown',
        errorMessage: 'Unexpected error',
      };

      updateUrlStatus(urlItem.id, 'inactive', checkRecord);
    }
  };

  // Remove URL
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

  // Clear all data
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
              // Stop background service first
              if (isBackgroundServiceRunning) {
                await stopBackgroundService();
              }

              await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
              setUrls([]);
              setCallbackConfig({ name: '', url: '' });
              setCheckInterval('60');
              setLastCallback(null);
              setLastCheckTime(null);
              setAutoCheckEnabled(false);
              setApiEndpoint('');
              setApiData([]);
              setApiCallbackNames([]);
              setSelectedCallbackName('');
              setBackgroundCheckCount(0);
              setServiceStats({
                isRunning: false,
                startTime: null,
                totalChecks: 0,
                lastCheckTime: null,
                totalUptime: 0,
                successfulCallbacks: 0,
                failedCallbacks: 0,
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

  // Update URL status with history
  const updateUrlStatus = (
    id: string,
    status: 'active' | 'inactive',
    checkRecord: CheckRecord,
  ) => {
    setUrls(prevUrls =>
      prevUrls.map(url => {
        if (url.id === id) {
          const history = [...(url.checkHistory || []), checkRecord];
          if (history.length > 10) {
            history.shift();
          }
          return {
            ...url,
            status,
            lastChecked: new Date(),
            checkHistory: history,
          };
        }
        return url;
      }),
    );
  };

  // Check all URLs with batch callback
  const checkAllUrls = useCallback(
    async (isBackground: boolean = false) => {
      let currentUrls = urls;

      if (isBackground && AppState.currentState !== 'active') {
        try {
          const savedUrls = await AsyncStorage.getItem(STORAGE_KEYS.URLS);
          if (savedUrls) {
            const parsedUrls = JSON.parse(savedUrls);
            currentUrls = parsedUrls;
          }
        } catch (error) {
          console.error('Error loading URLs for background check:', error);
        }
      }

      if (currentUrls.length === 0) {
        if (!isBackground) {
          Alert.alert('No URLs', 'Please add URLs to monitor first');
        }
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setLastCheckTime(new Date());
      console.log(
        `Checking ${currentUrls.length} URLs${
          isBackground ? ' in background' : ''
        }...`,
      );

      const checkResults: Array<{
        url: string;
        status: 'active' | 'inactive';
        error?: string;
        responseTime?: number;
        statusCode?: number;
        isRedirect?: boolean;
      }> = [];

      const checkUrlForBatch = async (urlItem: URLItem, index: number) => {
        if (index > 0) {
          await randomSleep(0, 30);
        }

        const startTime = Date.now();

        try {
          const result = await checkUrlWithRetry(urlItem.url);
          const responseTime = Date.now() - startTime;

          const checkRecord: CheckRecord = {
            timestamp: new Date(),
            status: result.status,
            responseTime,
            statusCode: result.statusCode,
            isRedirect: result.isRedirect,
            errorType: result.errorType,
            errorMessage: result.errorMessage,
          };

          if (!isBackground || AppState.currentState === 'active') {
            updateUrlStatus(urlItem.id, checkRecord.status, checkRecord);
          }

          checkResults.push({
            url: urlItem.url,
            status: checkRecord.status,
            responseTime,
            statusCode: result.statusCode,
            isRedirect: result.isRedirect,
            error: result.errorMessage,
          });
        } catch (error: any) {
          const responseTime = Date.now() - startTime;
          const checkRecord: CheckRecord = {
            timestamp: new Date(),
            status: 'inactive',
            responseTime,
            errorType: 'unknown',
            errorMessage: error.message || 'Network request failed',
          };

          if (!isBackground || AppState.currentState === 'active') {
            updateUrlStatus(urlItem.id, 'inactive', checkRecord);
          }

          checkResults.push({
            url: urlItem.url,
            status: 'inactive',
            error: error.message || 'Network request failed',
            responseTime,
          });
        }
      };

      try {
        for (let i = 0; i < currentUrls.length; i++) {
          await checkUrlForBatch(currentUrls[i], i);
        }
      } catch (error) {
        console.error('Error checking URLs:', error);
      }

      let currentCallbackConfig = callbackConfig;
      if (isBackground && AppState.currentState !== 'active') {
        try {
          const savedCallback = await AsyncStorage.getItem(
            STORAGE_KEYS.CALLBACK,
          );
          if (savedCallback) {
            currentCallbackConfig = JSON.parse(savedCallback);
          }
        } catch (error) {
          console.error('Error loading callback config for background:', error);
        }
      }

      // Always attempt to send callback if configured
      if (currentCallbackConfig.url && checkResults.length > 0) {
        console.log('========================================');
        console.log('📤 PREPARING TO SEND CALLBACK');
        console.log(`📋 Results: ${checkResults.length} URLs checked`);
        console.log(`🔗 Callback URL: ${currentCallbackConfig.url}`);
        console.log('========================================');

        try {
          await sendBatchCallbackRef.current?.(checkResults, isBackground);
          console.log('✅ Callback process completed');
        } catch (callbackError: any) {
          console.error('❌ Callback sending failed:', callbackError.message);
        }
      } else {
        if (!currentCallbackConfig.url) {
          console.log('⚠️ No callback URL configured - skipping callback');
        }
        if (checkResults.length === 0) {
          console.log('⚠️ No check results to send - skipping callback');
        }
      }

      setIsLoading(false);
    },
    [urls, callbackConfig, serviceStats, checkUrlWithRetry, updateUrlStatus],
  );

  // Assign checkAllUrls to ref
  checkAllUrlsRef.current = checkAllUrls;

  // Send batch callback with all results
  const sendBatchCallback = useCallback(
    async (
      results: Array<{
        url: string;
        status: 'active' | 'inactive';
        error?: string;
        responseTime?: number;
      }>,
      isBackground: boolean = false,
    ) => {
      let currentCallbackConfig = callbackConfig;
      if (isBackground) {
        try {
          const savedCallback = await AsyncStorage.getItem(
            STORAGE_KEYS.CALLBACK,
          );
          if (savedCallback) {
            currentCallbackConfig = JSON.parse(savedCallback);
          }
        } catch (error) {
          console.error('Error loading callback for background:', error);
          return;
        }
      }

      if (
        !currentCallbackConfig.url ||
        !isValidUrl(currentCallbackConfig.url)
      ) {
        console.log('No valid callback URL configured');
        return;
      }

      console.log(
        `Sending batch callback to ${currentCallbackConfig.url} for ${
          results.length
        } URLs${isBackground ? ' (background)' : ''}`,
      );

      try {
        const deviceId = await DeviceInfo.getUniqueId();
        const deviceModel = DeviceInfo.getModel();
        const deviceBrand = DeviceInfo.getBrand();
        const systemVersion = DeviceInfo.getSystemVersion();

        const activeCount = results.filter(r => r.status === 'active').length;
        const inactiveCount = results.filter(
          r => r.status === 'inactive',
        ).length;

        const payload = {
          checkType: 'batch',
          timestamp: new Date().toISOString(),
          isBackground: isBackground,
          backgroundServiceRunning: isBackgroundServiceRunning,
          backgroundCheckCount: backgroundCheckCount,
          serviceStats: {
            totalChecks: serviceStats.totalChecks,
            uptime: backgroundServiceStartTime.current
              ? Math.floor(
                  (new Date().getTime() -
                    backgroundServiceStartTime.current.getTime()) /
                    1000,
                )
              : 0,
          },
          summary: {
            total: results.length,
            active: activeCount,
            inactive: inactiveCount,
          },
          urls: results.map(result => ({
            url: result.url,
            status: result.status,
            error: result.error || null,
            responseTime: result.responseTime,
          })),
          network: {
            type: networkInfo.type,
            carrier: networkInfo.carrier,
            isConnected: networkInfo.isConnected,
            displayName: getNetworkDisplayText(networkInfo),
          },
          device: {
            id: deviceId,
            model: deviceModel,
            brand: deviceBrand,
            platform: DeviceInfo.getSystemName(),
            version: systemVersion,
          },
          callbackName: currentCallbackConfig.name,
          autoCheck: autoCheckEnabled,
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.log(`⏱️ Batch callback timeout after ${CALLBACK_TIMEOUT}ms`);
          controller.abort();
        }, CALLBACK_TIMEOUT);

        console.log('🚀 Sending batch callback now...');
        let response;
        try {
          response = await fetch(currentCallbackConfig.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': isBackground
                ? 'NetGuard-Background/2.0'
                : 'NetGuard-Foreground/2.0',
              Accept: 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            throw new Error('Callback request timed out');
          }
          throw fetchError;
        }

        const callbackRecord: CallbackHistory = {
          timestamp: new Date(),
          urls: results.map(r => ({
            url: r.url,
            status: r.status,
            error: r.error,
          })),
          success: response.ok,
          totalUrls: results.length,
          activeCount,
          inactiveCount,
        };

        // Update service stats
        await updateServiceStats({
          successfulCallbacks: response.ok ? 1 : 0,
          failedCallbacks: response.ok ? 0 : 1,
        });

        if (!isBackground) {
          setLastCallback(callbackRecord);
        } else {
          await AsyncStorage.setItem(
            STORAGE_KEYS.LAST_CALLBACK,
            JSON.stringify(callbackRecord),
          );
        }

        if (response.ok) {
          console.log('Batch callback sent successfully');
        } else {
          console.log(`Batch callback failed with status ${response.status}`);
        }
      } catch (err: any) {
        console.error('Error sending batch callback:', err.message);
        await logError(err, 'sendBatchCallback');

        const activeCount = results.filter(r => r.status === 'active').length;
        const inactiveCount = results.filter(
          r => r.status === 'inactive',
        ).length;

        const errorCallback: CallbackHistory = {
          timestamp: new Date(),
          urls: results.map(r => ({
            url: r.url,
            status: r.status,
            error: r.error,
          })),
          success: false,
          totalUrls: results.length,
          activeCount,
          inactiveCount,
        };

        await updateServiceStats({ failedCallbacks: 1 });

        if (!isBackground) {
          setLastCallback(errorCallback);
        } else {
          await AsyncStorage.setItem(
            STORAGE_KEYS.LAST_CALLBACK,
            JSON.stringify(errorCallback),
          );
        }
      }
    },
    [
      callbackConfig,
      networkInfo,
      isBackgroundServiceRunning,
      backgroundCheckCount,
      serviceStats,
      autoCheckEnabled,
    ],
  );

  // Assign sendBatchCallback to ref
  sendBatchCallbackRef.current = sendBatchCallback;

  // Save callback configuration
  const saveCallbackConfig = () => {
    if (!callbackConfig.name.trim() || !callbackConfig.url.trim()) {
      Alert.alert('Error', 'Please fill in both callback name and URL');
      return;
    }

    const normalizedCallbackUrl = normalizeUrl(callbackConfig.url);

    if (!isValidUrl(normalizedCallbackUrl)) {
      Alert.alert('Error', 'Please enter a valid callback URL');
      return;
    }

    const updatedConfig = { ...callbackConfig, url: normalizedCallbackUrl };
    setCallbackConfig(updatedConfig);
    handleSaveCallback();
    Alert.alert('Success', 'Callback configuration saved');
  };

  // Save interval
  const saveInterval = () => {
    const interval = parseInt(checkInterval, 10);
    if (isNaN(interval) || interval < 1) {
      Alert.alert('Error', 'Please enter a valid interval (minimum 1 minute)');
      return;
    }

    Alert.alert('Success', `Check interval set to ${interval} minutes`);

    // Restart background service if running
    if (isBackgroundServiceRunning) {
      Alert.alert(
        'Restart Required',
        'Background service needs to restart with new interval. Restart now?',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Restart',
            onPress: async () => {
              await stopBackgroundService();
              setTimeout(() => {
                startBackgroundService();
              }, 1000);
            },
          },
        ],
      );
    }
  };

  // Format uptime
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

  // Styles
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
          <Text style={[styles.title, textStyle]}>NetGuard Pro</Text>
          {lastCheckTime && (
            <Text style={[styles.lastCheckText, textStyle]}>
              Last check: {formatTimeAgo(lastCheckTime)}
            </Text>
          )}
          {backgroundCheckCount > 0 && (
            <Text style={[styles.backgroundStatsText, textStyle]}>
              Background checks: {backgroundCheckCount}
            </Text>
          )}
        </View>

        {/* Background Service Status */}
        <View
          style={[
            cardStyle,
            isBackgroundServiceRunning
              ? styles.serviceActiveCard
              : styles.serviceInactiveCard,
          ]}
        >
          <View style={styles.serviceHeader}>
            <Text style={[styles.serviceTitle, textStyle]}>
              {isBackgroundServiceRunning
                ? '🟢 Background Service Active'
                : '🔴 Background Service Stopped'}
            </Text>
            <Switch
              value={isBackgroundServiceRunning}
              onValueChange={toggleBackgroundService}
              trackColor={{ false: '#767577', true: '#81b0ff' }}
              thumbColor={isBackgroundServiceRunning ? '#2196F3' : '#f4f3f4'}
            />
          </View>

          {isBackgroundServiceRunning && (
            <>
              <Text style={[styles.serviceDescription, textStyle]}>
                Monitoring {urls.length} URLs every {checkInterval} minutes
              </Text>
              {backgroundServiceStartTime.current && (
                <Text style={[styles.serviceUptime, textStyle]}>
                  Uptime:{' '}
                  {formatUptime(
                    Math.floor(
                      (new Date().getTime() -
                        backgroundServiceStartTime.current.getTime()) /
                        1000,
                    ),
                  )}
                </Text>
              )}
            </>
          )}

          {timeUntilNextCheck && isBackgroundServiceRunning && (
            <Text style={[styles.countdownText, textStyle]}>
              Next check: {timeUntilNextCheck}
            </Text>
          )}
        </View>

        {/* Service Statistics */}
        {(serviceStats.totalChecks > 0 || isBackgroundServiceRunning) && (
          <View style={cardStyle}>
            <Text style={[styles.sectionTitle, textStyle]}>
              Service Statistics
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
                Last background check:{' '}
                {formatTimeAgo(serviceStats.lastCheckTime)}
              </Text>
            )}
          </View>
        )}

        {/* Network Status */}
        <View style={cardStyle}>
          <Text style={[styles.sectionTitle, textStyle]}>Network Status</Text>
          <View style={styles.networkInfoContainer}>
            <View style={styles.networkRow}>
              <Text style={[styles.networkLabel, textStyle]}>Carrier:</Text>
              <Text
                style={[
                  styles.networkValue,
                  textStyle,
                  {
                    color:
                      networkInfo.carrier !== 'Unknown' ? '#4CAF50' : '#FF9800',
                  },
                ]}
              >
                {getFormattedNetworkText()}
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
            onChangeText={setApiEndpoint}
            autoCapitalize="none"
            autoCorrect={false}
          />

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

          {/* URL List - Using sortedUrls for performance */}
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

                {/* Display additional information */}
                {url.checkHistory && url.checkHistory.length > 0 && (
                  <>
                    <Text style={[styles.responseTimeText, textStyle]}>
                      Response:{' '}
                      {
                        url.checkHistory[url.checkHistory.length - 1]
                          .responseTime
                      }
                      ms
                      {url.checkHistory[url.checkHistory.length - 1]
                        .statusCode &&
                        ` • Status: ${
                          url.checkHistory[url.checkHistory.length - 1]
                            .statusCode
                        }`}
                    </Text>
                    {url.checkHistory[url.checkHistory.length - 1]
                      .isRedirect && (
                      <Text style={[styles.redirectText, textStyle]}>
                        ↪ Redirected
                      </Text>
                    )}
                    {url.checkHistory[url.checkHistory.length - 1]
                      .errorMessage && (
                      <Text style={[styles.errorText, { color: '#F44336' }]}>
                        ⚠{' '}
                        {
                          url.checkHistory[url.checkHistory.length - 1]
                            .errorMessage
                        }
                      </Text>
                    )}
                  </>
                )}
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
                Sent:{' '}
                <Text
                  style={{
                    color: lastCallback.success ? '#4CAF50' : '#F44336',
                    fontWeight: 'bold',
                  }}
                >
                  {lastCallback.success ? 'Success' : 'Failed'}
                </Text>
              </Text>

              {/* Show all URLs in last callback */}
              <View style={styles.urlListContainer}>
                <Text style={[styles.urlListTitle, textStyle]}>URLs:</Text>
                {lastCallback.urls.map((urlInfo, index) => (
                  <View key={index} style={styles.urlListItem}>
                    <View
                      style={[
                        styles.urlListIndicator,
                        {
                          backgroundColor:
                            urlInfo.status === 'active' ? '#4CAF50' : '#F44336',
                        },
                      ]}
                    />
                    <Text
                      style={[styles.urlListText, textStyle]}
                      numberOfLines={1}
                    >
                      {urlInfo.url}
                    </Text>
                    {urlInfo.error && (
                      <Text style={[styles.urlErrorText, { color: '#F44336' }]}>
                        ({urlInfo.error})
                      </Text>
                    )}
                  </View>
                ))}
              </View>
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

          {/* Background Service Tips for Android */}
          {Platform.OS === 'android' && (
            <View style={styles.androidTips}>
              <Text style={[styles.androidTipsTitle, textStyle]}>
                💡 Background Service Tips:
              </Text>
              <Text style={[styles.androidTipsText, textStyle]}>
                • Grant all permissions when prompted
              </Text>
              <Text style={[styles.androidTipsText, textStyle]}>
                • Disable battery optimization in Settings
              </Text>
              <Text style={[styles.androidTipsText, textStyle]}>
                • Lock app in Recent Apps (swipe & tap lock icon)
              </Text>
              <Text style={[styles.androidTipsText, textStyle]}>
                • Keep persistent notification visible
              </Text>
            </View>
          )}
        </View>

        {/* Manual Check Button */}
        <TouchableOpacity
          style={[styles.checkButton, isLoading && styles.buttonDisabled]}
          onPress={() => checkAllUrls(false)}
          disabled={isLoading || urls.length === 0}
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.checkButtonText}>Check All URLs Now</Text>
          )}
        </TouchableOpacity>

        {/* Info Note */}
        <View style={styles.infoNote}>
          <Text style={[styles.infoNoteText, textStyle]}>
            ℹ️ NetGuard Pro uses react-native-background-actions for true
            background monitoring.
            {'\n\n'}
            🔄 Background service runs independently from the app
            {'\n'}
            📱 Persistent notification shows service status
            {'\n'}
            🔋 Optimized for battery efficiency
            {'\n'}
            📡 Works even when app is closed or device is locked
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

      {/* Debug Log Viewer - Only in DEV mode */}
      {__DEV__ && (
        <TouchableOpacity
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            backgroundColor: '#FF6B6B',
            borderRadius: 30,
            width: 60,
            height: 60,
            justifyContent: 'center',
            alignItems: 'center',
            elevation: 5,
            zIndex: 999,
          }}
          onPress={async () => {
            const logs = await AsyncStorage.getItem('bgLogs');
            if (logs) {
              setDebugLogs(JSON.parse(logs));
            }
            setShowDebugLogs(!showDebugLogs);
          }}
        >
          <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>
            LOGS
          </Text>
        </TouchableOpacity>
      )}

      {/* Debug Logs Modal */}
      {showDebugLogs && (
        <Modal
          visible={showDebugLogs}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowDebugLogs(false)}
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
                Background Service Logs
              </Text>
              <ScrollView style={{ maxHeight: 400 }}>
                {debugLogs
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
                          {JSON.stringify(log.data, null, 2)}
                        </Text>
                      )}
                    </View>
                  ))}
              </ScrollView>
              <TouchableOpacity
                style={[styles.modalCloseButton, { marginTop: 10 }]}
                onPress={() => setShowDebugLogs(false)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { marginTop: 10 }]}
                onPress={async () => {
                  await AsyncStorage.removeItem('bgLogs');
                  setDebugLogs([]);
                  Alert.alert('Success', 'Debug logs cleared');
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  errorTitle: {
    fontSize: 20,
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
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
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
  backgroundStatsText: {
    fontSize: 11,
    opacity: 0.6,
    marginTop: 2,
    color: '#2196F3',
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
  responseTimeText: {
    fontSize: 11,
    opacity: 0.6,
    marginTop: 2,
  },
  redirectText: {
    fontSize: 11,
    opacity: 0.6,
    marginTop: 2,
    color: '#FF9800',
  },
  errorText: {
    fontSize: 11,
    marginTop: 2,
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
  urlListContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  urlListTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  urlListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    paddingVertical: 2,
  },
  urlListIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  urlListText: {
    fontSize: 11,
    flex: 1,
  },
  urlErrorText: {
    fontSize: 10,
    marginLeft: 4,
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
