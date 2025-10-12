# NetGuard Background Service Guide

## 📱 การทำงานของ Background Service

### สถานะปัจจุบัน
- ✅ **Android**: ทำงานได้ 100% ด้วย react-native-background-actions
- ❌ **iOS**: ไม่รองรับ (ต้องใช้ Background Fetch API)

## 🔍 การวิเคราะห์โค้ดและการแก้ไข

### ปัญหาที่พบและแก้ไขแล้ว

#### 1. Memory Leaks
**ปัญหา**: การใช้ refs และ callbacks ไม่ถูกต้อง
```javascript
// ❌ ปัญหาเดิม
const performBackgroundUrlCheckRef = useRef();
performBackgroundUrlCheckRef.current = performBackgroundUrlCheck;

// ✅ แก้ไขแล้ว
- ใช้ global variables แทน refs สำหรับ background task
- เพิ่ม cleanup ใน useEffect
- ใช้ isMounted.current เพื่อป้องกัน state updates หลัง unmount
```

#### 2. Background Task Loop
**ปัญหา**: while loop อาจทำให้ service ค้าง
```javascript
// ❌ ปัญหาเดิม
while (BackgroundJob.isRunning()) {
  // infinite loop risk
}

// ✅ แก้ไขแล้ว
- ใช้ setInterval แทน while loop
- มี clear interval mechanism
- ตรวจสอบ backgroundTaskRunning flag
```

#### 3. Network Check Timeout
**ปัญหา**: fetch API timeout ไม่ทำงาน
```javascript
// ❌ ปัญหาเดิม
fetch(url, { timeout: 5000 }) // ไม่มี timeout property

// ✅ แก้ไขแล้ว
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);
fetch(url, { signal: controller.signal });
clearTimeout(timeoutId);
```

## 🚀 การติดตั้งและตั้งค่า

### 1. Dependencies ที่จำเป็น
```bash
npm install react-native-background-actions
npm install @react-native-async-storage/async-storage
npm install react-native-device-info
npm install react-native-safe-area-context

# สำหรับ Android
cd android && ./gradlew clean
```

### 2. Android Configuration

#### AndroidManifest.xml
```xml
<!-- เพิ่มใน AndroidManifest.xml -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" /> <!-- Android 13+ -->

<service android:name="com.asterinet.react.bgactions.RNBackgroundActionsTask" />
```

#### MainActivity.java
```java
// เพิ่มใน MainActivity.java
import android.os.Bundle;
import com.asterinet.react.bgactions.BackgroundActionsModule;

@Override
protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    BackgroundActionsModule.setActivity(this);
}
```

### 3. Permissions Required

#### Android Permissions
- `FOREGROUND_SERVICE` - สำหรับ foreground service
- `WAKE_LOCK` - ป้องกันอุปกรณ์ sleep
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` - ข้าม battery optimization
- `POST_NOTIFICATIONS` - แสดง notification (Android 13+)

## 📊 การทำงานในแต่ละสถานะ

### App States และ Background Service

| สถานะ | App Behavior | Background Service |
|-------|--------------|-------------------|
| **Foreground** | UI แสดงปกติ, รับ updates | ✅ ทำงานต่อเนื่อง |
| **Background** | UI ไม่แสดง, app ยังทำงาน | ✅ ทำงานต่อเนื่อง |
| **Killed/Terminated** | App ถูกปิด | ✅ Service ยังทำงาน* |

*หมายเหตุ: บางอุปกรณ์อาจ kill service เมื่อ battery optimization ทำงาน

## 🔧 การแก้ไขปัญหาที่พบบ่อย

### 1. Service ถูก Kill โดย System
**สาเหตุ**: Battery optimization, Doze mode
**แก้ไข**:
```javascript
// Request battery optimization exemption
await PermissionsAndroid.request(
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
);
```

### 2. Service ไม่ทำงานหลังปิด App
**สาเหตุ**: Manufacturer restrictions (Xiaomi, Huawei, OPPO)
**แก้ไข**:
- ให้ user ไป Settings > Battery > App launch > เลือก app > Manage manually
- เปิดทั้ง 3 options: Auto-launch, Secondary launch, Run in background

### 3. Notification ไม่แสดง
**สาเหตุ**: ไม่มี permission (Android 13+)
**แก้ไข**:
```javascript
if (Platform.Version >= 33) {
  await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
  );
}
```

## 📈 Performance Optimization

### 1. Battery Usage
- ใช้ interval ที่เหมาะสม (แนะนำ 60 นาทีขึ้นไป)
- Random delay ระหว่าง URL checks
- ใช้ batch callbacks แทนการส่งทีละ request

### 2. Network Optimization
```javascript
// Check network before making requests
const networkInfo = await checkNetworkInfo();
if (!networkInfo.isConnected) {
  bgLog('No network connection, skipping checks');
  return;
}
```

### 3. Memory Management
- จำกัด checkHistory ไว้ที่ 10 records
- Clear old logs เมื่อเกิน 100 entries
- ใช้ weak references สำหรับ callbacks

## 🧪 Testing Guide

### 1. Test Foreground
```bash
# Run app normally
npx react-native run-android

