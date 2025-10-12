/**
 * Helper functions and utilities for NetGuard Pro
 */

import { Alert, Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

// Storage keys
export const STORAGE_KEYS = {
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
};

// Constants
export const DEFAULT_INTERVAL = 60;
export const MAX_CHECK_HISTORY = 20;
export const REQUEST_TIMEOUT = 15000;
export const MAX_ERROR_LOG = 50;

// User agents for rotation
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// Error logging utility
export const logError = async (error: any, context: string) => {
  try {
    const errorLog = await AsyncStorage.getItem(STORAGE_KEYS.ERROR_LOG);
    const logs = errorLog ? JSON.parse(errorLog) : [];
    logs.unshift({
      timestamp: new Date().toISOString(),
      context,
      message: error?.message || 'Unknown error',
      stack: error?.stack,
    });
    if (logs.length > MAX_ERROR_LOG) {
      logs.length = MAX_ERROR_LOG;
    }
    await AsyncStorage.setItem(STORAGE_KEYS.ERROR_LOG, JSON.stringify(logs));
  } catch (e) {
    console.error('Failed to log error:', e);
  }
};

// Network utilities
export const checkNetworkInfo = async () => {
  try {
    const carrier = await DeviceInfo.getCarrier();
    return {
      type: 'cellular',
      carrier: carrier || 'Unknown',
      isConnected: true,
    };
  } catch (error) {
    console.error('Error checking network:', error);
    return {
      type: 'Unknown',
      carrier: 'Error',
      isConnected: false,
    };
  }
};

export const getNetworkDisplayText = (networkInfo: any) => {
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

// URL validation utilities
export const normalizeUrl = (url: string): string => {
  let normalizedUrl = url.trim();
  if (!normalizedUrl.match(/^https?:\/\//i)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  return normalizedUrl;
};

export const isValidUrl = (url: string): boolean => {
  try {
    const urlPattern =
      /^https?:\/\/([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
    return urlPattern.test(url);
  } catch {
    return false;
  }
};

// Date formatting utilities
export const formatDateTime = (date: Date) => {
  return new Date(date).toLocaleString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const formatTimeAgo = (date: Date) => {
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

// Random sleep helper
export const randomSleep = (
  minSeconds: number = 0,
  maxSeconds: number = 30,
): Promise<void> => {
  const randomMs =
    (Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000;
  return new Promise(resolve => setTimeout(resolve, randomMs));
};

// Request Android permissions
export const requestAndroidPermissions = async () => {
  if (Platform.OS === 'android') {
    try {
      console.log('Checking Android permissions...');

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
                    console.log('Cannot open settings:', err),
                  );
                },
              },
            ],
          );
        }, 2000);
      }
    } catch (err: any) {
      console.log('Permission check:', err.message);
    }
  }
};

// Get device info for callbacks
export const getDeviceInfo = async () => {
  const [deviceId, deviceModel, deviceBrand, systemVersion] = await Promise.all(
    [
      DeviceInfo.getUniqueId(),
      DeviceInfo.getModel(),
      DeviceInfo.getBrand(),
      DeviceInfo.getSystemVersion(),
    ],
  );

  return {
    id: deviceId,
    model: deviceModel,
    brand: deviceBrand,
    platform: DeviceInfo.getSystemName(),
    version: systemVersion,
  };
};
