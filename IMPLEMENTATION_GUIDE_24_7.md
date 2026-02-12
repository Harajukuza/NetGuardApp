# 📱 NetGuard 24/7 Operation Implementation Guide

## 📊 Executive Summary

This guide provides comprehensive instructions for implementing 24/7 continuous operation for the NetGuard React Native application. The solution addresses platform-specific limitations and implements robust background task management for both iOS and Android.

---

## 🎯 Problems Identified & Solutions

### Critical Issues Found:

1. **❌ iOS Background Modes Not Configured**
   - **Impact**: App cannot run in background on iOS
   - **Solution**: Added UIBackgroundModes and BGTaskScheduler configuration

2. **❌ No Boot Receiver Implementation**
   - **Impact**: App doesn't restart after device reboot
   - **Solution**: Implemented BootReceiver.java with auto-start capability

3. **❌ Missing WorkManager/JobScheduler**
   - **Impact**: Android services get killed by OS
   - **Solution**: Implemented WorkManager with periodic and one-time tasks

4. **❌ Memory Leaks**
   - **Impact**: App crashes after extended runtime
   - **Solution**: Proper cleanup of timers, listeners, and abort controllers

5. **❌ No Health Monitoring**
   - **Impact**: Service failures go undetected
   - **Solution**: Implemented health check system with auto-recovery

---

## 🚀 Implementation Steps

### Step 1: Install Required Dependencies

```bash
# Install new packages
npm install @react-native-firebase/app @react-native-firebase/messaging
npm install react-native-background-fetch
npm install react-native-push-notification
npm install react-native-notifications
npm install react-native-workmanager

# iOS specific
cd ios && pod install
```

### Step 2: Android Configuration

#### 2.1 Update AndroidManifest.xml

```xml
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- Add Boot Receiver -->
<receiver 
    android:name=".BootReceiver"
    android:enabled="true"
    android:exported="true"
    android:directBootAware="true">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
        <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />
        <action android:name="android.intent.action.QUICKBOOT_POWERON" />
        <action android:name="com.htc.intent.action.QUICKBOOT_POWERON" />
    </intent-filter>
</receiver>

<!-- Foreground Service -->
<service 
    android:name=".BackgroundService"
    android:enabled="true"
    android:exported="false"
    android:foregroundServiceType="dataSync"
    android:stopWithTask="false" />
```

#### 2.2 Add WorkManager Dependency (build.gradle)

```gradle
dependencies {
    implementation "androidx.work:work-runtime:2.8.1"
    implementation "androidx.work:work-runtime-ktx:2.8.1"
    implementation "com.google.guava:guava:31.1-android"
}
```

### Step 3: iOS Configuration

#### 3.1 Update Info.plist

```xml
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>processing</string>
    <string>remote-notification</string>
</array>

<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.netguard.urlcheck</string>
    <string>com.netguard.refresh</string>
</array>
```

#### 3.2 Update AppDelegate.m

```objc
#import <BackgroundTasks/BackgroundTasks.h>

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // Register background tasks
  if (@available(iOS 13.0, *)) {
    [[BGTaskScheduler sharedScheduler] registerForTaskWithIdentifier:@"com.netguard.urlcheck" 
                                                          usingQueue:nil 
                                                       launchHandler:^(BGTask *task) {
      [self handleBackgroundTask:task];
    }];
  }
  
  // Enable background fetch
  [application setMinimumBackgroundFetchInterval:UIApplicationBackgroundFetchIntervalMinimum];
  
  return YES;
}

- (void)application:(UIApplication *)application performFetchWithCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler
{
  // Handle background fetch
  // Trigger React Native background task
  completionHandler(UIBackgroundFetchResultNewData);
}
```

### Step 4: Implement React Native Service

#### 4.1 Initialize Background Service

```typescript
import { ImprovedBackgroundService } from './ImprovedBackgroundService';

// In your App.tsx
useEffect(() => {
  const initBackgroundService = async () => {
    try {
      const service = ImprovedBackgroundService.getInstance();
      await service.initialize();
      
      // Configure service
      await service.saveConfiguration({
        checkInterval: 300000, // 5 minutes
        maxRetries: 3,
        retryDelay: 5000,
        timeout: 30000,
        batchSize: 10,
        enableLogging: true,
        enableNotifications: true,
      });
      
      // Start service
      await service.start();
      
      console.log('Background service started successfully');
    } catch (error) {
      console.error('Failed to start background service:', error);
    }
  };
  
  initBackgroundService();
  
  // Cleanup on unmount
  return () => {
    ImprovedBackgroundService.getInstance().stop();
  };
}, []);
```

#### 4.2 Register Headless Task

