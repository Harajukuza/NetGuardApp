/**
 * @format
 */

import { AppRegistry, Platform, DeviceEventEmitter } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

// HeadlessJS Task for background URL checks
const BackgroundURLCheckTask = async taskData => {
  console.log(
    '[HeadlessTask] Starting background URL check with data:',
    taskData,
  );

  // Emit task start event
  DeviceEventEmitter.emit('BACKGROUND_TASK_STATUS', {
    type: 'START',
    timestamp: new Date().toISOString(),
  });

  // If native AlarmManager / Receiver supplied summarized results
  if (taskData && (taskData.nativeResultsOnly || taskData.totalChecked)) {
    console.log('[HeadlessTask] Received native results - updating storage');
    
    try {
      const lastResultsSummary = {
        timestamp: taskData.timestamp || new Date().toISOString(),
        totalChecked: taskData.totalChecked || 0,
        activeCount: taskData.activeCount || 0,
        inactiveCount: taskData.inactiveCount || 0,
        source: taskData.source || 'AlarmManager',
      };

      await AsyncStorage.setItem('@Enhanced:lastResults', JSON.stringify(lastResultsSummary));
      await AsyncStorage.setItem('@Enhanced:lastCheckTime', new Date().toISOString());

      // Update stats and emit update event
      const stats = await AsyncStorage.getItem('@Enhanced:backgroundStats');
      const newCount = (parseInt(stats, 10) || 0) + 1;
      await AsyncStorage.setItem('@Enhanced:backgroundStats', newCount.toString());

      DeviceEventEmitter.emit('BACKGROUND_CHECK_RESULTS', {
        ...lastResultsSummary,
        fromNative: true,
      });

      return { success: true, fromNative: true };
    } catch (e) {
      console.error('[HeadlessTask] Error handling native results:', e);
      DeviceEventEmitter.emit('BACKGROUND_TASK_ERROR', {
        error: String(e),
        type: 'native_results',
      });
      return { success: false, error: String(e) };
    }
  }

  const startTime = Date.now();

  try {
    // Load configuration
    let urls = [];
    let callbackConfig = null;
    let apiEndpoint = null;

    // First try to get API endpoint
    apiEndpoint = await AsyncStorage.getItem('@Enhanced:apiEndpoint');
    const selectedCallback = await AsyncStorage.getItem('@Enhanced:selectedCallback');

    // Validate API endpoint first if present
    if (apiEndpoint) {
      try {
        const apiUrl = new URL(apiEndpoint);
        console.log('[HeadlessTask] Valid API endpoint:', apiUrl.toString());
      } catch (e) {
        console.error('[HeadlessTask] Invalid API endpoint:', apiEndpoint);
        DeviceEventEmitter.emit('BACKGROUND_TASK_ERROR', {
          error: 'Invalid API endpoint URL',
          type: 'config_error',
        });
        return { success: false, reason: 'invalid_api_endpoint' };
      }
    }

    // Try loading from service config first
    if (taskData?.serviceConfig) {
      console.log('[HeadlessTask] Using config from native service');
      try {
        const parsed = typeof taskData.serviceConfig === 'string' 
          ? JSON.parse(taskData.serviceConfig) 
          : taskData.serviceConfig;
        
        if (parsed.urls && Array.isArray(parsed.urls)) {
          urls = parsed.urls.map(url => ({ url }));
        }
        if (parsed.callbackConfig) {
          callbackConfig = parsed.callbackConfig;
        }
      } catch (e) {
        console.warn('[HeadlessTask] Error parsing service config:', e);
      }
    }

    // If no URLs yet, try loading from AsyncStorage
    if (urls.length === 0) {
      console.log('[HeadlessTask] Loading from AsyncStorage');
      const [savedUrls, savedCallback] = await Promise.all([
        AsyncStorage.getItem('@Enhanced:urls'),
        AsyncStorage.getItem('@Enhanced:callback'),
      ]);

      if (savedUrls) {
        try {
          const parsed = JSON.parse(savedUrls);
          urls = Array.isArray(parsed) ? parsed : 
                 (parsed?.urls && Array.isArray(parsed.urls)) ? parsed.urls.map(url => ({ url })) : [];
        } catch (e) {
          console.error('[HeadlessTask] Error parsing saved URLs:', e);
        }
      }

      if (savedCallback) {
        try {
          callbackConfig = JSON.parse(savedCallback);
        } catch (e) {
          console.error('[HeadlessTask] Error parsing saved callback:', e);
        }
      }
    }

    // If still no URLs and we have API config, try API
    if (urls.length === 0 && apiEndpoint && selectedCallback) {
      console.log('[HeadlessTask] Fetching from API:', apiEndpoint);
      try {
        const response = await fetch(apiEndpoint);
        if (!response.ok) {
          throw new Error(`API responded with status ${response.status}`);
        }
        
        const data = await response.json();
        if (data?.status === 'success' && Array.isArray(data?.data)) {
          const filtered = data.data.filter(
            item => String(item.callback_name) === String(selectedCallback)
          );
          
          if (filtered.length > 0) {
            urls = filtered.map(item => ({
              id: `${item.id}_${Date.now()}`,
              url: item.url
            }));
            
            if (filtered[0].callback_url) {
              callbackConfig = {
                name: selectedCallback,
                url: filtered[0].callback_url
              };
            }

            // Save fetched URLs
            await AsyncStorage.setItem('@Enhanced:urls', JSON.stringify(urls));
            if (callbackConfig) {
              await AsyncStorage.setItem('@Enhanced:callback', JSON.stringify(callbackConfig));
            }

            DeviceEventEmitter.emit('API_SYNC_SUCCESS', {
              urlCount: urls.length,
              callback: selectedCallback,
            });
          }
        }
      } catch (e) {
        console.error('[HeadlessTask] API fetch error:', e);
        DeviceEventEmitter.emit('API_SYNC_ERROR', {
          error: e.message,
          endpoint: apiEndpoint,
        });
      }
    }

    // Validate final configuration
    if (urls.length === 0 || !callbackConfig?.url) {
      const error = urls.length === 0 ? 'No URLs configured' : 'No callback URL configured';
      DeviceEventEmitter.emit('BACKGROUND_TASK_ERROR', {
        error,
        type: 'config_error',
      });
      return { success: false, reason: error };
    }

    // เก็บ URLs ที่ใช้ล่าสุดลง storage
    await AsyncStorage.setItem('@Enhanced:lastUsedUrls', JSON.stringify(urls));

    console.log(`[HeadlessTask] Checking ${urls.length} URLs...`);

    // Perform URL checks with timeout
    const checkResults = await Promise.all(
      urls.map(async (urlItem, index) => {
        // Add random delay between requests
        if (index > 0) {
          await new Promise(resolve =>
            setTimeout(resolve, 2000 + Math.random() * 3000),
          );
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);

          const response = await fetch(urlItem.url, {
            method: 'GET',
            headers: {
              'User-Agent': 'NetGuard-HeadlessJS/2.0',
              Accept: '*/*',
              'Cache-Control': 'no-cache',
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          const isActive =
            response.ok ||
            response.status < 500 ||
            response.status === 401 ||
            response.status === 403 ||
            response.status === 429;

          return {
            url: urlItem.url,
            status: isActive ? 'active' : 'inactive',
            statusCode: response.status,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            url: urlItem.url,
            status: 'inactive',
            error: error.message || 'Network error',
            timestamp: new Date().toISOString(),
          };
        }
      }),
    );

    // Send callback if configured
    if (callbackConfig.url && checkResults.length > 0) {
      try {
        const deviceId = await DeviceInfo.getUniqueId();
        const activeCount = checkResults.filter(
          r => r.status === 'active',
        ).length;
        const inactiveCount = checkResults.filter(
          r => r.status === 'inactive',
        ).length;

        const payload = {
          checkType: taskData?.source === 'native' ? 'enhanced_background' : 'headless_js',
          timestamp: new Date().toISOString(),
          isBackground: true,
          source: taskData?.source || 'HeadlessJS',
          summary: {
            total: urls.length, // ใช้จำนวน URLs ที่ถูกต้อง
            active: activeCount,
            inactive: inactiveCount
          },
          urls: checkResults,
          device: {
            id: deviceId,
            platform: Platform.OS,
            model: DeviceInfo.getModel(),
            version: DeviceInfo.getSystemVersion(),
          },
          callbackName: callbackConfig.name,
        };

        const callbackResponse = await fetch(callbackConfig.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NetGuard-HeadlessJS-Callback/2.0',
          },
          body: JSON.stringify(payload),
        });

        console.log(
          `[HeadlessTask] Callback sent: ${
            callbackResponse.ok ? 'Success' : 'Failed'
          }`,
        );
      } catch (error) {
        console.error('[HeadlessTask] Callback error:', error);
      }
    }

    // Update statistics
    const stats = await AsyncStorage.getItem('@Enhanced:backgroundStats');
    const newCount = (parseInt(stats, 10) || 0) + 1;
    await AsyncStorage.setItem(
      '@Enhanced:backgroundStats',
      newCount.toString(),
    );

    // Save last check time
    await AsyncStorage.setItem(
      '@Enhanced:lastCheckTime',
      new Date().toISOString(),
    );

    const duration = Date.now() - startTime;
    console.log(`[HeadlessTask] Completed in ${duration}ms`);

    // After checks complete, emit results
    DeviceEventEmitter.emit('BACKGROUND_CHECK_RESULTS', {
      timestamp: new Date().toISOString(),
      results: checkResults,
      summary: {
        total: urls.length,
        active: checkResults.filter(r => r.status === 'active').length,
        inactive: checkResults.filter(r => r.status === 'inactive').length,
      },
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      checked: checkResults.length,
      active: checkResults.filter(r => r.status === 'active').length,
      inactive: checkResults.filter(r => r.status === 'inactive').length,
      duration: Date.now() - startTime,
    };

  } catch (error) {
    console.error('[HeadlessTask] Fatal error:', error);
    DeviceEventEmitter.emit('BACKGROUND_TASK_ERROR', {
      error: error.message,
      type: 'fatal_error',
    });
    return { success: false, error: error.message };
  }
};

// Register HeadlessJS task for Android
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(
    'BackgroundURLCheckTask',
    () => BackgroundURLCheckTask,
  );
  console.log('[HeadlessTask] Registered BackgroundURLCheckTask for Android');
}

AppRegistry.registerComponent(appName, () => App);
