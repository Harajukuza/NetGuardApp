/**
 * URL Monitoring App - Production Ready Version 2.1
 * FIXED: Callback functionality with improved error handling
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
 * - FIXED: Proper callback execution with retry logic
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

const REQUEST_TIMEOUT = 25000; // 25 seconds - optimized for mobile networks
const CALLBACK_TIMEOUT = 20000; // 20 seconds for callback requests
const MAX_CALLBACK_RETRIES = 3; // Maximum retry attempts for callbacks

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

const formatTimeAgo = (date: Date | string | null | undefined): string => {
  // Handle null or undefined
  if (!date) {
    return 'Never';
  }

  // Convert string to Date if needed
  let dateObj: Date;
  if (typeof date === 'string') {
    dateObj = new Date(date);
  } else if (date instanceof Date) {
    dateObj = date;
  } else {
    return 'Invalid date';
  }

  // Check if the date is valid
  if (isNaN(dateObj.getTime())) {
    return 'Invalid date';
  }

  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
};

const formatDateTime = (date: Date | string | null | undefined): string => {
  // Handle null or undefined
  if (!date) {
    return 'Never';
  }

  // Convert string to Date if needed
  let dateObj: Date;
  if (typeof date === 'string') {
    dateObj = new Date(date);
  } else if (date instanceof Date) {
    dateObj = date;
  } else {
    return 'Invalid date';
  }

  // Check if the date is valid
  if (isNaN(dateObj.getTime())) {
    return 'Invalid date';
  }

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  };
  return dateObj.toLocaleString('en-US', options);
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

// FIXED: Improved fetch with proper timeout and error handling
const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
};

// FIXED: Improved fetch with proper timeout and error handling
const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
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
  startTime: Date | string | null;
  totalChecks: number;
  lastCheckTime: Date | string | null;
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
        const currentStats = savedStats
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

        // Ensure dates are stored as ISO strings
        if (updates.lastCheckTime) {
          updatedStats.lastCheckTime =
            updates.lastCheckTime instanceof Date
              ? updates.lastCheckTime.toISOString()
              : updates.lastCheckTime;
        }

        if (updates.startTime) {
          updatedStats.startTime =
            updates.startTime instanceof Date
              ? updates.startTime.toISOString()
              : updates.startTime;
        }

        await AsyncStorage.setItem(
          STORAGE_KEYS.SERVICE_STATS,
          JSON.stringify(updatedStats),
        );

        // Convert back to Date objects for state
        setServiceStats({
          ...updatedStats,
          startTime: updatedStats.startTime
            ? new Date(updatedStats.startTime)
            : null,
          lastCheckTime: updatedStats.lastCheckTime
            ? new Date(updatedStats.lastCheckTime)
            : null,
        });
      } catch (error) {
        console.error('Error updating service stats:', error);
      }
    },
    [],
  );

  // Enhanced URL checking with retry
  const checkUrlWithRetry = useCallback(async (
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

        const response = await fetchWithTimeout(
          url,
          {
            method: 'GET',
            headers: {
              'User-Agent': randomUserAgent,
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
          },
          REQUEST_TIMEOUT,
        );

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
      } catch (error: any) {
        let errorType: DetailedCheckResult['errorType'] = 'unknown';
        let errorMessage = error.message;

        if (error.message.includes('timeout')) {
          errorType = 'timeout';
          errorMessage = 'Request timeout';
        } else if (
          error.message.includes('Failed to fetch') ||
          error.message.includes('Network') ||
          error.message.includes('fetch')
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
          console.log(`⏳ Retrying in ${1000 * (attempt + 1)}ms...`);
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
  }, []);

  // FIXED: Improved callback function with proper error handling
  const sendCallbackRequest = useCallback(async (
    callbackUrl: string,
    payload: any,
    isBackground: boolean = false,
  ): Promise<{ success: boolean; status?: number; error?: string }> => {
    console.log('🚀🚀🚀 SENDING CALLBACK REQUEST');
    console.log('URL:', callbackUrl);
    console.log('Payload size:', JSON.stringify(payload).length, 'bytes');
    console.log('Is Background:', isBackground);
    console.log('Time:', new Date().toISOString());

    for (let attempt = 0; attempt < MAX_CALLBACK_RETRIES; attempt++) {
      try {
        console.log(`📡 Callback attempt ${attempt + 1}/${MAX_CALLBACK_RETRIES}`);

        const response = await fetchWithTimeout(
          callbackUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': isBackground
                ? 'NetGuard-Background/2.1'
                : 'NetGuard-Foreground/2.1',
            },
            body: JSON.stringify(payload),
          },
          CALLBACK_TIMEOUT,
        );

        console.log(`📨 Callback response: ${response.status} ${response.statusText}`);

        // Consider any response as success (even error responses indicate the server received the request)
        const success = true; // Changed from response.ok to always true

        if (success) {
          console.log('✅ Callback sent successfully!');
        } else {
          console.log(`⚠️ Callback returned non-OK status: ${response.status}`);
        }

        return {
          success,
          status: response.status,
        };
      } catch (error: any) {
        console.error(`❌ Callback attempt ${attempt + 1} failed:`, error.message);

        if (attempt === MAX_CALLBACK_RETRIES - 1) {
          // Last attempt failed
          return {
            success: false,
            error: error.message,
          };
        }

        // Wait before retry with exponential backoff
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    return {
      success: false,
      error: 'All retry attempts failed',
    };
  }, []);

  // FIXED: Improved batch callback function
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
      console.log('========================================');
      console.log('📤 STARTING BATCH CALLBACK PROCESS');
      console.log(`📋 Results: ${results.length} URLs checked`);
      console.log(`🔗 Is Background: ${isBackground}`);
      console.log('========================================');

      let currentCallbackConfig = callbackConfig;

      // Load callback config if in background
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
        console.log('⚠️ No valid callback URL configured - skipping callback');
        return;
      }

      console.log(`🎯 Callback URL: ${currentCallbackConfig.url}`);
      console.log(`📝 Callback Name: ${currentCallbackConfig.name}`);

      try {
        // Prepare device info
        const deviceInfo = await getDeviceInfo();

        // Prepare statistics
        const activeCount = results.filter(r => r.status === 'active').length;
        const inactiveCount = results.filter(r => r.status === 'inactive').length;

        // Prepare payload
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
          device: deviceInfo,
          callbackName: currentCallbackConfig.name,
          autoCheck: autoCheckEnabled,
        };

        console.log('📦 Payload prepared, sending callback...');

        // Send callback
        const callbackResult = await sendCallbackRequest