```javascript
// In index.js
import { AppRegistry } from 'react-native';
import { ImprovedBackgroundService } from './ImprovedBackgroundService';

// Register headless task for Android
AppRegistry.registerHeadlessTask('HeadlessCheckTask', () => async (taskData) => {
  console.log('Headless task started:', taskData);
  
  const service = ImprovedBackgroundService.getInstance();
  await service.performBackgroundWork(taskData);
  
  return Promise.resolve();
});

// Register background fetch for iOS
AppRegistry.registerComponent('NetGuardNew', () => App);
```

---

## 🧪 Testing Procedures

### Android Testing

```bash
# Test boot receiver
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED

# Test foreground service
adb shell dumpsys activity services | grep NetGuard

# Test WorkManager
adb shell dumpsys jobscheduler | grep com.netguard

# Monitor logs
adb logcat | grep "NetGuard:"
```

### iOS Testing

```bash
# Simulate background fetch
xcrun simctl background_fetch booted com.netguard

# Test background processing
e -l objc -e '@import BackgroundTasks; [[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.netguard.urlcheck"]'

# Monitor console logs
xcrun simctl spawn booted log stream --level debug | grep NetGuard
```

---

## 📊 Monitoring & Health Checks

### 1. Service Health Monitor

```typescript
const healthStatus = await service.getServiceStatus();
console.log('Service Health:', {
  isRunning: healthStatus.isRunning,
  uptime: healthStatus.uptime,
  lastCheck: healthStatus.lastCheck,
  totalChecks: healthStatus.totalChecks,
  failedChecks: healthStatus.failedChecks,
});
```

### 2. Memory Management

```typescript
// Automatic cleanup every hour
const performCleanup = async () => {
  const service = ImprovedBackgroundService.getInstance();
  await service.performCleanup();
  
  // Check memory usage
  const memoryUsage = await DeviceInfo.getUsedMemory();
  if (memoryUsage > threshold) {
    await service.restart();
  }
};
```

### 3. Error Tracking

```typescript
// Setup error boundaries
const errorHandler = (error: Error, isFatal: boolean) => {
  console.error('App Error:', error);
  
  // Log to service
  const service = ImprovedBackgroundService.getInstance();
  service.logError('Runtime Error', error);
  
  // Restart if fatal
  if (isFatal) {
    service.restart();
  }
};

ErrorUtils.setGlobalHandler(errorHandler);
```

---

## ⚠️ Platform Limitations & Workarounds

### iOS Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| Background execution time (30 seconds) | Tasks may not complete | Use BGProcessingTask for longer tasks |
| Background fetch interval (minimum 15 min) | Less frequent checks | Use push notifications for critical updates |
| App Store review restrictions | App may be rejected | Justify background usage clearly |
| Battery optimization | System may throttle app | Request user to disable low power mode |

### Android Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| Doze mode | Services get killed | Use high-priority FCM messages |
| App Standby | Reduced background activity | Request battery optimization exemption |
| Background service restrictions (Android 8+) | Services must be foreground | Use foreground service with notification |
| WorkManager minimum interval (15 min) | Less frequent checks | Combine with foreground service |

---

## 🔧 Troubleshooting Guide

### Common Issues & Solutions

#### 1. Service Not Starting After Reboot

**Android:**
```bash
# Check if boot permission is granted
adb shell dumpsys package com.netguard | grep BOOT

# Verify receiver registration
adb shell dumpsys package com.netguard | grep Receiver
```

**Solution:**
- Ensure RECEIVE_BOOT_COMPLETED permission is in manifest
- Check if app is not on "Force Stop" state
- Some devices require manual enabling of auto-start

#### 2. Background Task Killed Frequently

**Solution:**
```javascript
// Request battery optimization exemption
if (Platform.OS === 'android') {
  const { BackgroundTaskModule } = NativeModules;
  await BackgroundTaskModule.requestBatteryOptimizationExemption();
}
```

#### 3. Memory Leaks

**Detection:**
```javascript
// Monitor memory usage
setInterval(async () => {
  const used = await DeviceInfo.getUsedMemory();
  const total = await DeviceInfo.getTotalMemory();
  const percentage = (used / total) * 100;
  
  if (percentage > 80) {
    console.warn('High memory usage:', percentage + '%');
    // Trigger cleanup
  }
}, 60000);
```

#### 4. Network Requests Failing in Background

**Solution:**
```javascript
// Use background-compatible fetch
const backgroundFetch = async (url, options) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...options.headers,
        'Cache-Control': 'no-cache',
      },
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
};
```

---

## 🎯 Best Practices

### 1. Battery Optimization

```typescript
// Adaptive checking based on battery level
const adjustCheckInterval = async () => {
  const batteryLevel = await DeviceInfo.getBatteryLevel();
  
  if (batteryLevel < 0.2) { // Less than 20%
    await service.saveConfiguration({
      checkInterval: 900000, // 15 minutes
    });
  } else if (batteryLevel < 0.5) { // Less than 50%
    await service.saveConfiguration({
      checkInterval: 600000, // 10 minutes
    });
  } else {
    await service.saveConfiguration({
      checkInterval: 300000, // 5 minutes
    });
  }
};
```

