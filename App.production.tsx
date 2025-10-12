/**
 * URL Monitoring App - Production Ready Version
 * Enhanced with complete error handling, optimizations, and production features
 * Version: 2.0.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  BackHandler,
  Keyboard,
  RefreshControl,
  Linking,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundJob from 'react-native-background-actions';

// TypeScript interfaces
interface URLItem {
  id: string;
  url: string;
  lastChecked?: Date;
  status?: 'active' | 'inactive' | 'checking';
  checkHistory?: CheckRecord[];
  errorCount?: number;
  successCount?: number;
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

interface NetworkInfo {
  type: string;
  carrier: string;
  isConnected: boolean;
}

// Constants
const STORAGE_KEYS = {
  URLS: '@URLMonitor:urls',
  CALLBACK: '@URLMonitor:callback',
  INTERVAL: '@URLMonitor:interval',
  LAST_CALLBACK: '@URLMonitor:lastCallback',
  LAST_CHECK_TIME: '@URLMonitor:lastCheckTime',
  AUTO_CHECK_ENABLED: '@URLMonitor:autoCheckEnabled',
  NEXT_CHECK_TIME: '@URLMonitor:nextCheckTime',
  API_ENDPOINT: '@URLMonitor:apiEndpoint',
  BACKGROUND_STATS: '@URLMonitor:backgroundStats',
  ERROR_LOG: '@URLMonitor:errorLog',
} as const;

const DEFAULT_INTERVAL = 60; // minutes
const MAX_CHECK_HISTORY = 20;
const MAX_ERROR_LOG = 50;
const REQUEST_TIMEOUT = 15000; // 15 seconds
const BATCH_DELAY_MIN = 5; // seconds
const BATCH_DELAY_MAX = 30; // seconds

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

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

// Error logging utility
const logError = async (error: any, context: string) => {
  try {
    const errorLog = await AsyncStorage.getItem(STORAGE_KEYS.ERROR_LOG);
    const logs = errorLog ? JSON.parse(errorLog) : [];
    logs.unshift({
      timestamp: new Date().toISOString(),
      context,
      message: error?.message || 'Unknown error',
      stack: error?.stack,
    });
    // Keep only recent errors
    if (logs.length > MAX_ERROR_LOG) {
      logs.length = MAX_ERROR_LOG;
    }
    await AsyncStorage.setItem(STORAGE_KEYS.ERROR_LOG, JSON.stringify(logs));
  } catch (e) {
    console.error('Failed to log error:', e);
  }
};

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
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backgroundTaskRef = useRef<any>(null);

  // State management
  const [urls, setUrls] = useState<URLItem[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [callbackConfig, setCallbackConfig] = useState<CallbackConfig>({
    name: '',
    url: '',
  });
  const [checkInterval, setCheckInterval] = useState(DEFAULT_INTERVAL.toString());
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo>({
    type: 'Unknown',
    carrier: 'Checking...',
    isConnected: true,
  });
  const [lastCallback, setLastCallback] = useState<CallbackHistory | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);

  // Background service states
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(false);
  const [isBackgroundServiceRunning, setIsBackgroundServiceRunning] = useState(false);
  const [nextCheckTime, setNextCheckTime] = useState<Date | null>(null);
  const [timeUntilNextCheck, setTimeUntilNextCheck] = useState<string>('');

  // API integration states
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [showAPIModal, setShowAPIModal] = useState(false);
  const [apiData, setApiData] = useState<APIURLItem[]>([]);
  const [apiCallbackNames, setApiCallbackNames] = useState<string[]>([]);
  const [selectedCallbackName, setSelectedCallbackName] = useState<string>('');
  const [isLoadingAPI, setIsLoadingAPI] = useState(false);

  // Statistics
  const [backgroundCheckCount, setBackgroundCheckCount] = useState(0);
  const [totalChecksPerformed, setTotalChecksPerformed] = useState(0);

  // Memoized values
  const sortedUrls = useMemo(() => {
    return [...urls].sort((a, b) => {
      // Sort by status: checking > inactive > active
      const statusOrder = { checking: 0, inactive: 1, active: 2 };
      const aOrder = statusOrder[a.status || 'checking'];
      const bOrder = statusOrder[b.status || 'checking'];
      return aOrder - bOrder;
    });
  }, [urls]);

  const statistics = useMemo(() => {
    return {
      total: urls.length,
      active: urls.filter(u => u.status === 'active').length,
      inactive: urls.filter(u => u.status === 'inactive').length,
      checking: urls.filter(u => u.status === 'checking').length,
      successRate: urls.length > 0
        ? Math.round((urls.filter(u => u.status === 'active').length / urls.length) * 100)
        : 0,
    };
  }, [urls]);

  // Background task function - Production version
  const backgroundTask = useCallback(async (taskData: any) => {
    console.log('🔄 Background task started (Production)');

    const intervalMinutes = taskData.parameters?.interval || DEFAULT_INTERVAL;
    const intervalMs = intervalMinutes * 60000;

    backgroundTaskRef.current = true;

    while (BackgroundJob.isRunning() && backgroundTaskRef.current) {
      try {
        console.log('🔔 Background check at:', new Date().toISOString());

        // Load current data from storage
        const [savedUrls, savedCallback, statsStr] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.URLS),
          AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
          AsyncStorage.getItem(STORAGE_KEYS.BACKGROUND_STATS),
        ]);

        if (!savedUrls) {
          console.log('No URLs configured for background check');
          await new Promise(resolve => setTimeout(resolve, intervalMs));
          continue;
        }

        const currentUrls = JSON.parse(savedUrls);
        const currentCallbackConfig = savedCallback ? JSON.parse(savedCallback) : null;

        if (currentUrls.length === 0) {
          console.log('URL list is empty');
          await new Promise(resolve => setTimeout(resolve, intervalMs));
          continue;
        }

        // Update statistics
        const currentStats = parseInt(statsStr || '0', 10);
        await AsyncStorage.setItem(
          STORAGE_KEYS.BACKGROUND_STATS,
          (currentStats + 1).toString()
        );

        // Perform background check
        await performBackgroundCheck(currentUrls, currentCallbackConfig);

        // Update last check time
        await AsyncStorage.setItem(
          STORAGE_KEYS.LAST_CHECK_TIME,
          new Date().toISOString()
        );

        // Wait for next interval
        await new Promise(resolve => setTimeout(resolve, intervalMs));

      } catch (error: any) {
        console.error('Background task error:', error);
        await logError(error, 'backgroundTask');

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }

    backgroundTaskRef.current = false;
    console.log('🛑 Background task stopped');
  }, []);

  // Enhanced background URL checking
  const performBackgroundCheck = async (
    currentUrls: URLItem[],
    callbackConfig: CallbackConfig | null,
  ) => {
    console.log(`Checking ${currentUrls.length} URLs in background...`);

    const checkResults: Array<{
      url: string;
      status: 'active' | 'inactive';
      error?: string;
      responseTime?: number;
      statusCode?: number;
      isRedirect?: boolean;
    }> = [];

    // Random sleep helper
    const randomSleep = (minSec: number, maxSec: number): Promise<void> => {
      const ms = (Math.random() * (maxSec - minSec) + minSec) * 1000;
      return new Promise(resolve => setTimeout(resolve, ms));
    };

    // Check each URL
    for (let i = 0; i < currentUrls.length; i++) {
      const urlItem = currentUrls[i];

      if (i > 0) {
        await randomSleep(BATCH_DELAY_MIN, BATCH_DELAY_MAX);
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

        checkResults.push({
          url: urlItem.url,
          status: 'inactive',
          error: error.message || 'Check failed',
          responseTime,
        });

        await logError(error, `backgroundCheck:${urlItem.url}`);
      }
    }

    // Send callback if configured
    if (callbackConfig && callbackConfig.url && checkResults.length > 0) {
      await sendBackgroundCallback(checkResults, callbackConfig);
    }
  };

  // Enhanced URL checking with retry and error handling
  const checkUrlWithRetry = async (
    url: string,
    maxRetries: number = 2,
  ): Promise<DetailedCheckResult> => {
    let lastError: DetailedCheckResult | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
          signal: controller.signal,
          redirect: 'follow',
        });

        clearTimeout(timeoutId);

        const isSuccess =
          (response.status >= 200 && response.status < 300) ||
          (response.status >= 300 && response.status < 400) ||
          response.status === 401 ||
          response.status === 403 ||
          response.status === 429;

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

        if (error.name === 'AbortError') {
          errorType = 'timeout';
          errorMessage = 'Request timeout';
        } else if (error.message?.includes('Failed to fetch') || error.message?.includes('Network')) {
          errorType = 'network';
          errorMessage = 'Network error';
        }

        lastError = {
          status: 'inactive',
          errorType,
          errorMessage,
        };

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      }
    }

    return lastError || {
      status: 'inactive',
      errorType: 'unknown',
      errorMessage: 'Unknown error',
    };
  };

  // Send background callback
  const sendBackgroundCallback = async (
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

    try {
      const [deviceId, deviceModel, deviceBrand, systemVersion] = await Promise.all([
        DeviceInfo.getUniqueId(),
        DeviceInfo.getModel(),
        DeviceInfo.getBrand(),
        DeviceInfo.getSystemVersion(),
      ]);

      const activeCount = results.filter(r => r.status === 'active').length;
      const inactiveCount = results.filter(r => r.status === 'inactive').length;

      const payload = {
        checkType: 'background_batch',
        timestamp: new Date().toISOString(),
        isBackground: true,
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
        device: {
          id: deviceId,
          model: deviceModel,
          brand: deviceBrand,
          platform: DeviceInfo.getSystemName(),
          version: systemVersion,
        },
        callbackName: callbackConfig.name,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(callbackConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NetGuard-Production/2.0',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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

      await AsyncStorage.setItem(
        STORAGE_KEYS.LAST_CALLBACK,
        JSON.stringify(callbackRecord)
      );

      console.log(`Background callback ${response.ok ? 'successful' : 'failed'}`);

    } catch (error: any) {
      console.error('Background callback error:', error);
      await logError(error, 'sendBackgroundCallback');
    }
  };

  // Start foreground auto check
  const startAutoCheck = useCallback(() => {
    clearAutoCheck();

    const intervalMinutes = parseInt(checkInterval, 10) || DEFAULT_INTERVAL;
    if (intervalMinutes < 1 || urls.length === 0) {
      return;
    }

    const now = new Date();
    const next = new Date(now.getTime() + intervalMinutes * 60000);
    setNextCheckTime(next);

    const intervalMs = intervalMinutes * 60000;

    console.log('Starting foreground auto check:', intervalMs);

    // Run immediately
    checkAllUrls(false);

    // Set interval
    intervalRef.current = setInterval(() => {
      console.log('🔔 Foreground auto check at:', new Date().toISOString());

      checkAllUrls(false);

      const newNext = new Date(new Date().getTime() + intervalMs);
      setNextCheckTime(newNext);
    }, intervalMs);

  }, [checkInterval, urls.length]);

  // Clear auto check
  const clearAutoCheck = useCallback(() => {
    if (intervalRef.current !== null) {
      console.log('Clearing auto check timer');
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setNextCheckTime(null);
    setTimeUntilNextCheck('');
  }, []);

  // Toggle auto check
  const toggleAutoCheck = async (value: boolean) => {
    if (value && urls.length === 0) {
      Alert.alert('No URLs', 'Please add URLs to monitor first');
      return;
    }

    setAutoCheckEnabled(value);

    if (value) {
      startAutoCheck();
      Alert.alert(
        'Auto Check Enabled',
        `URLs will be checked every ${checkInterval} minutes while app is active.`,
        [{ text: 'OK' }]
      );
    } else {
      clearAutoCheck();
    }
  };

  // Request Android permissions
  const requestAndroidPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        console.log('Checking Android permissions...');

        // Check if battery optimization permission is needed
        if (Platform.Version >= 23) {
          setTimeout(() => {
            Alert.alert(
              '🔋 Optimize Background Monitoring',
              'For best performance:\n\n' +
              '1. Disable battery optimization for this app\n' +
              '2. Lock the app in Recent Apps\n' +
              '3. Allow all permissions when prompted\n\n' +
              'Would you like to open settings?',
              [
                { text: 'Later', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => {
                    Linking.openSettings().catch(err =>
                      console.log('Cannot open settings:', err)
                    );
                  }
                }
              ]
            );
          }, 2000);
        }
      } catch (err: any) {
        console.log('Permission check:', err.message);
      }
    }
  };

  // Start background service
  const startBackgroundService = async () => {
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

      const intervalMinutes = parseInt(checkInterval, 10) || DEFAULT_INTERVAL;
      const options = {
        ...backgroundTaskOptions,
        parameters: {
          interval: intervalMinutes,
        },
      };

      await BackgroundJob.start(backgroundTask, options);

      setIsBackgroundServiceRunning(true);
      setAutoCheckEnabled(true);

      console.log('✅ Background service started');

      Alert.alert(
        'Background Service Started',
        `URLs will be monitored every ${intervalMinutes} minutes in background.\n\n` +
        '📱 You can minimize or close the app\n' +
        '🔔 Notification shows service status',
        [{ text: 'OK' }]
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

      backgroundTaskRef.current = false;
      await BackgroundJob.stop();

      setIsBackgroundServiceRunning(false);
      setAutoCheckEnabled(false);

      console.log('🛑 Background service stopped');

      Alert.alert('Service Stopped', 'Background monitoring has been stopped.');

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

  // Initialize app
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await loadSavedData();
        await checkNetworkInfo();
        await requestAndroidPermissions();
        await loadBackgroundStats();

        // Check if background service is running
        const isRunning = BackgroundJob.isRunning();
        setIsBackgroundServiceRunning(isRunning);

      } catch (error: any) {
        console.error('App initialization error:', error);
        await logError(error, 'initializeApp');
      }
    };

    initializeApp();

    // Handle back button
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (isBackgroundServiceRunning) {
          Alert.alert(
            'Background Service Running',
            'URL monitoring is active. Exit anyway?',
            [
              { text: 'Stay', style: 'cancel' },
              {
                text: 'Exit',
                style: 'destructive',
                onPress: () => BackHandler.exitApp()
              }
            ]
          );
          return true;
        }
        return false;
      }
    );

    return () => backHandler.remove();
  }, []);

  // Load background stats
  const loadBackgroundStats = async () => {
    try {
      const stats = await AsyncStorage.getItem(STORAGE_KEYS.BACKGROUND_STATS);
      if (stats) {
        setBackgroundCheckCount(parseInt(stats, 10) || 0);
      }
    } catch (error: any) {
      console.error('Error loading stats:', error);
      await logError(error, 'loadBackgroundStats');
    }
  };

  // Handle app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState: AppStateStatus) => {
        console.log('App State:', nextAppState);

        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === 'active'
        ) {
          console.log('App returned to foreground');

          // Refresh data
          loadBackgroundStats();
          setIsBackgroundServiceRunning(BackgroundJob.isRunning());

          // Check if we missed scheduled check
          if (autoCheckEnabled && nextCheckTime && !isBackgroundServiceRunning) {
            const now = new Date();
            if (now >= nextCheckTime) {
              console.log('Running missed check');
              checkAllUrls(false);

              const intervalMinutes = parseInt(checkInterval, 10) || DEFAULT_INTERVAL;
              const newNext = new Date(now.getTime() + intervalMinutes * 60000);
              setNextCheckTime(newNext);
            }
          }
        }

        appState.current = nextAppState;
      }
    );

    return () => subscription.remove();
  }, [autoCheckEnabled, nextCheckTime, checkInterval, isBackgroundServiceRunning]);

  // Auto check effect
  useEffect(() => {
    if (autoCheckEnabled && urls.length > 0 && !isBackgroundServiceRunning) {
      startAutoCheck();
    } else if (!autoCheckEnabled || isBackgroundServiceRunning) {
      clearAutoCheck();
    }

    return () => {
      clearAutoCheck();
    };
  }, [autoCheckEnabled, checkInterval, urls.length, isBackgroundServiceRunning, startAutoCheck, clearAutoCheck]);

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
      countdownIntervalRef.current = setInterval(updateCountdown, 1000);

      return () => {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
      };
    } else {
      setTimeUntilNextCheck('');
    }
  }, [nextCheckTime, autoCheckEnabled, isBackgroundServiceRunning]);

  // Save data effects
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const saveTimer = setTimeout(async () => {
      try {
        await AsyncStorage.multiSet([
          [STORAGE_KEYS.URLS, JSON.stringify(urls)],
          [STORAGE_KEYS.INTERVAL, checkInterval],
          [STORAGE_KEYS.AUTO_CHECK_ENABLED, JSON.stringify(autoCheckEnabled)],
        ]);

        if (lastCheckTime) {
          await AsyncStorage.setItem(
            STORAGE_KEYS.LAST_CHECK_TIME,
            lastCheckTime.toISOString()
          );
        }
        if (nextCheckTime) {
          await AsyncStorage.setItem(
            STORAGE_KEYS.NEXT_CHECK_TIME,
            nextCheckTime.toISOString()
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
  }, [urls, checkInterval, lastCheckTime, autoCheckEnabled, nextCheckTime, apiEndpoint]);

  // Save callback configuration
  useEffect(() => {
    if (callbackConfig.url || callbackConfig.name) {
      AsyncStorage.setItem(
        STORAGE_KEYS.CALLBACK,
        JSON.stringify(callbackConfig)
      ).catch(error => logError(error, 'saveCallback'));
    }
  }, [callbackConfig]);

  // Save last callback
  useEffect(() => {
    if (lastCallback) {
      AsyncStorage.setItem(
        STORAGE_KEYS.LAST_CALLBACK,
        JSON.stringify(lastCallback)
      ).catch(error => logError(error, 'saveLastCallback'));
    }
  }, [lastCallback]);

  // Load saved data
  const loadSavedData = async () => {
    try {
      const keys = Object.values(STORAGE_KEYS);
      const results = await AsyncStorage.multiGet(keys);
      const data = Object.fromEntries(results);

      if (data[STORAGE_KEYS.URLS]) {
        const parsedUrls = JSON.parse(data[
