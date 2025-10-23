/**
 * @format
 */

import { AppRegistry, Platform } from 'react-native';
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

  const startTime = Date.now();

  try {
    // Prefer config passed from native service (if any)
    let savedUrls = null;
    let savedCallback = null;
    let savedAutoCheck = null;

    if (taskData && taskData.serviceConfig) {
      console.log('[HeadlessTask] Using serviceConfig provided by native service');
      try {
        const parsed = typeof taskData.serviceConfig === 'string' ? JSON.parse(taskData.serviceConfig) : taskData.serviceConfig;
        savedUrls = JSON.stringify(parsed.urls || []);
        savedCallback = JSON.stringify(parsed.callbackConfig || {});
        savedAutoCheck = JSON.stringify(true);
      } catch (e) {
        console.warn('[HeadlessTask] Invalid serviceConfig provided, falling back to AsyncStorage', e);
      }
    }

    // Load configuration from storage if not provided
    if (!savedUrls || !savedCallback || !savedAutoCheck) {
      const loaded = await Promise.all([
        AsyncStorage.getItem('@Enhanced:urls'),
        AsyncStorage.getItem('@Enhanced:callback'),
        AsyncStorage.getItem('@Enhanced:autoCheckEnabled'),
      ]);
      savedUrls = savedUrls || loaded[0];
      savedCallback = savedCallback || loaded[1];
      savedAutoCheck = savedAutoCheck || loaded[2];
    }

    // Check if auto check is enabled
    if (!savedAutoCheck || !JSON.parse(savedAutoCheck)) {
      console.log('[HeadlessTask] Auto check disabled, skipping...');
      return { success: false, reason: 'disabled' };
    }

    if (!savedUrls || !savedCallback) {
      console.log('[HeadlessTask] No URLs or callback configured');
      return { success: false, reason: 'not_configured' };
    }

    const urls = JSON.parse(savedUrls);
    const callbackConfig = JSON.parse(savedCallback);

    if (urls.length === 0) {
      console.log('[HeadlessTask] No URLs to check');
      return { success: false, reason: 'no_urls' };
    }

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
          checkType: 'headless_js',
          timestamp: new Date().toISOString(),
          isBackground: true,
          source: 'HeadlessJS',
          summary: {
            total: checkResults.length,
            active: activeCount,
            inactive: inactiveCount,
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

    return {
      success: true,
      checked: checkResults.length,
      active: checkResults.filter(r => r.status === 'active').length,
      inactive: checkResults.filter(r => r.status === 'inactive').length,
      duration: duration,
    };
  } catch (error) {
    console.error('[HeadlessTask] Fatal error:', error);
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
