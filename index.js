/**
 * @format
 */

import { AppRegistry, Platform, DeviceEventEmitter } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

// Enhanced configuration loader with proper fallbacks
const loadConfiguration = async taskData => {
  const config = {
    urls: [],
    callbackConfig: null,
    apiEndpoint: null,
    hasValidConfig: false,
  };

  try {
    // Priority 1: Use service config from native if available
    if (taskData?.serviceConfig) {
      console.log('[HeadlessTask] Using config from native service');
      try {
        const parsed =
          typeof taskData.serviceConfig === 'string'
            ? JSON.parse(taskData.serviceConfig)
            : taskData.serviceConfig;

        if (parsed.urls && Array.isArray(parsed.urls)) {
          config.urls = parsed.urls.map(url => ({ url }));
        }
        if (parsed.callbackConfig) {
          config.callbackConfig = parsed.callbackConfig;
        }

        if (config.urls.length > 0 && config.callbackConfig?.url) {
          config.hasValidConfig = true;
          return config;
        }
      } catch (e) {
        console.warn('[HeadlessTask] Error parsing service config:', e);
      }
    }

    // Priority 2: Load from AsyncStorage
    console.log('[HeadlessTask] Loading configuration from AsyncStorage');
    const [savedUrls, savedCallback, savedApiEndpoint, selectedCallback] =
      await Promise.all([
        AsyncStorage.getItem('@Enhanced:urls'),
        AsyncStorage.getItem('@Enhanced:callback'),
        AsyncStorage.getItem('@Enhanced:apiEndpoint'),
        AsyncStorage.getItem('@Enhanced:selectedCallback'),
      ]);

    // Load URLs from storage
    if (savedUrls) {
      try {
        const parsed = JSON.parse(savedUrls);
        config.urls = Array.isArray(parsed)
          ? parsed
          : parsed?.urls && Array.isArray(parsed.urls)
          ? parsed.urls.map(url => ({ url }))
          : [];
      } catch (e) {
        console.error('[HeadlessTask] Error parsing saved URLs:', e);
      }
    }

    // Load callback configuration
    if (savedCallback) {
      try {
        config.callbackConfig = JSON.parse(savedCallback);
      } catch (e) {
        console.error('[HeadlessTask] Error parsing saved callback:', e);
      }
    }

    // Set API endpoint (but don't require it for basic operation)
    if (savedApiEndpoint) {
      config.apiEndpoint = savedApiEndpoint;
    }

    // Priority 3: Try API sync only if we have both endpoint and selected callback
    // AND we don't have sufficient local config
    if (config.urls.length === 0 && config.apiEndpoint && selectedCallback) {
      console.log('[HeadlessTask] Attempting API sync');
      try {
        // Validate API endpoint format before using
        const apiUrl = new URL(config.apiEndpoint);
        console.log('[HeadlessTask] Using API endpoint:', apiUrl.toString());

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const response = await fetch(config.apiEndpoint, {
          method: 'GET',
          headers: {
            'User-Agent': 'NetGuard-HeadlessJS/2.0',
            Accept: 'application/json',
            'Cache-Control': 'no-cache',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();
        if (data?.status === 'success' && Array.isArray(data?.data)) {
          const filtered = data.data.filter(
            item => String(item.callback_name) === String(selectedCallback),
          );

          if (filtered.length > 0) {
            config.urls = filtered.map(item => ({
              id: `${item.id}_${Date.now()}`,
              url: item.url,
            }));

            if (filtered[0].callback_url) {
              config.callbackConfig = {
                name: selectedCallback,
                url: filtered[0].callback_url,
              };
            }

            // Save fetched configuration for future use
            await Promise.all([
              AsyncStorage.setItem(
                '@Enhanced:urls',
                JSON.stringify(config.urls),
              ),
              config.callbackConfig
                ? AsyncStorage.setItem(
                    '@Enhanced:callback',
                    JSON.stringify(config.callbackConfig),
                  )
                : Promise.resolve(),
              AsyncStorage.setItem(
                '@Enhanced:lastSyncTime',
                new Date().toISOString(),
              ),
            ]);

            DeviceEventEmitter.emit('API_SYNC_SUCCESS', {
              urlCount: config.urls.length,
              callback: selectedCallback,
              source: 'background_task',
            });
          } else {
            console.warn(
              '[HeadlessTask] No URLs found for selected callback:',
              selectedCallback,
            );
          }
        }
      } catch (e) {
        console.error('[HeadlessTask] API sync failed:', e);
        DeviceEventEmitter.emit('API_SYNC_ERROR', {
          error: e.message,
          endpoint: config.apiEndpoint,
          source: 'background_task',
        });

        // Try to load last used URLs as fallback
        const lastUsedUrls = await AsyncStorage.getItem(
          '@Enhanced:lastUsedUrls',
        );
        if (lastUsedUrls) {
          try {
            const parsed = JSON.parse(lastUsedUrls);
            if (Array.isArray(parsed) && parsed.length > 0) {
              config.urls = parsed;
              console.log('[HeadlessTask] Using last known URLs as fallback');
            }
          } catch (e) {
            console.error('[HeadlessTask] Error parsing last used URLs:', e);
          }
        }
      }
    }

    // Determine if we have a valid configuration
    config.hasValidConfig =
      config.urls.length > 0 && config.callbackConfig?.url;

    console.log('[HeadlessTask] Configuration loaded:', {
      urlCount: config.urls.length,
      hasCallback: !!config.callbackConfig?.url,
      hasApiEndpoint: !!config.apiEndpoint,
      isValid: config.hasValidConfig,
    });

    return config;
  } catch (error) {
    console.error('[HeadlessTask] Configuration loading failed:', error);
    return config;
  }
};

// Enhanced URL checker with better error handling
const checkURL = async (urlItem, index, totalCount) => {
  // Add progressive delay to prevent overwhelming servers
  if (index > 0) {
    const delay = Math.min(2000 + index * 500 + Math.random() * 2000, 8000);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    console.log(
      `[HeadlessTask] Checking URL ${index + 1}/${totalCount}: ${urlItem.url}`,
    );

    const response = await fetch(urlItem.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'NetGuard-HeadlessJS/2.0',
        Accept: '*/*',
        'Cache-Control': 'no-cache',
        Connection: 'close',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    // More comprehensive status evaluation
    const isActive =
      response.ok ||
      response.status < 500 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429 ||
      response.status === 409;

    return {
      url: urlItem.url,
      id: urlItem.id,
      status: isActive ? 'active' : 'inactive',
      statusCode: response.status,
      responseTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Categorize network errors
    let errorType = 'network_error';
    if (error.name === 'AbortError') {
      errorType = 'timeout';
    } else if (error.message.includes('Network request failed')) {
      errorType = 'connection_refused';
    } else if (error.message.includes('Unable to resolve host')) {
      errorType = 'dns_error';
    }

    return {
      url: urlItem.url,
      id: urlItem.id,
      status: 'inactive',
      error: error.message || 'Network error',
      errorType,
      responseTime,
      timestamp: new Date().toISOString(),
    };
  }
};

// Enhanced callback sender with retry logic
const sendCallback = async (payload, callbackConfig, maxRetries = 3) => {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[HeadlessTask] Sending callback (attempt ${attempt}/${maxRetries})`,
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(callbackConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NetGuard-HeadlessJS-Callback/2.0',
          'X-NetGuard-Source': 'background_task',
          'X-NetGuard-Attempt': attempt.toString(),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(
          `[HeadlessTask] Callback sent successfully on attempt ${attempt}`,
        );
        return { success: true, attempt, statusCode: response.status };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      lastError = error;
      console.warn(
        `[HeadlessTask] Callback attempt ${attempt} failed:`,
        error.message,
      );

      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(
    '[HeadlessTask] All callback attempts failed:',
    lastError?.message,
  );
  return { success: false, error: lastError?.message, attempts: maxRetries };
};

// Main HeadlessJS Task with comprehensive error handling
const BackgroundURLCheckTask = async taskData => {
  console.log(
    '[HeadlessTask] Starting background URL check with data:',
    taskData,
  );

  // Emit task start event
  DeviceEventEmitter.emit('BACKGROUND_TASK_STATUS', {
    type: 'START',
    timestamp: new Date().toISOString(),
    source: taskData?.source || 'unknown',
  });

  const startTime = Date.now();
  let checkResults = [];

  try {
    // Handle native results if available
    if (taskData && (taskData.nativeResultsOnly || taskData.totalChecked)) {
      console.log('[HeadlessTask] Processing native results');

      try {
        const lastResultsSummary = {
          timestamp: taskData.timestamp || new Date().toISOString(),
          totalChecked: taskData.totalChecked || 0,
          activeCount: taskData.activeCount || 0,
          inactiveCount: taskData.inactiveCount || 0,
          source: taskData.source || 'AlarmManager',
        };

        await Promise.all([
          AsyncStorage.setItem(
            '@Enhanced:lastResults',
            JSON.stringify(lastResultsSummary),
          ),
          AsyncStorage.setItem(
            '@Enhanced:lastCheckTime',
            new Date().toISOString(),
          ),
        ]);

        // Update background check statistics
        const stats = await AsyncStorage.getItem('@Enhanced:backgroundStats');
        const newCount = (parseInt(stats, 10) || 0) + 1;
        await AsyncStorage.setItem(
          '@Enhanced:backgroundStats',
          newCount.toString(),
        );

        DeviceEventEmitter.emit('BACKGROUND_CHECK_RESULTS', {
          ...lastResultsSummary,
          fromNative: true,
        });

        return { success: true, fromNative: true, summary: lastResultsSummary };
      } catch (e) {
        console.error('[HeadlessTask] Error handling native results:', e);
        DeviceEventEmitter.emit('BACKGROUND_TASK_ERROR', {
          error: String(e),
          type: 'native_results_processing',
        });
        return { success: false, error: String(e) };
      }
    }

    // Load configuration with enhanced error handling
    const config = await loadConfiguration(taskData);

    if (!config.hasValidConfig) {
      // Try one more time to load from emergency backup
      const emergencyBackup = await AsyncStorage.getItem(
        '@Enhanced:emergencyBackup',
      );
      if (emergencyBackup) {
        try {
          const backup = JSON.parse(emergencyBackup);
          if (
            backup.urls &&
            backup.urls.length > 0 &&
            backup.callbackConfig?.url
          ) {
            console.log('[HeadlessTask] Using emergency backup configuration');
            config.urls = backup.urls;
            config.callbackConfig = backup.callbackConfig;
            config.hasValidConfig = true;
          }
        } catch (e) {
          console.error('[HeadlessTask] Emergency backup parsing failed:', e);
        }
      }
    }

    if (!config.hasValidConfig) {
      const errorMsg =
        config.urls.length === 0
          ? 'No URLs configured for checking'
          : 'No callback URL configured';

      console.warn(`[HeadlessTask] Configuration incomplete: ${errorMsg}`);

      DeviceEventEmitter.emit('BACKGROUND_TASK_ERROR', {
        error: errorMsg,
        type: 'configuration_incomplete',
        hasUrls: config.urls.length > 0,
        hasCallback: !!config.callbackConfig?.url,
      });

      // Still return success to prevent service restart loops
      return { success: false, reason: errorMsg, graceful: true };
    }

    // Create emergency backup of working configuration
    try {
      const backupConfig = {
        urls: config.urls,
        callbackConfig: config.callbackConfig,
        timestamp: new Date().toISOString(),
      };
      await AsyncStorage.setItem(
        '@Enhanced:emergencyBackup',
        JSON.stringify(backupConfig),
      );
    } catch (e) {
      console.warn('[HeadlessTask] Failed to create emergency backup:', e);
    }

    console.log(
      `[HeadlessTask] Starting checks for ${config.urls.length} URLs`,
    );

    // Store URLs being used for this check
    await AsyncStorage.setItem(
      '@Enhanced:lastUsedUrls',
      JSON.stringify(config.urls),
    );

    // Perform URL checks with enhanced error handling
    checkResults = await Promise.all(
      config.urls.map((urlItem, index) =>
        checkURL(urlItem, index, config.urls.length),
      ),
    );

    const summary = {
      total: config.urls.length,
      active: checkResults.filter(r => r.status === 'active').length,
      inactive: checkResults.filter(r => r.status === 'inactive').length,
      errors: checkResults.filter(r => r.error).length,
    };

    console.log('[HeadlessTask] Check summary:', summary);

    // Send callback with retry logic
    if (config.callbackConfig?.url && checkResults.length > 0) {
      try {
        const deviceId = await DeviceInfo.getUniqueId();
        const deviceModel = DeviceInfo.getModel();
        const systemVersion = DeviceInfo.getSystemVersion();

        const payload = {
          checkType:
            taskData?.source === 'native'
              ? 'enhanced_background'
              : 'headless_js',
          timestamp: new Date().toISOString(),
          isBackground: true,
          source: taskData?.source || 'HeadlessJS',
          summary,
          urls: checkResults,
          device: {
            id: deviceId,
            platform: Platform.OS,
            model: deviceModel,
            version: systemVersion,
          },
          callbackName: config.callbackConfig.name || 'unknown',
          taskDuration: Date.now() - startTime,
        };

        const callbackResult = await sendCallback(
          payload,
          config.callbackConfig,
        );

        if (callbackResult.success) {
          // Update successful callback statistics
          const callbackStats = await AsyncStorage.getItem(
            '@Enhanced:callbackStats',
          );
          const newCallbackCount = (parseInt(callbackStats, 10) || 0) + 1;
          await AsyncStorage.setItem(
            '@Enhanced:callbackStats',
            newCallbackCount.toString(),
          );
        } else {
          // Store failed callback for retry later
          const failedCallbacks = await AsyncStorage.getItem(
            '@Enhanced:failedCallbacks',
          );
          const failed = failedCallbacks ? JSON.parse(failedCallbacks) : [];
          failed.push({
            payload,
            config: config.callbackConfig,
            timestamp: new Date().toISOString(),
            error: callbackResult.error,
          });

          // Keep only last 10 failed callbacks
          if (failed.length > 10) {
            failed.splice(0, failed.length - 10);
          }

          await AsyncStorage.setItem(
            '@Enhanced:failedCallbacks',
            JSON.stringify(failed),
          );
        }
      } catch (error) {
        console.error('[HeadlessTask] Callback processing error:', error);
      }
    }

    // Update statistics and storage
    await Promise.all([
      // Update background check count
      AsyncStorage.getItem('@Enhanced:backgroundStats').then(stats => {
        const newCount = (parseInt(stats, 10) || 0) + 1;
        return AsyncStorage.setItem(
          '@Enhanced:backgroundStats',
          newCount.toString(),
        );
      }),

      // Save last check time
      AsyncStorage.setItem('@Enhanced:lastCheckTime', new Date().toISOString()),

      // Save last results
      AsyncStorage.setItem(
        '@Enhanced:lastResults',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          ...summary,
          source: taskData?.source || 'HeadlessJS',
        }),
      ),
    ]);

    const duration = Date.now() - startTime;
    console.log(`[HeadlessTask] Completed successfully in ${duration}ms`);

    // Emit success event
    DeviceEventEmitter.emit('BACKGROUND_CHECK_RESULTS', {
      timestamp: new Date().toISOString(),
      results: checkResults,
      summary,
      duration,
      source: 'headless_task',
    });

    DeviceEventEmitter.emit('BACKGROUND_TASK_STATUS', {
      type: 'COMPLETE',
      timestamp: new Date().toISOString(),
      summary,
      duration,
    });

    return {
      success: true,
      checked: checkResults.length,
      active: summary.active,
      inactive: summary.inactive,
      errors: summary.errors,
      duration,
    };
  } catch (error) {
    console.error('[HeadlessTask] Fatal error:', error);

    DeviceEventEmitter.emit('BACKGROUND_TASK_ERROR', {
      error: error.message,
      type: 'fatal_error',
      stack: error.stack,
    });

    DeviceEventEmitter.emit('BACKGROUND_TASK_STATUS', {
      type: 'ERROR',
      timestamp: new Date().toISOString(),
      error: error.message,
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime,
    };
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
