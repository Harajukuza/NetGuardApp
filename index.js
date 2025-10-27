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
    // ใช้ config จาก native service หรือ AsyncStorage
    let urls = [];
    let callbackConfig = null;
    
    // รับ config จาก native service ก่อน
    if (taskData && taskData.serviceConfig) {
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

    // ถ้าไม่มี config จาก native service ให้ใช้จาก AsyncStorage
    if (urls.length === 0 || !callbackConfig) {
      console.log('[HeadlessTask] Loading config from AsyncStorage');
      const [savedUrls, savedCallback] = await Promise.all([
        AsyncStorage.getItem('@Enhanced:urls'),
        AsyncStorage.getItem('@Enhanced:callback')
      ]);

      if (savedUrls) {
        try {
          const parsed = JSON.parse(savedUrls);
          if (Array.isArray(parsed)) {
            urls = parsed;
          } else if (parsed?.urls && Array.isArray(parsed.urls)) {
            urls = parsed.urls.map(url => ({ url }));
          }
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

    // ถ้ายังไม่มี URLs ให้ลองดึงจาก API
    if (urls.length === 0) {
      try {
        const [selectedCallback, apiEndpoint] = await Promise.all([
          AsyncStorage.getItem('@Enhanced:selectedCallback'),
          AsyncStorage.getItem('@Enhanced:apiEndpoint')
        ]);

        if (selectedCallback && apiEndpoint) {
          console.log('[HeadlessTask] Fetching URLs from API');
          const response = await fetch(apiEndpoint);
          const data = await response.json();
          
          if (data?.data && Array.isArray(data.data)) {
            const filtered = data.data.filter(
              item => String(item.callback_name) === String(selectedCallback)
            );
            
            if (filtered.length > 0) {
              urls = filtered.map(item => ({
                id: `${item.id}_${Date.now()}`,
                url: item.url
              }));
              
              // อัพเดท callback config ถ้ามีข้อมูลใหม่จาก API
              if (filtered[0].callback_url) {
                callbackConfig = {
                  name: selectedCallback,
                  url: filtered[0].callback_url
                };
              }
            }
          }
        }
      } catch (e) {
        console.error('[HeadlessTask] Error fetching from API:', e);
      }
    }

    // ตรวจสอบว่ามี URLs และ callback config
    if (urls.length === 0 || !callbackConfig?.url) {
      console.log('[HeadlessTask] No URLs or callback config available');
      return { success: false, reason: 'no_data' };
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
