/**
 * NetGuard - Enhanced Background URL Monitor
 * Supports both Android Foreground Service and iOS Background Tasks
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  PermissionsAndroid,
  NativeModules,
  NativeEventEmitter,
  Linking,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundJob from 'react-native-background-actions';
import BackgroundTimer from 'react-native-background-timer';
import DeviceInfo from 'react-native-device-info';

// Import platform specific modules
let BackgroundFetch: any = null;
let Notifee: any = null;

// Conditional imports for iOS Background Fetch
if (Platform.OS === 'ios') {
  try {
    BackgroundFetch = require('react-native-background-fetch').default;
  } catch (e) {
    console.log('BackgroundFetch not available');
  }
}

// Conditional imports for Android Notifications
if (Platform.OS === 'android') {
  try {
    Notifee = require('@notifee/react-native').default;
  } catch (e) {
    console.log('Notifee not available');
  }
}

// Types
interface URLItem {
  id: string;
  url: string;
  lastChecked?: Date;
  status?: 'active' | 'inactive' | 'checking' | 'error';
  responseTime?: number;
  errorMessage?: string;
}

interface CallbackConfig {
  name: string;
  url: string;
  enabled: boolean;
}

interface MonitoringStats {
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  lastCheckTime?: Date;
  averageResponseTime?: number;
}

// Storage keys
const STORAGE_KEYS = {
  URLS: '@NetGuard:urls',
  CALLBACK: '@NetGuard:callback',
  INTERVAL: '@NetGuard:interval',
  STATS: '@NetGuard:stats',
  SERVICE_CONFIG: '@NetGuard:serviceConfig',
};

// Background task options for Android
const androidBackgroundOptions = {
  taskName: 'NetGuardMonitor',
  taskTitle: 'NetGuard Active',
  taskDesc: 'Monitoring URLs in background',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#ff6600',
  linkingURI: 'netguard://monitor',
  progressBar: {
    max: 100,
    value: 0,
    indeterminate: true,
  },
  parameters: {
    delay: 1000,
  },
};

// iOS Background Fetch configuration
const iosBackgroundConfig = {
  minimumFetchInterval: 15, // 15 minutes minimum
  forceAlarmManager: false,
  stopOnTerminate: false,
  startOnBoot: true,
  enableHeadless: true,
  requiresCharging: false,
  requiresDeviceIdle: false,
  requiresBatteryNotLow: false,
  requiresStorageNotLow: false,
  requiredNetworkType: BackgroundFetch?.NETWORK_TYPE_ANY,
};

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={isDarkMode ? '#1a1a1a' : '#f5f5f5'}
        translucent={false}
      />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const isDarkMode = useColorScheme() === 'dark';
  const appState = useRef(AppState.currentState);
  const backgroundTimerRef = useRef<any>(null);

  // States
  const [urls, setUrls] = useState<URLItem[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [callbackConfig, setCallbackConfig] = useState<CallbackConfig>({
    name: '',
    url: '',
    enabled: false,
  });
  const [checkInterval, setCheckInterval] = useState('60');
  const [isLoading, setIsLoading] = useState(false);
  const [isServiceRunning, setIsServiceRunning] = useState(false);
  const [stats, setStats] = useState<MonitoringStats>({
    totalChecks: 0,
    successfulChecks: 0,
    failedChecks: 0,
  });
  const [permissions, setPermissions] = useState({
    notifications: false,
    battery: false,
    background: false,
  });

  // Android: Request permissions
  const requestAndroidPermissions = async () => {
    if (Platform.OS !== 'android') return true;

    try {
      // Request notification permission for Android 13+
      if (Platform.Version >= 33) {
        const notificationPermission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Notification Permission',
            message:
              'NetGuard needs notification permission to show monitoring status',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );

        setPermissions(prev => ({
          ...prev,
          notifications:
            notificationPermission === PermissionsAndroid.RESULTS.GRANTED,
        }));
      }

      // Request battery optimization exemption
      if (DeviceInfo.getApiLevelSync() >= 23) {
        const batteryOptimizationEnabled =
          await DeviceInfo.isBatteryChargingSync();

        if (!batteryOptimizationEnabled) {
          Alert.alert(
            'Battery Optimization',
            'For best background performance, please disable battery optimization for NetGuard',
            [
              { text: 'Later', style: 'cancel' },
              {
                text: 'Settings',
                onPress: () => {
                  if (Platform.OS === 'android') {
                    Linking.openSettings();
                  }
                },
              },
            ],
          );
        }
      }

      return true;
    } catch (error) {
      console.error('Permission error:', error);
      return false;
    }
  };

  // iOS: Configure background fetch
  const configureiOSBackgroundFetch = async () => {
    if (Platform.OS !== 'ios' || !BackgroundFetch) return;

    try {
      // Configure BackgroundFetch
      await BackgroundFetch.configure(
        iosBackgroundConfig,
        async (taskId: string) => {
          console.log('[BackgroundFetch] taskId:', taskId);

          // Perform background task
          await performBackgroundCheck();

          // Finish the task
          BackgroundFetch.finish(taskId);
        },
        (taskId: string) => {
          console.log('[BackgroundFetch] TIMEOUT taskId:', taskId);
          BackgroundFetch.finish(taskId);
        },
      );

      // Check authorization status
      const status = await BackgroundFetch.status();
      console.log('[BackgroundFetch] status:', status);

      switch (status) {
        case BackgroundFetch.STATUS_RESTRICTED:
          Alert.alert(
            'Background Fetch',
            'Background fetch is restricted on this device',
          );
          break;
        case BackgroundFetch.STATUS_DENIED:
          Alert.alert(
            'Background Fetch',
            'Background fetch is denied. Please enable it in Settings > General > Background App Refresh',
          );
          break;
        case BackgroundFetch.STATUS_AVAILABLE:
          console.log('[BackgroundFetch] Background fetch is enabled');
          break;
      }
    } catch (error) {
      console.error('[BackgroundFetch] configuration error:', error);
    }
  };

  // Android: Setup notification channel
  const setupAndroidNotificationChannel = async () => {
    if (Platform.OS !== 'android' || !Notifee) return;

    try {
      // Create a channel
      await Notifee.createChannel({
        id: 'netguard_monitor',
        name: 'URL Monitoring',
        importance: Notifee.AndroidImportance.LOW,
        vibration: false,
        lights: false,
      });

      // Request permission to display notifications
      await Notifee.requestPermission();
    } catch (error) {
      console.error('Notification setup error:', error);
    }
  };

  // Android: Display foreground notification
  const displayForegroundNotification = async (message: string) => {
    if (Platform.OS !== 'android' || !Notifee) return;

    try {
      await Notifee.displayNotification({
        title: 'NetGuard Active',
        body: message,
        android: {
          channelId: 'netguard_monitor',
          smallIcon: 'ic_launcher',
          color: '#ff6600',
          ongoing: true,
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
          actions: [
            {
              title: 'Stop Monitoring',
              pressAction: {
                id: 'stop',
              },
            },
          ],
        },
      });
    } catch (error) {
      console.error('Notification display error:', error);
    }
  };

  // Enhanced background task for Android
  const androidBackgroundTask = async (taskData: any) => {
    console.log('🔄 Android background task started');

    const intervalMs = (taskData?.interval || 60) * 60000;

    // Display persistent notification
    await displayForegroundNotification('Monitoring URLs...');

    // Use BackgroundTimer for more reliable timing
    BackgroundTimer.runBackgroundTimer(async () => {
      try {
        console.log('📡 Checking URLs in Android background...');
        await performBackgroundCheck();

        // Update notification with stats
        const currentStats = await AsyncStorage.getItem(STORAGE_KEYS.STATS);
        if (currentStats) {
          const parsedStats = JSON.parse(currentStats);
          await displayForegroundNotification(
            `Checked ${parsedStats.totalChecks} times | ${urls.length} URLs active`,
          );
        }
      } catch (error) {
        console.error('Background check error:', error);
      }
    }, intervalMs);

    // Keep the task alive
    while (BackgroundJob.isRunning()) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    // Stop the timer when task stops
    BackgroundTimer.stopBackgroundTimer();
    console.log('🛑 Android background task stopped');
  };

  // iOS Background task using BackgroundTimer
  const iosBackgroundTask = () => {
    if (Platform.OS !== 'ios') return;

    console.log('🔄 iOS background task started');

    const intervalMs = parseInt(checkInterval) * 60000;

    // Use BackgroundTimer for iOS
    backgroundTimerRef.current = BackgroundTimer.setInterval(async () => {
      console.log('📡 Checking URLs in iOS background...');
      await performBackgroundCheck();
    }, intervalMs);
  };

  // Unified background check function
  const performBackgroundCheck = async () => {
    try {
      // Load current data from storage
      const [savedUrls, savedCallback, savedStats] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.URLS),
        AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
        AsyncStorage.getItem(STORAGE_KEYS.STATS),
      ]);

      if (!savedUrls) return;

      const currentUrls: URLItem[] = JSON.parse(savedUrls);
      const callbackConfig = savedCallback ? JSON.parse(savedCallback) : null;
      const currentStats = savedStats
        ? JSON.parse(savedStats)
        : {
            totalChecks: 0,
            successfulChecks: 0,
            failedChecks: 0,
          };

      const results = [];
      const updatedUrls = [];
      let totalResponseTime = 0;
      let successCount = 0;

      // Check each URL
      for (const urlItem of currentUrls) {
        const startTime = Date.now();

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(urlItem.url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
              'User-Agent': 'NetGuard/1.0',
              'Cache-Control': 'no-cache',
            },
          });

          clearTimeout(timeoutId);

          const responseTime = Date.now() - startTime;
          const isActive = response.status >= 200 && response.status < 400;

          updatedUrls.push({
            ...urlItem,
            status: isActive ? ('active' as const) : ('inactive' as const),
            lastChecked: new Date(),
            responseTime,
          });

          results.push({
            url: urlItem.url,
            status: isActive ? 'active' : 'inactive',
            responseTime,
            statusCode: response.status,
          });

          if (isActive) {
            successCount++;
            totalResponseTime += responseTime;
          }
        } catch (error: any) {
          const responseTime = Date.now() - startTime;

          updatedUrls.push({
            ...urlItem,
            status: 'error' as const,
            lastChecked: new Date(),
            responseTime,
            errorMessage: error.message,
          });

          results.push({
            url: urlItem.url,
            status: 'error',
            error: error.message,
            responseTime,
          });
        }
      }

      // Update stats
      const newStats = {
        totalChecks: currentStats.totalChecks + 1,
        successfulChecks: currentStats.successfulChecks + successCount,
        failedChecks:
          currentStats.failedChecks + (currentUrls.length - successCount),
        lastCheckTime: new Date(),
        averageResponseTime:
          successCount > 0 ? totalResponseTime / successCount : 0,
      };

      // Save updated data
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.URLS, JSON.stringify(updatedUrls)),
        AsyncStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(newStats)),
      ]);

      // Send callback if configured and enabled
      if (
        callbackConfig?.enabled &&
        callbackConfig?.url &&
        results.length > 0
      ) {
        await sendCallback(results, callbackConfig, true);
      }

      console.log(
        `✅ Background check completed: ${successCount}/${currentUrls.length} URLs active`,
      );
    } catch (error) {
      console.error('❌ Background check failed:', error);
    }
  };

  // Enhanced callback with retry logic
  const sendCallback = async (
    results: any[],
    config: CallbackConfig,
    isBackground: boolean = false,
    retryCount: number = 0,
  ): Promise<void> => {
    const maxRetries = 3;

    try {
      const payload = {
        timestamp: new Date().toISOString(),
        isBackground,
        deviceInfo: {
          platform: Platform.OS,
          version: Platform.Version,
          deviceId: await DeviceInfo.getUniqueId(),
          batteryLevel: await DeviceInfo.getBatteryLevel(),
        },
        stats,
        results,
      };

      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NetGuard-Name': config.name || 'NetGuard',
          'X-NetGuard-Version': '1.0.0',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000), // 15 second timeout
      });

      if (!response.ok && retryCount < maxRetries) {
        console.log(
          `Callback failed with status ${response.status}, retrying...`,
        );
        await new Promise(resolve =>
          setTimeout(resolve, 2000 * (retryCount + 1)),
        );
        return sendCallback(results, config, isBackground, retryCount + 1);
      }

      console.log('✅ Callback sent successfully');
    } catch (error) {
      if (retryCount < maxRetries) {
        console.log(
          `Callback error, retrying... (${retryCount + 1}/${maxRetries})`,
        );
        await new Promise(resolve =>
          setTimeout(resolve, 2000 * (retryCount + 1)),
        );
        return sendCallback(results, config, isBackground, retryCount + 1);
      }
      console.error('❌ Callback failed after retries:', error);
    }
  };

  // Start background service (platform specific)
  const startBackgroundService = async () => {
    try {
      if (urls.length === 0) {
        Alert.alert('No URLs', 'Please add URLs to monitor first');
        return;
      }

      // Request permissions first
      if (Platform.OS === 'android') {
        const hasPermissions = await requestAndroidPermissions();
        if (!hasPermissions) {
          Alert.alert(
            'Permissions Required',
            'Please grant necessary permissions for background monitoring',
          );
          return;
        }

        // Setup notification channel
        await setupAndroidNotificationChannel();

        // Start Android background service
        const options = {
          ...androidBackgroundOptions,
          parameters: {
            ...androidBackgroundOptions.parameters,
            interval: parseInt(checkInterval),
          },
        };

        await BackgroundJob.start(androidBackgroundTask, options);
        setIsServiceRunning(true);

        Alert.alert(
          'Service Started',
          'Android background monitoring is now active. You can close the app and monitoring will continue.',
        );
      } else if (Platform.OS === 'ios') {
        // Configure iOS background fetch
        await configureiOSBackgroundFetch();

        // Start iOS background timer
        iosBackgroundTask();
        setIsServiceRunning(true);

        // Schedule initial background fetch
        if (BackgroundFetch) {
          await BackgroundFetch.scheduleTask({
            taskId: 'com.netguard.monitor',
            delay: 60000, // 1 minute
            periodic: true,
            stopOnTerminate: false,
            enableHeadless: true,
          });
        }

        Alert.alert(
          'Service Started',
          'iOS background monitoring is now active. Note: iOS may limit background execution based on usage patterns.',
        );
      }

      // Save service state
      await AsyncStorage.setItem(
        STORAGE_KEYS.SERVICE_CONFIG,
        JSON.stringify({
          isRunning: true,
          startedAt: new Date().toISOString(),
          interval: checkInterval,
        }),
      );
    } catch (error) {
      console.error('Failed to start service:', error);
      Alert.alert('Error', `Failed to start background service: ${error}`);
    }
  };

  // Stop background service
  const stopBackgroundService = async () => {
    try {
      if (Platform.OS === 'android') {
        await BackgroundJob.stop();

        // Clear notifications
        if (Notifee) {
          await Notifee.cancelAllNotifications();
        }
      } else if (Platform.OS === 'ios') {
        // Stop background timer
        if (backgroundTimerRef.current) {
          BackgroundTimer.clearInterval(backgroundTimerRef.current);
          backgroundTimerRef.current = null;
        }

        // Stop background fetch
        if (BackgroundFetch) {
          await BackgroundFetch.stop();
        }
      }

      setIsServiceRunning(false);

      // Update service state
      await AsyncStorage.setItem(
        STORAGE_KEYS.SERVICE_CONFIG,
        JSON.stringify({
          isRunning: false,
          stoppedAt: new Date().toISOString(),
        }),
      );

      Alert.alert('Service Stopped', 'Background monitoring has been stopped');
    } catch (error) {
      console.error('Failed to stop service:', error);
      Alert.alert('Error', `Failed to stop background service: ${error}`);
    }
  };

  // Toggle service
  const toggleService = (enable: boolean) => {
    if (enable) {
      startBackgroundService();
    } else {
      stopBackgroundService();
    }
  };

  // Initialize app
  useEffect(() => {
    loadSavedData();
    checkServiceStatus();

    // Setup iOS background fetch on app start
    if (Platform.OS === 'ios') {
      configureiOSBackgroundFetch();
    }

    return () => {
      // Cleanup on unmount
      if (backgroundTimerRef.current) {
        BackgroundTimer.clearInterval(backgroundTimerRef.current);
      }
    };
  }, []);

  // Handle app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState: AppStateStatus) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === 'active'
        ) {
          // App came to foreground
          console.log('App became active');
          checkServiceStatus();
          loadSavedData();
        } else if (
          appState.current === 'active' &&
          nextAppState.match(/inactive|background/)
        ) {
          // App went to background
          console.log('App went to background');
        }
        appState.current = nextAppState;
      },
    );

    return () => subscription.remove();
  }, []);

  // Check service status
  const checkServiceStatus = async () => {
    try {
      const serviceConfig = await AsyncStorage.getItem(
        STORAGE_KEYS.SERVICE_CONFIG,
      );

      if (Platform.OS === 'android') {
        setIsServiceRunning(BackgroundJob.isRunning());
      } else if (Platform.OS === 'ios' && serviceConfig) {
        const config = JSON.parse(serviceConfig);
        setIsServiceRunning(config.isRunning || false);
      }
    } catch (error) {
      console.error('Error checking service status:', error);
    }
  };

  // Load saved data
  const loadSavedData = async () => {
    try {
      const [savedUrls, savedCallback, savedInterval, savedStats] =
        await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.URLS),
          AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
          AsyncStorage.getItem(STORAGE_KEYS.INTERVAL),
          AsyncStorage.getItem(STORAGE_KEYS.STATS),
        ]);

      if (savedUrls) setUrls(JSON.parse(savedUrls));
      if (savedCallback) setCallbackConfig(JSON.parse(savedCallback));
      if (savedInterval) setCheckInterval(savedInterval);
      if (savedStats) setStats(JSON.parse(savedStats));
    } catch (error) {
      console.error('Error loading saved data:', error);
    }
  };

  // Save data
  const saveData = async () => {
    try {
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.URLS, JSON.stringify(urls)),
        AsyncStorage.setItem(
          STORAGE_KEYS.CALLBACK,
          JSON.stringify(callbackConfig),
        ),
        AsyncStorage.setItem(STORAGE_KEYS.INTERVAL, checkInterval),
        AsyncStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(stats)),
      ]);
    } catch (error) {
      console.error('Error saving data:', error);
    }
  };

  // Auto-save when data changes
  useEffect(() => {
    const timer = setTimeout(saveData, 500);
    return () => clearTimeout(timer);
  }, [urls, callbackConfig, checkInterval, stats]);

  // Add URL
  const addUrl = () => {
    if (!newUrl.trim()) {
      Alert.alert('Error', 'Please enter a URL');
      return;
    }

    let normalizedUrl = newUrl.trim();
    if (!normalizedUrl.match(/^https?:\/\//)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    // Validate URL
    try {
      new URL(normalizedUrl);
    } catch {
      Alert.alert('Invalid URL', 'Please enter a valid URL');
      return;
    }

    // Check for duplicates
    if (urls.some(u => u.url === normalizedUrl)) {
      Alert.alert('Duplicate URL', 'This URL is already in the list');
      return;
    }

    const newUrlItem: URLItem = {
      id: Date.now().toString(),
      url: normalizedUrl,
      status: 'checking',
    };

    setUrls([...urls, newUrlItem]);
    setNewUrl('');

    // Check the new URL immediately
    checkSingleUrl(newUrlItem);
  };

  // Check single URL
  const checkSingleUrl = async (urlItem: URLItem) => {
    const startTime = Date.now();

    try {
      const response = await fetch(urlItem.url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'NetGuard/1.0',
        },
      });

      const responseTime = Date.now() - startTime;
      const isActive = response.status >= 200 && response.status < 400;

      setUrls(prevUrls =>
        prevUrls.map(u =>
          u.id === urlItem.id
            ? {
                ...u,
                status: isActive ? 'active' : 'inactive',
                lastChecked: new Date(),
                responseTime,
              }
            : u,
        ),
      );
    } catch (error: any) {
      const responseTime = Date.now() - startTime;

      setUrls(prevUrls =>
        prevUrls.map(u =>
          u.id === urlItem.id
            ? {
                ...u,
                status: 'error',
                lastChecked: new Date(),
                responseTime,
                errorMessage: error.message,
              }
            : u,
        ),
      );
    }
  };

  // Remove URL
  const removeUrl = (id: string) => {
    Alert.alert('Remove URL', 'Are you sure you want to remove this URL?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setUrls(urls.filter(url => url.id !== id)),
      },
    ]);
  };

  // Check all URLs manually
  const checkAllUrls = async () => {
    if (urls.length === 0) {
      Alert.alert('No URLs', 'Please add URLs to monitor first');
      return;
    }

    setIsLoading(true);
    const updatedUrls = [];
    let successCount = 0;
    let totalResponseTime = 0;

    for (const urlItem of urls) {
      const startTime = Date.now();

      try {
        const response = await fetch(urlItem.url, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'NetGuard/1.0',
            'Cache-Control': 'no-cache',
          },
        });

        const responseTime = Date.now() - startTime;
        const isActive = response.status >= 200 && response.status < 400;

        updatedUrls.push({
          ...urlItem,
          status: isActive ? ('active' as const) : ('inactive' as const),
          lastChecked: new Date(),
          responseTime,
        });

        if (isActive) {
          successCount++;
          totalResponseTime += responseTime;
        }
      } catch (error: any) {
        const responseTime = Date.now() - startTime;

        updatedUrls.push({
          ...urlItem,
          status: 'error' as const,
          lastChecked: new Date(),
          responseTime,
          errorMessage: error.message,
        });
      }
    }

    setUrls(updatedUrls);
    setStats(prev => ({
      totalChecks: prev.totalChecks + 1,
      successfulChecks: prev.successfulChecks + successCount,
      failedChecks: prev.failedChecks + (urls.length - successCount),
      lastCheckTime: new Date(),
      averageResponseTime:
        successCount > 0
          ? totalResponseTime / successCount
          : prev.averageResponseTime,
    }));

    setIsLoading(false);

    // Send callback if enabled
    if (callbackConfig.enabled && callbackConfig.url) {
      const results = updatedUrls.map(u => ({
        url: u.url,
        status: u.status,
        responseTime: u.responseTime,
      }));
      await sendCallback(results, callbackConfig, false);
    }
  };

  // Reset stats
  const resetStats = () => {
    Alert.alert(
      'Reset Statistics',
      'Are you sure you want to reset all monitoring statistics?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setStats({
              totalChecks: 0,
              successfulChecks: 0,
              failedChecks: 0,
            });
          },
        },
      ],
    );
  };

  // Get status color
  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'active':
        return '#4CAF50';
      case 'inactive':
        return '#FF9800';
      case 'error':
        return '#F44336';
      case 'checking':
        return '#2196F3';
      default:
        return '#9E9E9E';
    }
  };

  // Format response time
  const formatResponseTime = (time?: number) => {
    if (!time) return '';
    if (time < 1000) return `${time}ms`;
    return `${(time / 1000).toFixed(1)}s`;
  };

  // Styles
  const containerStyle = {
    flex: 1,
    paddingTop: safeAreaInsets.top,
    backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5',
  };

  const cardStyle = {
    backgroundColor: isDarkMode ? '#2a2a2a' : 'white',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  };

  const textStyle = { color: isDarkMode ? 'white' : 'black' };
  const subTextStyle = { color: isDarkMode ? '#aaa' : '#666' };

  return (
    <ScrollView style={containerStyle} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={[cardStyle, { alignItems: 'center' }]}>
        <Text style={[styles.title, textStyle]}>NetGuard</Text>
        <Text style={[styles.subtitle, textStyle]}>
          Enhanced Background Monitor
        </Text>
        <Text style={[styles.version, subTextStyle]}>
          v1.0.0 • {Platform.OS === 'ios' ? 'iOS' : 'Android'}
        </Text>
      </View>

      {/* Service Status */}
      <View style={cardStyle}>
        <View style={styles.serviceHeader}>
          <View>
            <Text style={[styles.sectionTitle, textStyle]}>
              {isServiceRunning ? '🟢 Service Active' : '🔴 Service Stopped'}
            </Text>
            <Text style={[styles.serviceSubtext, subTextStyle]}>
              {isServiceRunning
                ? `Checking every ${checkInterval} minutes`
                : 'Enable to start monitoring'}
            </Text>
          </View>
          <Switch
            value={isServiceRunning}
            onValueChange={toggleService}
            trackColor={{ false: '#767577', true: '#81b0ff' }}
            thumbColor={isServiceRunning ? '#2196F3' : '#f4f3f4'}
          />
        </View>

        {/* Platform specific info */}
        {Platform.OS === 'ios' && isServiceRunning && (
          <View style={styles.infoBox}>
            <Text style={[styles.infoText, subTextStyle]}>
              ℹ️ iOS limits background execution. The app will check URLs when
              the system allows it.
            </Text>
          </View>
        )}
      </View>

      {/* Statistics */}
      <View style={cardStyle}>
        <View style={styles.statsHeader}>
          <Text style={[styles.sectionTitle, textStyle]}>Statistics</Text>
          <TouchableOpacity onPress={resetStats}>
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, textStyle]}>
              {stats.totalChecks}
            </Text>
            <Text style={[styles.statLabel, subTextStyle]}>Total Checks</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#4CAF50' }]}>
              {stats.successfulChecks}
            </Text>
            <Text style={[styles.statLabel, subTextStyle]}>Successful</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#F44336' }]}>
              {stats.failedChecks}
            </Text>
            <Text style={[styles.statLabel, subTextStyle]}>Failed</Text>
          </View>
        </View>

        {stats.lastCheckTime && (
          <Text style={[styles.lastCheck, subTextStyle]}>
            Last check: {new Date(stats.lastCheckTime).toLocaleString()}
          </Text>
        )}
        {stats.averageResponseTime && (
          <Text style={[styles.lastCheck, subTextStyle]}>
            Avg response: {formatResponseTime(stats.averageResponseTime)}
          </Text>
        )}
      </View>

      {/* URLs Management */}
      <View style={cardStyle}>
        <Text style={[styles.sectionTitle, textStyle]}>
          URLs to Monitor ({urls.length})
        </Text>

        <View style={styles.inputRow}>
          <TextInput
            style={[
              styles.input,
              { flex: 1, color: isDarkMode ? 'white' : 'black' },
            ]}
            placeholder="Enter URL (e.g. google.com)"
            placeholderTextColor={isDarkMode ? '#999' : '#666'}
            value={newUrl}
            onChangeText={setNewUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity style={styles.addButton} onPress={addUrl}>
            <Text style={styles.buttonText}>Add</Text>
          </TouchableOpacity>
        </View>

        {urls.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, subTextStyle]}>
              No URLs added yet. Add a URL to start monitoring.
            </Text>
          </View>
        ) : (
          urls.map(url => (
            <View key={url.id} style={styles.urlItem}>
              <View style={styles.urlInfo}>
                <View style={styles.urlHeader}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: getStatusColor(url.status) },
                    ]}
                  />
                  <Text style={[styles.urlText, textStyle]} numberOfLines={1}>
                    {url.url}
                  </Text>
                </View>

                <View style={styles.urlMeta}>
                  <Text style={[styles.statusText, subTextStyle]}>
                    {url.status || 'unknown'}
                    {url.responseTime &&
                      ` • ${formatResponseTime(url.responseTime)}`}
                  </Text>
                  {url.lastChecked && (
                    <Text style={[styles.timeText, subTextStyle]}>
                      {new Date(url.lastChecked).toLocaleTimeString()}
                    </Text>
                  )}
                </View>

                {url.errorMessage && (
                  <Text
                    style={[styles.errorText, { color: '#F44336' }]}
                    numberOfLines={1}
                  >
                    {url.errorMessage}
                  </Text>
                )}
              </View>

              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => removeUrl(url.id)}
              >
                <Text style={styles.removeText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {/* Callback Configuration */}
      <View style={cardStyle}>
        <View style={styles.callbackHeader}>
          <Text style={[styles.sectionTitle, textStyle]}>Webhook Callback</Text>
          <Switch
            value={callbackConfig.enabled}
            onValueChange={enabled =>
              setCallbackConfig(prev => ({ ...prev, enabled }))
            }
            trackColor={{ false: '#767577', true: '#81b0ff' }}
            thumbColor={callbackConfig.enabled ? '#2196F3' : '#f4f3f4'}
          />
        </View>

        <TextInput
          style={[
            styles.input,
            { color: isDarkMode ? 'white' : 'black' },
            !callbackConfig.enabled && styles.disabled,
          ]}
          placeholder="Callback Name (optional)"
          placeholderTextColor={isDarkMode ? '#999' : '#666'}
          value={callbackConfig.name}
          onChangeText={text =>
            setCallbackConfig(prev => ({ ...prev, name: text }))
          }
          editable={callbackConfig.enabled}
        />

        <TextInput
          style={[
            styles.input,
            styles.marginTop,
            { color: isDarkMode ? 'white' : 'black' },
            !callbackConfig.enabled && styles.disabled,
          ]}
          placeholder="Webhook URL (e.g. https://your-server.com/webhook)"
          placeholderTextColor={isDarkMode ? '#999' : '#666'}
          value={callbackConfig.url}
          onChangeText={text =>
            setCallbackConfig(prev => ({ ...prev, url: text }))
          }
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={callbackConfig.enabled}
        />

        {callbackConfig.enabled && callbackConfig.url && (
          <Text style={[styles.helpText, subTextStyle]}>
            Will send POST requests with monitoring results to this URL
          </Text>
        )}
      </View>

      {/* Settings */}
      <View style={cardStyle}>
        <Text style={[styles.sectionTitle, textStyle]}>Check Interval</Text>

        <View style={styles.intervalContainer}>
          <TextInput
            style={[
              styles.input,
              { flex: 1, color: isDarkMode ? 'white' : 'black' },
            ]}
            placeholder="60"
            placeholderTextColor={isDarkMode ? '#999' : '#666'}
            value={checkInterval}
            onChangeText={text => {
              // Only allow numbers
              const cleaned = text.replace(/[^0-9]/g, '');
              setCheckInterval(cleaned);
            }}
            keyboardType="numeric"
            maxLength={4}
          />
          <Text style={[styles.intervalText, textStyle]}>minutes</Text>
        </View>

        <Text style={[styles.helpText, subTextStyle]}>
          Minimum: 1 minute • Maximum: 1440 minutes (24 hours)
        </Text>
      </View>

      {/* Manual Check Button */}
      <TouchableOpacity
        style={[styles.checkButton, isLoading && styles.checkButtonDisabled]}
        onPress={checkAllUrls}
        disabled={isLoading || urls.length === 0}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="white" />
            <Text style={styles.checkButtonText}>Checking...</Text>
          </View>
        ) : (
          <Text style={styles.checkButtonText}>Check All URLs Now</Text>
        )}
      </TouchableOpacity>

      {/* Footer Info */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, subTextStyle]}>
          {Platform.OS === 'android'
            ? '💡 This app uses a Foreground Service to keep monitoring active'
            : '💡 Background execution depends on iOS system scheduling'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.8,
    marginTop: 2,
  },
  version: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  serviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serviceSubtext: {
    fontSize: 12,
    marginTop: 4,
  },
  infoBox: {
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  infoText: {
    fontSize: 12,
    lineHeight: 18,
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  resetText: {
    color: '#2196F3',
    fontSize: 14,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  lastCheck: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  disabled: {
    opacity: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  addButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  urlItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  urlInfo: {
    flex: 1,
  },
  urlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  urlText: {
    fontSize: 14,
    flex: 1,
    marginLeft: 8,
  },
  urlMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 12,
    textTransform: 'capitalize',
  },
  timeText: {
    fontSize: 11,
  },
  errorText: {
    fontSize: 11,
    marginTop: 4,
  },
  removeButton: {
    padding: 4,
    marginLeft: 8,
  },
  removeText: {
    color: '#F44336',
    fontSize: 18,
    fontWeight: 'bold',
  },
  callbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  marginTop: {
    marginTop: 12,
  },
  helpText: {
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  intervalContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  intervalText: {
    fontSize: 16,
  },
  checkButton: {
    backgroundColor: '#FF9800',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  checkButtonDisabled: {
    opacity: 0.6,
  },
  checkButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  footer: {
    padding: 16,
    paddingTop: 0,
    paddingBottom: 32,
  },
  footerText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default App;
