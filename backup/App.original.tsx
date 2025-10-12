/**
 * URL Monitoring App - Production Ready Version 3.0
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

      // Check Android version for notification permission
      if (Platform.Version >= 33) {
        permissions.push('android.permission.POST_NOTIFICATIONS');
      }

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

// Global variable to track background task state
let backgroundTaskRunning = false;
let backgroundTaskInterval: NodeJS.Timeout | null = null;

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

// Fixed Background Task Function
const backgroundTask = async (taskDataArguments: any) => {
  bgLog('🔄 Background task started', { taskDataArguments });
  backgroundTaskRunning = true;

  // Main monitoring loop with proper async handling
  await new Promise(async (resolve) => {
    const runCheck = async () => {
      if (!backgroundTaskRunning) {
        bgLog('⛔ Background task stopped');
        if (backgroundTaskInterval) {
          clearInterval(backgroundTaskInterval);
          backgroundTaskInterval = null;
        }
        resolve(undefined);
        return;
      }

      try {
        bgLog('🔔 Background check triggered', {
          time: new Date().toISOString(),
        });

        // Load current data from storage
        const [savedUrls, savedCallback, savedInterval] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.URLS),
          AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
          AsyncStorage.getItem(STORAGE_KEYS.INTERVAL),
        ]);

        if (!savedUrls) {
          bgLog('No URLs to check in background');
          return;
        }

        const currentUrls = JSON.parse(savedUrls);
        const currentCallbackConfig = savedCallback
          ? JSON.parse(savedCallback)
          : null;
        const intervalMinutes = savedInterval ? parseInt(savedInterval, 10) : 60;

        if (currentUrls.length === 0) {
          bgLog('No URLs configured');
          return;
        }

        const checkResults: any[] = [];
        const networkInfo = await checkNetworkInfo();

        if (!networkInfo.isConnected) {
          bgLog('No network connection, skipping checks');
          return;
        }

        // Check each URL
        for (let i = 0; i < currentUrls.length; i++) {
          const urlItem = currentUrls[i];

          if (i > 0) {
            await randomSleep(5, 30);
          }

          const startTime = Date.now();

          try {
            const randomUserAgent =
              USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
              controller.abort();
            }, REQUEST_TIMEOUT);

            const response = await fetch(urlItem.url, {
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
            const responseTime = Date.now() - startTime;

            const isSuccess =
              (response.status >= 200 && response.status < 300) ||
              (response.status >= 300 && response.status < 400) ||
              response.status === 401 ||
              response.status === 403 ||
              response.status === 429;

            checkResults.push({
              url: urlItem.url,
              status: isSuccess ? 'active' : 'inactive',
              statusCode: response.status,
              responseTime,
            });

            bgLog(`✅ URL Check: ${urlItem.url} - Status: ${response.status}`);

          } catch (error: any) {
            const responseTime = Date.now() - startTime;

            let errorType = 'unknown';
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

            checkResults.push({
              url: urlItem.url,
              status: 'inactive',
              error: errorMessage,
              responseTime,
            });

            bgLog(`❌ URL Check Failed: ${urlItem.url} - ${errorMessage}`);
          }
        }

        // Send callback if configured
        if (currentCallbackConfig && currentCallbackConfig.url && checkResults.length > 0) {
          try {
            const deviceInfo = await getDeviceInfo();

            const activeCount = checkResults.filter(r => r.status === 'active').length;
            const inactiveCount = checkResults.filter(r => r.status === 'inactive').length;

            const payload = {
              checkType: 'background_batch',
              timestamp: new Date().toISOString(),
              isBackground: true,
              backgroundServiceRunning: true,
              summary: {
                total: checkResults.length,
                active: activeCount,
                inactive: inactiveCount,
              },
              urls: checkResults.map(result => ({
                url: result.url,
                status: result.status,
                error: result.error || null,
                responseTime: result.responseTime,
                statusCode: result.statusCode,
              })),
              network: {
                type: networkInfo.type,
                carrier: networkInfo.carrier,
                displayName: getNetworkDisplayText(networkInfo),
              },
              device: deviceInfo,
              callbackName: currentCallbackConfig.name,
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
              controller.abort();
            }, CALLBACK_TIMEOUT);

            const response = await fetch(currentCallbackConfig.url, {
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

            bgLog(`📨 Callback response: ${response.status}`);

            // Update stats
            const savedStats = await AsyncStorage.getItem(STORAGE_KEYS.SERVICE_STATS);
            const currentStats = savedStats ? JSON.parse(savedStats) : {
              totalChecks: 0,
              successfulCallbacks: 0,
              failedCallbacks: 0,
            };

            const updatedStats = {
              ...currentStats,
              totalChecks: currentStats.totalChecks + 1,
              successfulCallbacks: currentStats.successfulCallbacks + (response.ok ? 1 : 0),
              failedCallbacks: currentStats.failedCallbacks + (response.ok ? 0 : 1),
              lastCheckTime: new Date().toISOString(),
            };

            await AsyncStorage.setItem(STORAGE_KEYS.SERVICE_STATS, JSON.stringify(updatedStats));

            // Save background check count
            const bgCount = await AsyncStorage.getItem(STORAGE_KEYS.BACKGROUND_STATS);
            const newCount = bgCount ? parseInt(bgCount, 10) + 1 : 1;
            await AsyncStorage.setItem(STORAGE_KEYS.BACKGROUND_STATS, newCount.toString());

          } catch (err: any) {
            bgLog('Error sending background callback:', err.message);
            await logError(err, 'backgroundCallback');
          }
        }

      } catch (error: any) {
        bgLog('Background task error', { error: error.message });
        await logError(error, 'backgroundTask');
      }
    };

    // Run initial check
    await runCheck();

    // Set up interval for subsequent checks
    const savedInterval = await AsyncStorage.getItem(STORAGE_KEYS.INTERVAL);
    const intervalMinutes = savedInterval ? parseInt(savedInterval, 10) : 60;
    const intervalMs = intervalMinutes * 60000;

    backgroundTaskInterval = setInterval(async () => {
      if (backgroundTaskRunning) {
        await runCheck();
      } else {
        if (backgroundTaskInterval) {
          clearInterval(backgroundTaskInterval);
          backgroundTaskInterval = null;
        }
        resolve(undefined);
      }
    }, intervalMs);
  });

  bgLog('🛑 Background task ended');
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
  const isMounted = useRef(true);

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

        if (isMounted.current) {
          setServiceStats(updatedStats);
        }
      } catch (error) {
        console.error('Error updating service stats:', error);
      }
    },
    [],
  );

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
          errorType =