### 2. Network Optimization

```typescript
// Check network before performing tasks
const shouldPerformCheck = async () => {
  const netInfo = await NetInfo.fetch();
  
  // Skip if no connection
  if (!netInfo.isConnected) return false;
  
  // Reduce frequency on cellular
  if (netInfo.type === 'cellular') {
    const config = await service.getConfiguration();
    if (Date.now() - lastCellularCheck < config.checkInterval * 2) {
      return false;
    }
  }
  
  return true;
};
```

### 3. Error Recovery

```typescript
// Implement exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3) => {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = Math.min(1000 * Math.pow(2, i), 30000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
};
```

### 4. Data Persistence

```typescript
// Save critical data regularly
const persistCriticalData = async () => {
  const state = service.getState();
  const results = service.getLastResults();
  
  await AsyncStorage.multiSet([
    ['@service_state', JSON.stringify(state)],
    ['@last_results', JSON.stringify(results)],
    ['@last_save', Date.now().toString()],
  ]);
};

// Schedule regular saves
setInterval(persistCriticalData, 60000); // Every minute
```

---

## 📈 Performance Metrics

### Key Metrics to Monitor

1. **Service Uptime**: Target > 95%
2. **Check Success Rate**: Target > 90%
3. **Memory Usage**: Keep below 100MB
4. **Battery Impact**: < 5% per hour
5. **Network Usage**: < 10MB per hour

### Monitoring Implementation

```typescript
const metrics = {
  startTime: Date.now(),
  totalChecks: 0,
  successfulChecks: 0,
  failedChecks: 0,
  totalNetworkBytes: 0,
  
  getUptime() {
    return Date.now() - this.startTime;
  },
  
  getSuccessRate() {
    if (this.totalChecks === 0) return 0;
    return (this.successfulChecks / this.totalChecks) * 100;
  },
  
  logCheck(success: boolean, bytesUsed: number) {
    this.totalChecks++;
    if (success) {
      this.successfulChecks++;
    } else {
      this.failedChecks++;
    }
    this.totalNetworkBytes += bytesUsed;
  },
};
```

---

## 🚨 Emergency Procedures

### Service Recovery

```typescript
// Auto-recovery system
const setupAutoRecovery = () => {
  // Monitor service health
  setInterval(async () => {
    const service = ImprovedBackgroundService.getInstance();
    const status = await service.getServiceStatus();
    
    if (!status.isRunning) {
      console.log('Service down, attempting recovery...');
      
      try {
        await service.destroy();
        await service.initialize();
        await service.start();
        
        console.log('Service recovered successfully');
      } catch (error) {
        console.error('Recovery failed:', error);
        
        // Fallback: Schedule native task
        if (Platform.OS === 'android') {
          NativeModules.BackgroundTaskModule.startForegroundService(5);
        }
      }
    }
  }, 30000); // Check every 30 seconds
};
```

---

## 📱 User Guidance

### In-App Instructions

```typescript
const showBackgroundSetupGuide = () => {
  Alert.alert(
    'Enable Background Operation',
    Platform.select({
      ios: 'Please go to Settings > NetGuard and enable:\n\n' +
           '• Background App Refresh\n' +
           '• Notifications (for updates)\n\n' +
           'This ensures URL monitoring continues when app is closed.',
      android: 'Please go to Settings > Apps > NetGuard and:\n\n' +
           '• Disable Battery Optimization\n' +
           '• Enable Autostart (if available)\n' +
           '• Allow Background Activity\n\n' +
           'This ensures 24/7 monitoring.',
    }),
    [
      { text: 'Later', style: 'cancel' },
      { text: 'Open Settings', onPress: openAppSettings },
    ]
  );
};
```

---

## 📝 Maintenance Checklist

### Daily
- [ ] Check service uptime metrics
- [ ] Review error logs
- [ ] Monitor memory usage

### Weekly
- [ ] Clear old logs and cached data
- [ ] Review battery impact reports
- [ ] Test auto-recovery mechanism

### Monthly
- [ ] Update dependencies
- [ ] Review and optimize check intervals
- [ ] Analyze performance metrics
- [ ] Test on different OS versions

---

## 🔗 Additional Resources

- [React Native Background Fetch](https://github.com/transistorsoft/react-native-background-fetch)
- [Android WorkManager Guide](https://developer.android.com/topic/libraries/architecture/workmanager)
- [iOS Background Execution](https://developer.apple.com/documentation/backgroundtasks)
- [React Native Background Actions](https://github.com/Rapsssito/react-native-background-actions)

---

## 📞 Support

For issues or questions regarding implementation:

1. Check the troubleshooting section
2. Review platform limitations
3. Enable debug logging: `service.enableDebugMode(true)`
4. Collect logs: `service.exportLogs()`

---

**Last Updated**: December 2024
**Version**: 1.0.0
**Status**: Production Ready ✅