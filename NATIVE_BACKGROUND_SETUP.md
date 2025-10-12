# NetGuard Native Background Service - Setup & Testing Guide

## 🚀 Overview

This guide will help you set up and test the native Android background service for NetGuard Pro. The native service provides true background monitoring capabilities that persist even when the app is closed or the device is restarted.

## 📋 Features

- ✅ **Native Android Foreground Service** - True background execution
- ✅ **WorkManager Integration** - Periodic task scheduling
- ✅ **Power Management** - Handles Doze Mode and Battery Optimization
- ✅ **Auto-Restart** - Service restarts after system kill/reboot
- ✅ **Retry/Resume Logic** - Robust error handling and recovery
- ✅ **Statistics & Monitoring** - Comprehensive service metrics
- ✅ **React Native Bridge** - Seamless integration with existing app

## 🛠️ Installation Steps

### 1. Update Build Dependencies

Add the following to your `android/app/build.gradle`:

```gradle
dependencies {
    // Background service and WorkManager
    implementation "androidx.work:work-runtime-ktx:2.8.1"
    implementation "androidx.work:work-gcm:2.8.1"

    // OkHttp for network requests
    implementation "com.squareup.okhttp3:okhttp:4.12.0"
    implementation "com.squareup.okhttp3:logging-interceptor:4.12.0"

    // JSON handling
    implementation "org.json:json:20230618"

    // Coroutines for async operations
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.6.4"
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.6.4"

    // AndroidX Core and Lifecycle
    implementation "androidx.core:core-ktx:1.10.1"
    implementation "androidx.lifecycle:lifecycle-service:2.6.1"
    implementation "androidx.lifecycle:lifecycle-process:2.6.1"

    // Notification support
    implementation "androidx.core:core:1.10.1"

    // Startup initialization
    implementation "androidx.startup:startup-runtime:1.1.1"
}

android {
    compileSdkVersion 34
    buildToolsVersion "34.0.0"

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = '1.8'
    }

    packagingOptions {
        pickFirst "lib/x86/libc++_shared.so"
        pickFirst "lib/x86_64/libc++_shared.so"
        pickFirst "lib/arm64-v8a/libc++_shared.so"
        pickFirst "lib/armeabi-v7a/libc++_shared.so"
    }
}
```

### 2. Register Native Module

Update your `MainApplication.kt`:

```kotlin
import com.netguardnew.backgroundservice.BackgroundServicePackage

class MainApplication : Application(), ReactApplication {

    private val mReactNativeHost: ReactNativeHost = object : ReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
                // Add the BackgroundServicePackage
                add(BackgroundServicePackage())
            }
        
        // ... rest of your existing code
    }
}
```

### 3. Verify Permissions

Ensure your `AndroidManifest.xml` has these permissions:

```xml
<!-- Basic permissions -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- Background service permissions -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />

<!-- Battery optimization -->
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

<!-- Boot receiver -->
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

<!-- For Android 14+ -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

### 4. Clean and Rebuild

```bash
cd android
./gradlew clean
cd ..
npx react-native run-android
```

## 🧪 Testing Guide

### 1. Basic Functionality Test

1. **Start the app** and add some URLs to monitor
2. **Configure callback URL** (use webhook.site for testing)
3. **Enable Native Service mode** in settings
4. **Start background service** - you should see a persistent notification
5. **Check logs** with: `adb logcat | grep NetGuard`

### 2. Background Monitoring Test

1. **Start the service** and minimize the app
2. **Wait for check interval** (default 60 seconds)
3. **Check webhook.site** for incoming callbacks
4. **Verify notification updates** show active/inactive counts

### 3. App Kill/Restart Test

1. **Start service** and note the start time
2. **Force kill app** using recent apps menu
3. **Wait 5-10 minutes** without opening app
4. **Check webhook for continuous callbacks** - service should continue running
5. **Reopen app** - service should still be running with correct uptime

### 4. Device Reboot Test

1. **Start service** and add some URLs
2. **Reboot device completely**
3. **Wait for device to boot** (don't open app)
4. **Check for background service notification** - should auto-start
5. **Open app** - service should show as running with auto-restart flag

### 5. Battery Optimization Test

1. **Request battery optimization exemption** through app settings
2. **Go to Settings > Battery > Battery Optimization**
3. **Verify app is listed as "Not optimized"**
4. **Test long-term monitoring** (several hours)

## 🔧 Troubleshooting

### Service Not Starting

**Problem**: Service fails to start or stops immediately

**Solutions**:
1. Check logcat for errors: `adb logcat | grep -E "(NetGuard|ERROR|FATAL)"`
2. Verify all permissions are granted
3. Ensure target SDK is correct (34+)
4. Check for missing dependencies in build.gradle

**Debug Commands**:
```bash
# Check if service is running
adb shell dumpsys activity services | grep NetGuard

# Check notifications
adb shell dumpsys notification | grep netguard

