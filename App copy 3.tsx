/**
 * NetGuard - Simple URL Monitor with Background Service
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
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundJob from 'react-native-background-actions';

// Types
interface URLItem {
  id: string;
  url: string;
  lastChecked?: Date;
  status?: 'active' | 'inactive' | 'checking';
}

interface CallbackConfig {
  name: string;
  url: string;
}

// Storage keys
const STORAGE_KEYS = {
  URLS: '@NetGuard:urls',
  CALLBACK: '@NetGuard:callback',
  INTERVAL: '@NetGuard:interval',
};

// Background task options
const backgroundTaskOptions = {
  taskName: 'NetGuardMonitor',
  taskTitle: 'NetGuard Active',
  taskDesc: 'Monitoring URLs in background',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#ff6600',
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
  const appState = useRef(AppState.currentState);

  // States
  const [urls, setUrls] = useState<URLItem[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [callbackConfig, setCallbackConfig] = useState<CallbackConfig>({
    name: '',
    url: '',
  });
  const [checkInterval, setCheckInterval] = useState('60');
  const [isLoading, setIsLoading] = useState(false);
  const [isServiceRunning, setIsServiceRunning] = useState(false);

  // Background task function
  const backgroundTask = useCallback(async (taskData: any) => {
    console.log('🔄 Background task started');

    const intervalMs = (taskData?.interval || 60) * 60000;

    while (BackgroundJob.isRunning()) {
      try {
        console.log('📡 Checking URLs in background...');

        // Load URLs from storage
        const savedUrls = await AsyncStorage.getItem(STORAGE_KEYS.URLS);
        const savedCallback = await AsyncStorage.getItem(STORAGE_KEYS.CALLBACK);

        if (savedUrls) {
          const currentUrls = JSON.parse(savedUrls);
          const callbackConfig = savedCallback
            ? JSON.parse(savedCallback)
            : null;

          if (currentUrls.length > 0) {
            await checkUrlsInBackground(currentUrls, callbackConfig);
          }
        }

        // Wait for next check
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      } catch (error) {
        console.error('Background task error:', error);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }

    console.log('🛑 Background task stopped');
  }, []);

  // Check URLs in background
  const checkUrlsInBackground = async (
    urls: URLItem[],
    callbackConfig: CallbackConfig | null,
  ) => {
    const results = [];

    for (const urlItem of urls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(urlItem.url, {
          method: 'HEAD',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const isActive = response.status >= 200 && response.status < 400;
        results.push({
          url: urlItem.url,
          status: isActive ? 'active' : 'inactive',
        });
      } catch (error) {
        results.push({
          url: urlItem.url,
          status: 'inactive',
        });
      }
    }

    // Send callback if configured
    if (callbackConfig && callbackConfig.url && results.length > 0) {
      await sendCallback(results, callbackConfig);
    }
  };

  // Send callback
  const sendCallback = async (
    results: any[],
    callbackConfig: CallbackConfig,
  ) => {
    try {
      const payload = {
        timestamp: new Date().toISOString(),
        isBackground: true,
        results,
      };

      await fetch(callbackConfig.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      console.log('✅ Callback sent successfully');
    } catch (error) {
      console.error('❌ Callback failed:', error);
    }
  };

  // Initialize
  useEffect(() => {
    loadSavedData();
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
          setIsServiceRunning(BackgroundJob.isRunning());
        }
        appState.current = nextAppState;
      },
    );

    return () => subscription.remove();
  }, []);

  // Load saved data
  const loadSavedData = async () => {
    try {
      const [savedUrls, savedCallback, savedInterval] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.URLS),
        AsyncStorage.getItem(STORAGE_KEYS.CALLBACK),
        AsyncStorage.getItem(STORAGE_KEYS.INTERVAL),
      ]);

      if (savedUrls) setUrls(JSON.parse(savedUrls));
      if (savedCallback) setCallbackConfig(JSON.parse(savedCallback));
      if (savedInterval) setCheckInterval(savedInterval);

      // Check if service is running
      setIsServiceRunning(BackgroundJob.isRunning());
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
      ]);
    } catch (error) {
      console.error('Error saving data:', error);
    }
  };

  // Save when data changes
  useEffect(() => {
    const timer = setTimeout(saveData, 500);
    return () => clearTimeout(timer);
  }, [urls, callbackConfig, checkInterval]);

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

    const newUrlItem: URLItem = {
      id: Date.now().toString(),
      url: normalizedUrl,
      status: 'checking',
    };

    setUrls([...urls, newUrlItem]);
    setNewUrl('');
  };

  // Remove URL
  const removeUrl = (id: string) => {
    setUrls(urls.filter(url => url.id !== id));
  };

  // Start background service
  const startBackgroundService = async () => {
    try {
      if (urls.length === 0) {
        Alert.alert('No URLs', 'Please add URLs to monitor first');
        return;
      }

      const options = {
        ...backgroundTaskOptions,
        interval: parseInt(checkInterval),
      };

      await BackgroundJob.start(backgroundTask, options);
      setIsServiceRunning(true);

      Alert.alert('Service Started', 'Background monitoring is now active');
    } catch (error) {
      console.error('Failed to start service:', error);
      Alert.alert('Error', 'Failed to start background service');
    }
  };

  // Stop background service
  const stopBackgroundService = async () => {
    try {
      await BackgroundJob.stop();
      setIsServiceRunning(false);
      Alert.alert('Service Stopped', 'Background monitoring has been stopped');
    } catch (error) {
      console.error('Failed to stop service:', error);
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

  // Check URLs manually
  const checkAllUrls = async () => {
    if (urls.length === 0) {
      Alert.alert('No URLs', 'Please add URLs to monitor first');
      return;
    }

    setIsLoading(true);
    const updatedUrls = [];

    for (const urlItem of urls) {
      try {
        const response = await fetch(urlItem.url, { method: 'HEAD' });
        const isActive = response.status >= 200 && response.status < 400;

        updatedUrls.push({
          ...urlItem,
          status: isActive ? 'active' : 'inactive',
          lastChecked: new Date(),
        });
      } catch (error) {
        updatedUrls.push({
          ...urlItem,
          status: 'inactive',
          lastChecked: new Date(),
        });
      }
    }

    setUrls(updatedUrls);
    setIsLoading(false);
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

  return (
    <ScrollView style={containerStyle}>
      {/* Header */}
      <View style={[cardStyle, { alignItems: 'center' }]}>
        <Text style={[styles.title, textStyle]}>NetGuard</Text>
        <Text style={[styles.subtitle, textStyle]}>Background URL Monitor</Text>
      </View>

      {/* Service Status */}
      <View style={cardStyle}>
        <View style={styles.serviceHeader}>
          <Text style={[styles.sectionTitle, textStyle]}>
            {isServiceRunning ? '🟢 Service Active' : '🔴 Service Stopped'}
          </Text>
          <Switch
            value={isServiceRunning}
            onValueChange={toggleService}
            trackColor={{ false: '#767577', true: '#81b0ff' }}
            thumbColor={isServiceRunning ? '#2196F3' : '#f4f3f4'}
          />
        </View>
      </View>

      {/* URLs */}
      <View style={cardStyle}>
        <Text style={[styles.sectionTitle, textStyle]}>
          URLs ({urls.length})
        </Text>

        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { color: isDarkMode ? 'white' : 'black' }]}
            placeholder="Enter URL (e.g. google.com)"
            placeholderTextColor={isDarkMode ? '#999' : '#666'}
            value={newUrl}
            onChangeText={setNewUrl}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.addButton} onPress={addUrl}>
            <Text style={styles.buttonText}>Add</Text>
          </TouchableOpacity>
        </View>

        {urls.map(url => (
          <View key={url.id} style={styles.urlItem}>
            <View style={styles.urlInfo}>
              <Text style={[styles.urlText, textStyle]} numberOfLines={1}>
                {url.url}
              </Text>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDot,
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
                  {url.status || 'unknown'}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => removeUrl(url.id)}>
              <Text style={styles.removeText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* Callback */}
      <View style={cardStyle}>
        <Text style={[styles.sectionTitle, textStyle]}>Callback Settings</Text>

        <TextInput
          style={[styles.input, { color: isDarkMode ? 'white' : 'black' }]}
          placeholder="Callback Name"
          placeholderTextColor={isDarkMode ? '#999' : '#666'}
          value={callbackConfig.name}
          onChangeText={text =>
            setCallbackConfig(prev => ({ ...prev, name: text }))
          }
        />

        <TextInput
          style={[
            styles.input,
            styles.marginTop,
            { color: isDarkMode ? 'white' : 'black' },
          ]}
          placeholder="Webhook URL"
          placeholderTextColor={isDarkMode ? '#999' : '#666'}
          value={callbackConfig.url}
          onChangeText={text =>
            setCallbackConfig(prev => ({ ...prev, url: text }))
          }
          autoCapitalize="none"
        />
      </View>

      {/* Settings */}
      <View style={cardStyle}>
        <Text style={[styles.sectionTitle, textStyle]}>Check Interval</Text>

        <TextInput
          style={[styles.input, { color: isDarkMode ? 'white' : 'black' }]}
          placeholder="Minutes"
          placeholderTextColor={isDarkMode ? '#999' : '#666'}
          value={checkInterval}
          onChangeText={setCheckInterval}
          keyboardType="numeric"
        />
      </View>

      {/* Manual Check */}
      <TouchableOpacity
        style={[styles.checkButton, isLoading && { opacity: 0.6 }]}
        onPress={checkAllUrls}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.checkButtonText}>Check All URLs Now</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
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
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  addButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginLeft: 8,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
  },
  urlItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  urlInfo: {
    flex: 1,
  },
  urlText: {
    fontSize: 14,
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    textTransform: 'capitalize',
  },
  removeText: {
    color: '#F44336',
    fontWeight: '600',
  },
  marginTop: {
    marginTop: 12,
  },
  checkButton: {
    backgroundColor: '#FF9800',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  checkButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default App;
