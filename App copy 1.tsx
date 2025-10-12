/**
 * URL Monitoring App - Android Optimized Version
 * Features:
 * - Monitor multiple URLs
 * - Check network carrier
 * - Send batch callbacks
 * - Persistent storage
 * - Show all URLs in callback history
 * - Auto check with interval
 * - Background support for Android
 * - API integration for loading URLs
 */

import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundTimer from 'react-native-background-timer';
import BackgroundJob from 'react-native-background-actions';

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

const task_options = {
  taskName: 'Example Task',
  taskTitle: 'App is running in the background',
  taskDesc: 'Your task is currently active.',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#ff00ff',
  linkingURI: 'yourApp://', // Required for iOS
  parameters: {
    delay: 1000,
  },
};

// Storage keys
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
  const intervalRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
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
  const [networkInfo, setNetworkInfo] = useState({
    type: 'Unknown',
    carrier: 'Checking...',
    isConnected: true,
  });
  const [lastCallback, setLastCallback] = useState<CallbackHistory | null>(
    null,
  );
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);

  // New states for auto check
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(false);
  const [nextCheckTime, setNextCheckTime] = useState<Date | null>(null);
  const [timeUntilNextCheck, setTimeUntilNextCheck] = useState<string>('');

  // New states for API integration
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [showAPIModal, setShowAPIModal] = useState(false);
  const [apiData, setApiData] = useState<APIURLItem[]>([]);
  const [apiCallbackNames, setApiCallbackNames] = useState<string[]>([]);
  const [selectedCallbackName, setSelectedCallbackName] = useState<string>('');
  const [isLoadingAPI, setIsLoadingAPI] = useState(false);

  // Background check stats
  const [backgroundCheckCount, setBackgroundCheckCount] = useState(0);

  const checkUrlWithRetry = async (
    url: string,
    maxRetries: number = 2,
  ): Promise<DetailedCheckResult> => {
    let lastError: DetailedCheckResult | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // ใช้ User-Agent ที่เหมือน browser จริง
        const userAgents = [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        ];

        const randomUserAgent =
          userAgents[Math.floor(Math.random() * userAgents.length)];

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // เพิ่ม timeout เป็น 15 วินาที

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
          redirect: 'follow', // ติดตาม redirect อัตโนมัติ
        });

        clearTimeout(timeoutId);

        // เงื่อนไขที่ครอบคลุมมากขึ้น
        const isSuccess =
          // 2xx - Success
          (response.status >= 200 && response.status < 300) ||
          // 3xx - Redirects (ถือว่า active เพราะเว็บยังทำงาน)
          (response.status >= 300 && response.status < 400) ||
          // 401, 403 - Authentication/Forbidden (เว็บทำงานแต่ต้องการ auth)
          response.status === 401 ||
          response.status === 403 ||
          // 429 - Too Many Requests (เว็บทำงานแต่จำกัด rate)
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

        // ถ้ายังมี retry เหลือ รอสักครู่แล้วลองใหม่
        if (attempt < maxRetries) {
          await new Promise(resolve =>
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

  // Request permissions on Android
  const requestAndroidPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        // Request battery optimization exemption
        const batteryOptimizationGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS
            .REQUEST_IGNORE_BATTERY_OPTIMIZATIONS as any,
          {
            title: 'Background Activity Permission',
            message:
              'NetGuard needs to run in background to monitor URLs continuously.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'Allow',
          },
        );

        if (batteryOptimizationGranted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('Battery optimization permission granted');
        }
      } catch (err) {
        console.warn('Permission request error:', err);
      }
    }
  };

  // Initialize app
  useEffect(() => {
    loadSavedData();
    checkNetworkInfo();
    requestAndroidPermissions();
    loadBackgroundStats();
  }, []);

  // Load background stats
  const loadBackgroundStats = async () => {
    try {
      const stats = await AsyncStorage.getItem(STORAGE_KEYS.BACKGROUND_STATS);
      if (stats) {
        setBackgroundCheckCount(parseInt(stats, 10) || 0);
      }
    } catch (error) {
      console.error('Error loading background stats:', error);
    }
  };

  // Handle app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState: AppStateStatus) => {
        console.log('App State changed to:', nextAppState);

        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === 'active'
        ) {
          // App came back to foreground
          console.log('App returned to foreground');
          loadBackgroundStats(); // Reload stats

          // Check if we missed any scheduled checks
          if (autoCheckEnabled && nextCheckTime) {
            const now = new Date();
            if (now >= nextCheckTime) {
              console.log('Missed scheduled check, running now');
              checkAllUrls();

              // Calculate next check time
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
  }, [autoCheckEnabled, nextCheckTime, checkInterval, urls]);

  // Manage auto check timer
  useEffect(() => {
    if (autoCheckEnabled && urls.length > 0) {
      startAutoCheck();
    } else {
      clearAutoCheck();
    }

    return () => {
      clearAutoCheck();
    };
  }, [autoCheckEnabled, checkInterval, urls.length]);

  // Update countdown timer
  useEffect(() => {
    if (nextCheckTime && autoCheckEnabled) {
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
  }, [nextCheckTime, autoCheckEnabled]);

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
      } catch (error) {
        console.error('Error saving data:', error);
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

  // Load data from API
  const loadFromAPI = async () => {
    if (!apiEndpoint) {
      Alert.alert('Error', 'Please enter API endpoint URL');
      return;
    }

    setIsLoadingAPI(true);
    try {
      const response = await fetch(apiEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: APIResponse = await response.json();

      if (data.status === 'success' && data.data) {
        setApiData(data.data);

        // Extract unique callback names
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

  // Load URLs for selected callback name
  const loadURLsForCallback = (callbackName: string) => {
    const filteredData = apiData.filter(
      item => item.callback_name === callbackName,
    );

    if (filteredData.length === 0) {
      Alert.alert('Error', 'No URLs found for this callback');
      return;
    }

    // ใช้ callback_url จากข้อมูล API
    const callbackUrl = filteredData[0].callback_url;

    // Set callback configuration
    setCallbackConfig({
      name: callbackName,
      url: callbackUrl,
    });

    // Add URLs to monitoring list
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

  // Start auto check with background support
  const startAutoCheck = () => {
    clearAutoCheck(); // Clear any existing intervals

    const intervalMinutes = parseInt(checkInterval, 10);
    if (isNaN(intervalMinutes) || intervalMinutes < 1 || urls.length === 0) {
      return;
    }

    // Calculate next check time
    const now = new Date();
    const next = new Date(now.getTime() + intervalMinutes * 60000);
    setNextCheckTime(next);

    // Use BackgroundTimer for true background execution
    const intervalMs = intervalMinutes * 60000;

    console.log('Starting background timer with interval:', intervalMs);

    // Run immediately first - ใช้ false เพื่อให้ใช้ state ปัจจุบัน
    checkAllUrls(false);

    // Then set interval with BackgroundTimer
    intervalRef.current = BackgroundTimer.setInterval(() => {
      console.log(
        '🔔 Background timer triggered at:',
        new Date().toISOString(),
      );

      // Check if app is in background
      const isInBackground = AppState.currentState !== 'active';

      // Update background check count only if truly in background
      if (isInBackground) {
        incrementBackgroundCheckCount();
      }

      // Check all URLs with appropriate mode
      checkAllUrls(isInBackground);

      // Update next check time
      const newNext = new Date(new Date().getTime() + intervalMs);
      setNextCheckTime(newNext);
    }, intervalMs);

    console.log(
      `Auto check started - will check every ${intervalMinutes} minutes (even in background)`,
    );
  };

  // Clear auto check with background support
  const clearAutoCheck = () => {
    if (intervalRef.current !== null) {
      console.log('Clearing background timer');
      BackgroundTimer.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setNextCheckTime(null);
    setTimeUntilNextCheck('');
  };

  // Increment background check count
  const incrementBackgroundCheckCount = async () => {
    try {
      const newCount = backgroundCheckCount + 1;
      setBackgroundCheckCount(newCount);
      await AsyncStorage.setItem(
        STORAGE_KEYS.BACKGROUND_STATS,
        newCount.toString(),
      );
    } catch (error) {
      console.error('Error saving background stats:', error);
    }
  };

  // Toggle auto check
  const toggleAutoCheck = async (value: boolean) => {
    if (value && urls.length === 0) {
      Alert.alert('No URLs', 'Please add URLs to monitor first');
      return;
    }

    setAutoCheckEnabled(value);

    if (value) {
      Alert.alert(
        'Auto Check Enabled',
        `URLs will be checked every ${checkInterval} minutes.\n\n` +
          '✅ The app will continue checking in background.\n' +
          '📱 For best results on Android:\n' +
          '• Disable battery optimization for this app\n' +
          '• Lock the app in recent apps\n' +
          '• Keep the app in memory',
        [{ text: 'OK' }],
      );
    } else {
      console.log('Auto check disabled');
    }
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

  // Check network information including carrier
  const checkNetworkInfo = async () => {
    try {
      const carrier = await DeviceInfo.getCarrier();
      setNetworkInfo({
        type: 'cellular',
        carrier: carrier || 'Unknown',
        isConnected: true,
      });
    } catch (error) {
      console.error('Error checking network:', error);
      setNetworkInfo({
        type: 'Unknown',
        carrier: 'Error',
        isConnected: false,
      });
    }
  };

  // Get formatted network display text
  const getNetworkDisplayText = () => {
    const { type, carrier, isConnected } = networkInfo;

    if (!isConnected) {
      return 'No Connection';
    }

    // For emulator
    if (carrier === 'Android' || carrier === '' || carrier === 'T-Mobile') {
      return carrier || 'Emulator (No SIM)';
    }

    if (type === 'cellular' && carrier !== 'Unknown') {
      const carrierMap: { [key: string]: string } = {
        'TRUE-H': 'True Move H',
        TRUE: 'True',
        AIS: 'AIS',
        DTAC: 'DTAC',
        AWN: 'AIS',
        'TH GSM': 'True Move',
        'my by CAT': 'CAT',
        TOT: 'TOT',
        NT: 'NT',
      };

      let displayCarrier = carrier;
      for (const [key, value] of Object.entries(carrierMap)) {
        if (carrier.toUpperCase().includes(key)) {
          displayCarrier = value;
          break;
        }
      }

      return `${displayCarrier} (${type})`;
    } else if (type === 'wifi') {
      return 'WiFi';
    } else {
      return carrier;
    }
  };

  // Normalize URL (add https:// if missing)
  const normalizeUrl = (url: string): string => {
    let normalizedUrl = url.trim();

    if (!normalizedUrl.match(/^https?:\/\//i)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    return normalizedUrl;
  };

  // Validate URL
  const isValidUrl = (url: string): boolean => {
    try {
      const urlPattern =
        /^https?:\/\/([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
      return urlPattern.test(url);
    } catch {
      return false;
    }
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

    // Check single URL immediately when added
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
              clearAutoCheck();
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
          // Keep only last 10 records
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
  const checkAllUrls = async (isBackground: boolean = false) => {
    // ใช้ URLs จาก state ปัจจุบันเสมอเมื่อไม่ใช่ background
    let currentUrls = urls;

    // โหลดจาก storage เฉพาะเมื่อเป็น background จริงๆ
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
      setIsLoading(false); // ต้องปิด loading ถ้าไม่มี URLs
      return;
    }

    setIsLoading(true);
    setLastCheckTime(new Date());
    console.log(
      `Checking ${currentUrls.length} URLs${
        isBackground ? ' in background' : ''
      }...`,
    );

    // Array to store all check results
    const checkResults: Array<{
      url: string;
      status: 'active' | 'inactive';
      error?: string;
      responseTime?: number;
      statusCode?: number;
      isRedirect?: boolean;
    }> = [];

    // Helper function for random sleep
    const randomSleep = (
      minSeconds: number = 0,
      maxSeconds: number = 30,
    ): Promise<void> => {
      const randomMs =
        (Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000;
      console.log(`Sleeping for ${(randomMs / 1000).toFixed(2)} seconds...`);
      return new Promise(resolve => setTimeout(resolve, randomMs));
    };

    // Function to check single URL for batch
    const checkUrlForBatch = async (urlItem: URLItem, index: number) => {
      // Add random delay before checking each URL (except the first one)
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

        // อัพเดท UI เสมอเมื่อไม่ใช่ background หรือเมื่อ app อยู่ใน foreground
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

    // Check URLs sequentially with random delays
    try {
      // Sequential checking with random delays
      for (let i = 0; i < currentUrls.length; i++) {
        await checkUrlForBatch(currentUrls[i], i);
      }
    } catch (error) {
      console.error('Error checking URLs:', error);
    }

    // ใช้ callback config จาก state เมื่อไม่ใช่ background
    let currentCallbackConfig = callbackConfig;
    if (isBackground && AppState.currentState !== 'active') {
      try {
        const savedCallback = await AsyncStorage.getItem(STORAGE_KEYS.CALLBACK);
        if (savedCallback) {
          currentCallbackConfig = JSON.parse(savedCallback);
        }
      } catch (error) {
        console.error('Error loading callback config for background:', error);
      }
    }

    // Send single batch callback with all results
    if (currentCallbackConfig.url && checkResults.length > 0) {
      await sendBatchCallback(checkResults, isBackground);
    }

    setIsLoading(false);
  };

  // Send batch callback with all results
  const sendBatchCallback = async (
    results: Array<{
      url: string;
      status: 'active' | 'inactive';
      error?: string;
      responseTime?: number;
    }>,
    isBackground: boolean = false,
  ) => {
    // Load callback config for background
    let currentCallbackConfig = callbackConfig;
    if (isBackground) {
      try {
        const savedCallback = await AsyncStorage.getItem(STORAGE_KEYS.CALLBACK);
        if (savedCallback) {
          currentCallbackConfig = JSON.parse(savedCallback);
        }
      } catch (error) {
        console.error('Error loading callback for background:', error);
        return;
      }
    }

    if (!currentCallbackConfig.url || !isValidUrl(currentCallbackConfig.url)) {
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
      const inactiveCount = results.filter(r => r.status === 'inactive').length;

      const payload = {
        checkType: 'batch',
        timestamp: new Date().toISOString(),
        isBackground: isBackground,
        backgroundCheckCount: backgroundCheckCount,
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
          displayName: getNetworkDisplayText(),
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
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(currentCallbackConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'URLMonitor/1.0',
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

      if (!isBackground) {
        setLastCallback(callbackRecord);
      } else {
        // Save callback history for background checks
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

      const activeCount = results.filter(r => r.status === 'active').length;
      const inactiveCount = results.filter(r => r.status === 'inactive').length;

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

      if (!isBackground) {
        setLastCallback(errorCallback);
      } else {
        // Save error callback for background
        await AsyncStorage.setItem(
          STORAGE_KEYS.LAST_CALLBACK,
          JSON.stringify(errorCallback),
        );
      }
    }
  };

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

    // Restart auto check if enabled to apply new interval
    if (autoCheckEnabled) {
      startAutoCheck();
    }
  };

  // Format date/time for display
  const formatDateTime = (date: Date) => {
    return new Date(date).toLocaleString('th-TH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Format time ago
  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor(
      (new Date().getTime() - new Date(date).getTime()) / 1000,
    );

    if (seconds < 60) return `${seconds} seconds ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return `${days} days ago`;
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
          <Text style={[styles.title, textStyle]}>URL Monitor</Text>
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

        {/* Auto Check Status */}
        {autoCheckEnabled && (
          <View style={[cardStyle, styles.autoCheckStatus]}>
            <View style={styles.autoCheckHeader}>
              <Text style={[styles.autoCheckTitle, textStyle]}>
                🔄 Auto Check Active
              </Text>
              {timeUntilNextCheck && (
                <Text style={[styles.countdownText, textStyle]}>
                  Next: {timeUntilNextCheck}
                </Text>
              )}
            </View>
            {nextCheckTime && (
              <Text style={[styles.nextCheckText, textStyle]}>
                Next check at {formatDateTime(nextCheckTime)}
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
                {getNetworkDisplayText()}
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
            onPress={checkNetworkInfo}
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
              URLs to Monitor
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
          {urls.map(url => (
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

                {/* แสดงข้อมูลเพิ่มเติม */}
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

        {/* Check Interval & Auto Check */}
        <View style={cardStyle}>
          <Text style={[styles.sectionTitle, textStyle]}>
            Automation Settings
          </Text>

          {/* Check Interval */}
          <Text style={[styles.subSectionTitle, textStyle]}>
            Check Interval
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

          {/* Auto Check Toggle */}
          <View style={styles.autoCheckRow}>
            <View style={styles.autoCheckInfo}>
              <Text style={[styles.autoCheckLabel, textStyle]}>Auto Check</Text>
              <Text style={[styles.autoCheckDescription, textStyle]}>
                Automatically check URLs every {checkInterval} minutes
              </Text>
            </View>
            <Switch
              value={autoCheckEnabled}
              onValueChange={toggleAutoCheck}
              trackColor={{ false: '#767577', true: '#81b0ff' }}
              thumbColor={autoCheckEnabled ? '#2196F3' : '#f4f3f4'}
            />
          </View>

          {/* Background Tips for Android */}
          {Platform.OS === 'android' && (
            <View style={styles.androidTips}>
              <Text style={[styles.androidTipsTitle, textStyle]}>
                💡 Android Background Tips:
              </Text>
              <Text style={[styles.androidTipsText, textStyle]}>
                • Lock app in Recent Apps (swipe & tap lock icon)
              </Text>
              <Text style={[styles.androidTipsText, textStyle]}>
                • Disable battery optimization in Settings
              </Text>
              <Text style={[styles.androidTipsText, textStyle]}>
                • Keep app open in background for best results
              </Text>
            </View>
          )}
        </View>

        {/* Check Now Button */}
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
            ℹ️ Note: Background checks work best on Android when:{'\n'}• App is
            locked in recent apps{'\n'}• Battery optimization is disabled{'\n'}•
            Device is not in power saving mode
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  autoCheckStatus: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
    borderWidth: 1,
  },
  autoCheckHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  autoCheckTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E7D32',
  },
  countdownText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  nextCheckText: {
    fontSize: 12,
    color: '#2E7D32',
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
  subSectionTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
    marginTop: 12,
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
  autoCheckRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  autoCheckInfo: {
    flex: 1,
    marginRight: 12,
  },
  autoCheckLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  autoCheckDescription: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 2,
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
  },
  // New styles for API integration
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