# Check WorkManager tasks
adb shell dumpsys jobscheduler | grep androidx.work
```

### Service Gets Killed

**Problem**: Service stops after some time

**Solutions**:
1. Request battery optimization exemption
2. Enable "Auto-start" in manufacturer settings (Xiaomi, Huawei, etc.)
3. Lock app in recent apps
4. Check for aggressive power management policies

**Manufacturer-Specific Settings**:

**Xiaomi/MIUI**:
- Settings > Battery > Battery Optimization > NetGuard > Don't Optimize
- Security > Permissions > Autostart > NetGuard > Enable

**Huawei/EMUI**:
- Settings > Battery > App Launch > NetGuard > Manage manually
- Enable all toggles (Auto-launch, Secondary launch, Run in background)

**Samsung/OneUI**:
- Settings > Apps > NetGuard > Battery > Optimize battery usage > Turn off
- Settings > Device care > Battery > Background app limits > Never sleeping apps > Add NetGuard

**OnePlus/OxygenOS**:
- Settings > Battery > Battery optimization > NetGuard > Don't optimize
- Settings > Apps > NetGuard > App battery optimization > Don't optimize

### Callbacks Not Working

**Problem**: URLs are checked but callbacks not sent

**Solutions**:
1. Verify callback URL is accessible
2. Check network connectivity
3. Look for timeout errors in logs
4. Test with webhook.site first

**Debug Callback**:
```bash
# Test callback URL manually
curl -X POST "YOUR_CALLBACK_URL" \
  -H "Content-Type: application/json" \
  -d '{"test": "manual_test", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
```

### WorkManager Issues

**Problem**: Periodic worker not scheduling properly

**Solutions**:
1. Check if device has Doze mode enabled
2. Verify WorkManager constraints
3. Test with shorter intervals first

**Debug WorkManager**:
```bash
# Check WorkManager database
adb shell
su
cd /data/data/com.netguardnew/databases/
sqlite3 androidx.work.workdb
.tables
SELECT * FROM workspec WHERE id LIKE '%NetGuard%';
```

## 📊 Monitoring & Logs

### Real-time Monitoring

```bash
# Watch service logs
adb logcat | grep -E "(NetGuardBgService|NetGuardPeriodicWorker|NetGuardBootReceiver)"

# Watch all NetGuard logs
adb logcat | grep NetGuard

# Watch system service logs
adb logcat | grep -E "(ActivityManager|PowerManagerService|BatteryOptimization)"
```

### Service Statistics

The service provides comprehensive statistics accessible through:

1. **App UI** - Service statistics section
2. **React Native Bridge** - `getServiceStatus()` method
3. **Logs** - Regular statistics logging
4. **SharedPreferences** - Persistent stats storage

**Key Metrics**:
- Service uptime
- Total URL checks performed
- Successful/failed callbacks
- Last check timestamp
- Auto-restart events

## 🔒 Security Considerations

### Network Security

1. **HTTPS URLs**: Always use HTTPS for callbacks
2. **Certificate Validation**: OkHttp validates SSL certificates
3. **Timeout Configuration**: Prevents hanging requests
4. **User-Agent Rotation**: Reduces fingerprinting

### Data Privacy

1. **Local Storage**: All data stored locally on device
2. **No Data Collection**: Service doesn't collect user data
3. **Minimal Permissions**: Only necessary permissions requested
4. **Secure Communication**: End-to-end encrypted callbacks

## 📱 Performance Optimization

### Battery Optimization

1. **Intelligent Scheduling**: Uses WorkManager for efficiency
2. **Wake Lock Management**: Minimal wake lock usage
3. **Network Batching**: Groups requests efficiently
4. **CPU Optimization**: Coroutines for non-blocking operations

### Memory Management

1. **Bounded Collections**: Limited log storage
2. **Garbage Collection**: Proper object lifecycle
3. **Resource Cleanup**: Automatic resource release
4. **Memory Monitoring**: Built-in memory usage tracking

## 🚨 Emergency Procedures

### Force Stop Service

```bash
# Stop via ADB
adb shell am force-stop com.netguardnew

# Kill specific service
adb shell am stopservice com.netguardnew/.backgroundservice.NetGuardBackgroundService

# Cancel WorkManager tasks
adb shell am broadcast -a androidx.work.impl.background.systemalarm.RescheduleReceiver
```

### Reset Service State

```bash
# Clear app data
adb shell pm clear com.netguardnew

# Or clear specific preferences
adb shell
run-as com.netguardnew
cd shared_prefs
rm NetGuardServicePrefs.xml
```

### Debug Service State

```bash
# Check service status
adb shell dumpsys activity services com.netguardnew

# Check notifications
adb shell dumpsys notification

# Check alarms and jobs
adb shell dumpsys alarm | grep netguard
adb shell dumpsys jobscheduler | grep netguard
```

## ✅ Verification Checklist

Before deploying to production:

- [ ] Service starts successfully
- [ ] Persistent notification appears
- [ ] URLs are monitored in background
- [ ] Callbacks are sent correctly
- [ ] Service survives app kill
- [ ] Service auto-restarts after reboot
- [ ] Battery optimization exemption works
- [ ] WorkManager scheduling functions
- [ ] Error handling works properly
- [ ] Statistics are accurate
- [ ] Memory usage is reasonable
- [ ] Network usage is optimized

## 📞 Support

If you encounter issues:

1. **Check logs** with provided commands
2. **Verify setup** against this guide
3. **Test on different devices** and Android versions
4. **Check manufacturer-specific settings**
5. **Monitor battery and memory usage**

## 🔄 Updates and Maintenance

### Regular Maintenance

1. **Monitor service metrics** regularly
2. **Update dependencies** quarterly
3. **Test on new Android versions**
4. **Review manufacturer settings** changes
5. **Optimize based on usage patterns**

### Performance Tuning

1. **Adjust check intervals** based on needs
2. **Optimize callback payloads** for bandwidth
3. **Fine-tune retry mechanisms**
4. **Monitor and optimize battery usage**
5. **Scale monitoring based on device capabilities**

---

## 📝 Notes

- This implementation is optimized for Android 7.0+ (API level 24+)
- Some features may behave differently on custom ROMs
- Battery optimization behavior varies by manufacturer
- WorkManager requires Google Play Services on some devices
- Service behavior may change with Android updates

**Happy Monitoring! 🚀**