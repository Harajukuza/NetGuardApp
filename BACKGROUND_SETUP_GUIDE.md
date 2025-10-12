# NetGuard Background Service Setup Guide

## 📱 Complete Setup Instructions for Android & iOS Background Services

### Table of Contents
1. [Prerequisites](#prerequisites)
2. [Android Setup](#android-setup)
3. [iOS Setup](#ios-setup)
4. [Testing Instructions](#testing-instructions)
5. [Troubleshooting](#troubleshooting)
6. [Best Practices](#best-practices)

---

## Prerequisites

### Required Dependencies
```bash
# Install required packages
npm install --save \
  react-native-background-actions@^4.0.1 \
  react-native-background-timer@^2.4.1 \
  @notifee/react-native@^7.8.0 \
  react-native-background-fetch@^4.2.0 \
  react-native-device-info@^14.1.1

# iOS only - Install pods
cd ios && pod install
```

### Platform Requirements
- **Android**: API Level 21+ (Android 5.0+)
- **iOS**: iOS 13.0+
- **React Native**: 0.70+

---

## Android Setup

### 1. Update AndroidManifest.xml
Add the following permissions and services to `android/app/src/main/AndroidManifest.xml`:

```xml
<!-- Add these permissions -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

<!-- Add inside <application> tag -->
<service
    android:name="com.asterinet.react.bgactions.RNBackgroundActionsTask"
    android:exported="false"
    android:foregroundServiceType="dataSync" />

<receiver
    android:name="com.asterinet.react.bgactions.BootReceiver"
    android:enabled="true"
    android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
    </intent-filter>
</receiver>
```

### 2. Create Notification Channel (Android 8+)
Add to `MainActivity.java` or `MainApplication.java`:

```java
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

@Override
public void onCreate() {
    super.onCreate();
    
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        NotificationChannel channel = new NotificationChannel(
            "netguard_monitor",
            "URL Monitoring",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("NetGuard background monitoring service");
        
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }
}
```

### 3. Proguard Rules (if using ProGuard)
Add to `android/app/proguard-rules.pro`:

```
-keep class com.asterinet.react.bgactions.** { *; }
-keep class app.notifee.** { *; }
```

### 4. Battery Optimization Exemption
The app will request exemption at runtime. Users can also manually exempt the app:
- Settings → Battery → Battery Optimization
- Select "All apps" → Find NetGuard
- Select "Don't optimize"

---

## iOS Setup

### 1. Update Info.plist
Add to `ios/NetGuardNew/Info.plist`:

```xml
<!-- Background Modes -->
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>processing</string>
    <string>remote-notification</string>
</array>

<!-- Background Task Identifiers -->
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.netguard.monitor</string>
    <string>com.transistorsoft.fetch</string>
</array>
```

### 2. AppDelegate Configuration
Add to `AppDelegate.mm`:

```objc
#import <TSBackgroundFetch/TSBackgroundFetch.h>

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    // ... existing code ...
    
    // Initialize BackgroundFetch
    [[TSBackgroundFetch sharedInstance] didFinishLaunching];
    
    return YES;
}

// Add this method for iOS 13+
- (void)application:(UIApplication *)application performFetchWithCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler {
    NSLog(@"Background fetch initiated");
    [[TSBackgroundFetch sharedInstance] performFetchWithCompletionHandler:completionHandler applicationState:application.applicationState];
}
```

### 3. Enable Background Modes in Xcode
1. Open project in Xcode
2. Select your target → Signing & Capabilities
3. Click "+ Capability"
4. Add "Background Modes"
5. Check:
   - ✅ Background fetch
   - ✅ Background processing
   - ✅ Remote notifications (if using push)

### 4. Configure Background App Refresh
Users must enable Background App Refresh:
- Settings → General → Background App Refresh
- Enable for NetGuard

---

## Testing Instructions

### Android Testing

#### 1. Basic Service Test
```bash
# Run the app
npx react-native run-android

# Enable service in app
# Add URLs to monitor
# Toggle service ON
# Check notification appears
```

#### 2. Background Execution Test
```bash
# With service running:
1. Press Home button (app in background)
2. Wait for interval period
3. Check logs: adb logcat | grep "NetGuard"
4. Verify URLs are being checked
```

#### 3. Force Stop Test
```bash
# Force stop app
adb shell am force-stop com.netguardnew

# Service should restart automatically
# Check notification reappears
```

#### 4. Battery Optimization Test
```bash
# Enable battery saver
adb shell dumpsys battery set level 15

# Service should continue running
# May run less frequently
```

#### 5. Reboot Test
```bash
# With service enabled, reboot device
adb reboot

# After reboot:
# Service should restart automatically
# Check notification appears
```

### iOS Testing

#### 1. Background Fetch Test
```bash
# Run on physical device (not simulator)
npx react-native run-ios --device

# Enable service in app
# Move app to background
```

#### 2. Simulate Background Fetch (Xcode)
```
1. Run app from Xcode
2. Debug → Simulate Background Fetch
3. Check console logs
4. Verify background task executes
```

#### 3. BGTaskScheduler Test (iOS 13+)
```bash
# On device, use Console app to view logs
# Filter by process: NetGuard
# Look for BGTaskScheduler events
```

#### 4. Test Background Time Limits
```swift
// iOS limits background execution to ~30 seconds
// Test by adding timer in background task
// Verify task completes within time limit
```

### Testing with Real URLs

#### 1. Create Test Server
```javascript
// Simple Express server for testing
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  console.log(`Health check from: ${req.headers['user-agent']}`);
  res.status(200).json({ status: 'ok' });
});

app.post('/webhook', (req, res) => {
  console.log('Webhook received:', req.body);
  res.status(200).json({ received: true });
});

app.listen(3000, () => {
  console.log('Test server running on port 3000');
});
```

#### 2. Test URLs to Monitor
```
✅ Good test URLs:
- https://www.google.com
- https://httpstat.us/200 (always returns 200)
- https://httpstat.us/503 (always returns 503)
- http://localhost:3000/health (local server)

❌ Test error scenarios:
- https://invalid-domain-12345.com (DNS error)
- https://httpstat.us/500 (server error)
- https://httpstat.us/200?sleep=15000 (timeout)
```

---

## Troubleshooting

### Android Issues

#### Service Not Starting
```bash
# Check permissions
adb shell dumpsys package com.netguardnew | grep permission

# Check if service is running
adb shell dumpsys activity services | grep netguard

# View logs
adb logcat -s ReactNativeJS:V ReactNative:V BackgroundJob:V
```

#### Notification Not Showing
- Ensure notification permission granted (Android 13+)
- Check notification channel created
- Verify app not in "Do Not Disturb" exceptions

#### Service Stops Unexpectedly
- Check battery optimization settings
- Verify FOREGROUND_SERVICE permission
- Check for manufacturer-specific battery managers (Xiaomi, Huawei, etc.)

### iOS Issues

#### Background Fetch Not Working
```bash
# Check Background App Refresh enabled
# Settings → General → Background App Refresh → NetGuard

# Verify Info.plist configuration
plutil -p ios/NetGuardNew/Info.plist | grep UIBackgroundModes

# Check BGTaskScheduler registration
# Look for errors in device console
```

#### Task Not Executing
- iOS decides when to run background tasks based on:
  - App usage patterns
  - Battery level
  - Network conditions
  - Device thermal state
- Test by using app regularly for several days

#### Limited Background Time
- iOS limits background execution to ~30 seconds
- Use BGProcessingTask for longer tasks (up to several minutes)
- Schedule multiple shorter tasks instead of one long task

---

## Best Practices

### 1. Battery Optimization
```javascript
// Adjust check frequency based on battery
const getBatteryAwareInterval = async () => {
  const batteryLevel = await DeviceInfo.getBatteryLevel();
  if (batteryLevel < 0.2) return 120; // 2 hours when low
  if (batteryLevel < 0.5) return 60;  // 1 hour when medium
  return 30; // 30 minutes when high
};
```

### 2. Network-Aware Checking
```javascript
// Only check when connected
import NetInfo from '@react-native-community/netinfo';

const shouldPerformCheck = async () => {
  const state = await NetInfo.fetch();
  return state.isConnected && !state.isInternetReachable === false;
};
```

### 3. Intelligent Scheduling
```javascript
// Skip checks during night hours
const isNightTime = () => {
  const hour = new Date().getHours();
  return hour >= 23 || hour <= 6;
};

// Reduce frequency at night
const getSmartInterval = () => {
  if (isNightTime()) return 180; // 3 hours
  return 60; // 1 hour during day
};
```

### 4. Error Handling
```javascript
// Implement exponential backoff for failures
let failureCount = 0;

const checkWithBackoff = async () => {
  try {
    await performCheck();
    failureCount = 0;
  } catch (error) {
    failureCount++;
    const delay = Math.min(300, 30 * Math.pow(2, failureCount));
    setTimeout(checkWithBackoff, delay * 1000);
  }
};
```

### 5. Data Usage Optimization
```javascript
// Use HEAD requests instead of GET
fetch(url, { method: 'HEAD' })

// Cache results to avoid redundant checks
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const checkUrlCached = async (url) => {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.result;
  }
  
  const result = await checkUrl(url);
  cache.set(url, { result, time: Date.now() });
  return result;
};
```

### 6. User Experience
- Show clear status in notification
- Provide statistics in app
- Allow easy enable/disable
- Respect user's battery preferences
- Provide export/import for URL lists

### 7. Monitoring & Analytics
```javascript
// Track service health
const metrics = {
  successRate: 0,
  averageResponseTime: 0,
  totalChecks: 0,
  failures: [],
};

// Log to analytics
const logMetrics = async () => {
  // Send to your analytics service
  await analytics.track('BackgroundServiceMetrics', metrics);
};
```

---

## Platform-Specific Limitations

### Android Limitations
- Doze mode may delay execution (6+ hours idle)
- App Standby buckets affect frequency
- Manufacturer restrictions (MIUI, EMUI, etc.)
- Battery saver reduces background activity

### iOS Limitations
- No guaranteed execution time
- 30-second execution limit for fetch
- System decides when to run tasks
- No persistent notifications
- Background refresh can be disabled globally

---

## Production Checklist

### Before Release
- [ ] Test on multiple devices
- [ ] Test different OS versions
- [ ] Verify battery impact
- [ ] Test with poor network
- [ ] Handle permission denials
- [ ] Implement crash reporting
- [ ] Add analytics tracking
- [ ] Test app updates
- [ ] Document known issues
- [ ] Prepare user guide

### App Store Requirements
- [ ] Privacy policy for data collection
- [ ] Justify background mode usage
- [ ] Handle iOS review guidelines
- [ ] Test without background permissions
- [ ] Provide fallback functionality

---

## Support & Resources

### Documentation
- [React Native Background Actions](https://github.com/Rapsssito/react-native-background-actions)
- [Notifee Documentation](https://notifee.app/react-native/docs/overview)
- [iOS Background Execution](https://developer.apple.com/documentation/backgroundtasks)
- [Android Foreground Services](https://developer.android.com/guide/components/foreground-services)

### Community
- [React Native Community Discord](https://discord.gg/reactnative)
- [Stack Overflow - React Native](https://stackoverflow.com/questions/tagged/react-native)

### Debugging Tools
- [Flipper](https://fbflipper.com/) - Network & log debugging
- [React Native Debugger](https://github.com/jhen0409/react-native-debugger)
- Android Studio Profiler
- Xcode Instruments

---

## Version History

- **v1.0.0** - Initial implementation with basic background service
- **v1.1.0** - Added battery optimization and intelligent scheduling
- **v1.2.0** - Enhanced error handling and retry logic

---

*Last Updated: December 2024*