# Check logs
adb logcat | grep "BG"
```

### 2. Test Background
1. Start service ใน app
2. Press Home button
3. Check notification bar - ต้องเห็น "URL Monitor Active"
4. ดู logs: `adb logcat | grep "Background check triggered"`

### 3. Test App Killed
1. Start service
2. Swipe app จาก recent apps
3. Service notification ต้องยังอยู่
4. Check logs ว่ายังทำงาน

### 4. Debug Commands
```bash
# View all logs
adb logcat

# View background service logs only
adb logcat | grep -E "BG|Background|URLMonitor"

# Clear logs
adb logcat -c

# Save logs to file
adb logcat > logs.txt
```

## 📝 Code Structure

### Key Functions

#### 1. Background Task
```javascript
const backgroundTask = async (taskDataArguments) => {
  // Main monitoring loop
  await new Promise(async (resolve) => {
    const runCheck = async () => {
      // Check URLs
      // Send callback
      // Update stats
    };

    // Initial check
    await runCheck();

    // Set interval
    backgroundTaskInterval = setInterval(runCheck, intervalMs);
  });
};
```

#### 2. Start Service
```javascript
const startBackgroundService = async () => {
  // Validate prerequisites
  // Request permissions
  // Start BackgroundJob
  await BackgroundJob.start(backgroundTask, options);
};
```

#### 3. Stop Service
```javascript
const stopBackgroundService = async () => {
  backgroundTaskRunning = false;
  await BackgroundJob.stop();
};
```

## 🎯 Best Practices

### 1. Error Handling
- Always wrap fetch in try-catch
- Use AbortController for timeouts
- Log errors for debugging

### 2. State Management
- Use AsyncStorage for persistence
- Update stats after each check
- Save service state for recovery

### 3. User Experience
- Show clear service status
- Provide battery optimization tips
- Allow manual check trigger

## 🚨 Known Issues

### Android Issues
1. **Xiaomi/MIUI**: Aggressive battery optimization
   - Solution: Manual whitelist in settings

2. **Samsung**: Smart Manager may kill service
   - Solution: Exclude from Device care

3. **Huawei/EMUI**: Protected apps setting required
   - Solution: Add to protected apps list

### Device-Specific Settings

| Brand | Setting Path | Action Required |
|-------|-------------|-----------------|
| **Xiaomi** | Settings > Battery & performance > App battery saver | Select "No restrictions" |
| **Samsung** | Settings > Device care > Battery | Add to "Apps that won't be put to sleep" |
| **Huawei** | Settings > Battery > App launch | Manual management - enable all |
| **OnePlus** | Settings > Battery > Battery optimization | Don't optimize |
| **OPPO** | Settings > Battery > Energy saver | Turn off for app |

## 📱 iOS Alternative (Future Implementation)

Since `react-native-background-actions` doesn't support iOS, use:

### Option 1: Background Fetch
```javascript
import BackgroundFetch from 'react-native-background-fetch';

BackgroundFetch.configure({
  minimumFetchInterval: 15, // minutes
  stopOnTerminate: false,
  enableHeadless: true
}, async (taskId) => {
  // Perform background check
  BackgroundFetch.finish(taskId);
});
```

### Option 2: Silent Push Notifications
- Server triggers checks via silent push
- More reliable but requires server infrastructure

## 📊 Monitoring & Analytics

### Key Metrics to Track
1. **Service Uptime**: Total time service running
2. **Check Success Rate**: Successful vs failed checks
3. **Callback Success Rate**: Successful vs failed callbacks
4. **Battery Impact**: Monitor battery usage
5. **Network Usage**: Data consumed per check

### Logging System
```javascript
// Background logs stored in AsyncStorage
bgLog('message', { data });

// View logs in app
const logs = await AsyncStorage.getItem('bgLogs');
```

## 🔄 Version History

### v3.0 (Current)
- ✅ Fixed memory leaks
- ✅ Improved background task stability
- ✅ Added proper timeout handling
- ✅ Enhanced error recovery
- ✅ Better permission management

### v2.0
- Added API integration
- Batch callback support
- Service statistics

### v1.0
- Initial implementation
- Basic URL monitoring
- Simple callbacks

## 📚 Resources

- [react-native-background-actions](https://github.com/Rapsssito/react-native-background-actions)
- [Android Foreground Services](https://developer.android.com/guide/components/foreground-services)
- [Battery Optimization Guide](https://dontkillmyapp.com/)
- [React Native Background Processing](https://reactnative.dev/docs/headless-js-android)

## 💡 Tips for Production

1. **Use Production Build**: Debug builds may behave differently
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

2. **Monitor Crash Reports**: Use Sentry or Bugsnag

3. **Add Remote Config**: Control intervals remotely

4. **Implement Exponential Backoff**: For failed requests

5. **Add Health Checks**: Monitor service health

6. **Use Job Scheduler**: For better battery optimization on newer Android versions

## ✅ Checklist for Production Release

- [ ] Test on multiple Android versions (7.0+)
- [ ] Test on different manufacturers
- [ ] Verify battery optimization exemption
- [ ] Check notification permissions
- [ ] Test with app killed scenarios
- [ ] Monitor memory usage
- [ ] Implement crash reporting
- [ ] Add user documentation
- [ ] Test network error scenarios
- [ ] Verify callback retry logic
