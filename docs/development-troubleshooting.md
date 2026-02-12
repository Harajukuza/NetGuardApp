# NetGuardNew Development Troubleshooting Guide

## Common Issues and Solutions

### 1. Debugger Connection Issues

#### Error: "Failed to open debugger" or "Headers Timeout Error"
This error typically occurs when the React Native debugger cannot connect to the device.

**Solutions:**

1. **Restart Metro Bundler with cache clear:**
   ```bash
   cd NetGuardNew
   npx react-native start --reset-cache
   ```

2. **Restart ADB server:**
   ```bash
   adb kill-server
   adb start-server
   adb devices
   ```

3. **Check device connection:**
   ```bash
   # List connected devices
   adb devices
   
   # For WiFi debugging
   adb tcpip 5555
   adb connect <device-ip>:5555
   ```

4. **Clean and rebuild:**
   ```bash
   cd android
   ./gradlew clean
   cd ..
   npx react-native run-android
   ```

### 2. Build Errors

#### Android Build Failures

**Common causes and solutions:**

1. **Gradle sync issues:**
   ```bash
   cd android
   ./gradlew clean
   ./gradlew build --refresh-dependencies
   ```

2. **JDK version mismatch:**
   - Ensure JDK 11 or 17 is installed
   - Check JAVA_HOME environment variable
   ```bash
   echo $JAVA_HOME
   java -version
   ```

3. **SDK version issues:**
   - Update `android/build.gradle`:
   ```gradle
   buildToolsVersion = "33.0.0"
   minSdkVersion = 21
   compileSdkVersion = 33
   targetSdkVersion = 33
   ```

### 3. Native Module Issues

#### BackgroundServiceModule not found

**Solutions:**

1. **Rebuild native modules:**
   ```bash
   cd android
   ./gradlew clean
   npx react-native run-android
   ```

2. **Link native dependencies:**
   ```bash
   npx react-native unlink
   npx react-native link
   ```

3. **Manual registration check:**
   - Verify module is registered in `MainApplication.java`
   - Check `BackgroundServicePackage` is added to packages list

### 4. Metro Bundler Issues

#### Port 8081 already in use

**Solutions:**

1. **Find and kill process using port:**
   ```bash
   # Find process
   lsof -i :8081
   
   # Kill process
   kill -9 <PID>
   ```

2. **Use different port:**
   ```bash
   export RCT_METRO_PORT=8088
   npx react-native start --port 8088
   ```

### 5. AsyncStorage Issues

#### Data not persisting or loading

**Solutions:**

1. **Clear AsyncStorage:**
   ```javascript
   import AsyncStorage from '@react-native-async-storage/async-storage';
   
   // Clear all data
   await AsyncStorage.clear();
   
   // Or clear specific keys
   await AsyncStorage.multiRemove([
     '@Enhanced:urls',
     '@Enhanced:callback',
     '@Enhanced:checkInterval',
     '@Enhanced:syncInterval'
   ]);
   ```

2. **Debug storage operations:**
   ```javascript
   // Add logging to storage operations
   const debugStorage = async () => {
     const keys = await AsyncStorage.getAllKeys();
     console.log('All keys:', keys);
     
     const values = await AsyncStorage.multiGet(keys);
     console.log('All values:', values);
   };
   ```

### 6. Background Service Issues

#### Service not running or stopping unexpectedly

**Solutions:**

1. **Check Android permissions:**
   - Ensure app has necessary permissions in `AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
   <uses-permission android:name="android.permission.WAKE_LOCK" />
   <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
   ```

2. **Battery optimization:**
   - Disable battery optimization for the app
   - Add app to "Don't optimize" list in device settings

3. **Service logs:**
   ```javascript
   // Check service logs
   const logs = await BackgroundServiceModule.getServiceLogs();
   console.log('Service logs:', logs);
   
   // Check service status
   const status = await BackgroundServiceModule.getServiceStatus();
   console.log('Service status:', status);
   ```

### 7. Network Request Issues

#### API calls failing or timing out

**Solutions:**

1. **Check network permissions:**
   ```xml
   <!-- In AndroidManifest.xml -->
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
   ```

2. **Clear network cache:**
   ```bash
   cd android
   ./gradlew cleanBuildCache
   ```

3. **Debug network calls:**
   ```javascript
   // Add request logging
   console.log('Request URL:', endpoint);
   console.log('Request headers:', headers);
   
   // Add timeout handling
   const controller = new AbortController();
   const timeout = setTimeout(() => controller.abort(), 30000);
   
   try {
     const response = await fetch(url, {
       signal: controller.signal,
       ...options
     });
   } finally {
     clearTimeout(timeout);
   }
   ```

### 8. UI Performance Issues

#### Slow rendering or lag

**Solutions:**

1. **Enable Hermes:**
   ```gradle
   // In android/app/build.gradle
   project.ext.react = [
     enableHermes: true
   ]
   ```

2. **Optimize lists:**
   ```javascript
   // Use FlatList instead of ScrollView for long lists
   // Add getItemLayout for fixed height items
   // Use keyExtractor for unique keys
   ```

3. **Remove console.log in production:**
   ```javascript
   if (!__DEV__) {
     console.log = () => {};
   }
   ```

### 9. Development Tools

#### Recommended debugging tools:

1. **Flipper:**
   ```bash
   # Install Flipper
   brew install --cask flipper  # macOS
   
   # Or download from https://fbflipper.com/
   ```

2. **React Native Debugger:**
   ```bash
   brew install --cask react-native-debugger  # macOS
   ```

3. **Chrome DevTools:**
   - Shake device or press Cmd+D (iOS) / Cmd+M (Android)
   - Select "Debug with Chrome"

### 10. Quick Fixes Checklist

When encountering issues, try these steps in order:

1. **Restart Metro:**
   ```bash
   npx react-native start --reset-cache
   ```

2. **Clean build:**
   ```bash
   cd android && ./gradlew clean && cd ..
   ```

3. **Reset cache:**
   ```bash
   npx react-native start --reset-cache
   watchman watch-del-all
   ```

4. **Reinstall dependencies:**
   ```bash
   rm -rf node_modules
   npm install  # or yarn install
   cd ios && pod install  # iOS only
   ```

5. **Clear app data:**
   - Android: Settings > Apps > NetGuardNew > Storage > Clear Data
   - iOS: Delete and reinstall app

### 11. Environment Setup Verification

```bash
# Check React Native environment
npx react-native doctor

# Check Node version (should be 16+)
node --version

# Check Java version (should be 11 or 17)
java -version

# Check Android SDK
echo $ANDROID_HOME

# List Android emulators
emulator -list-avds

# List connected devices
adb devices
```

### 12. Logging and Debugging Tips

1. **Enable verbose logging:**
   ```bash
   npx react-native log-android
   # or
   adb logcat *:V | grep -i "netguard"
   ```

2. **Add debug points in code:**
   ```javascript
   console.log('[Component] State:', state);
   console.log('[API] Response:', response);
   console.log('[Service] Status:', status);
   ```

3. **Use React DevTools:**
   ```bash
   npm install -g react-devtools
   react-devtools
   ```

### 13. Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Module not found` | Missing dependency | Run `npm install` |
| `Unable to load script` | Metro not running | Start Metro with `npx react-native start` |
| `ECONNREFUSED` | Device can't connect to Metro | Check device IP and port |
| `Transform Error` | Babel configuration issue | Clear cache and rebuild |
| `Duplicate module` | Conflicting dependencies | Clean node_modules and reinstall |

### 14. Performance Monitoring

```javascript
// Add performance monitoring
import { PerformanceObserver } from 'perf_hooks';

const measurePerformance = (name, fn) => {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  console.log(`${name} took ${end - start}ms`);
  return result;
};

// Usage
measurePerformance('URL Check', () => checkUrls());
```

### 15. Getting Help

If issues persist:

1. Check the [React Native documentation](https://reactnative.dev/docs/troubleshooting)
2. Search for similar issues on [GitHub](https://github.com/facebook/react-native/issues)
3. Ask on [Stack Overflow](https://stackoverflow.com/questions/tagged/react-native)
4. Join the [React Native Community](https://github.com/react-native-community)

### 16. Project-Specific Issues

#### Sync Interval Not Working
- Check AsyncStorage for `@Enhanced:syncInterval` key
- Verify `saveSyncInterval` function is called
- Check periodic sync useEffect dependencies

#### URLs Not Loading from API
- Verify API endpoint is correct and accessible
- Check network permissions
- Look for CORS issues if using web API
- Verify API response format matches `APIResponse` interface

#### Background Service Crashes
- Check Android logs: `adb logcat | grep -i backgroundservice`
- Verify service configuration in native code
- Check for memory leaks in service implementation

---

**Last Updated:** 2024
**Version:** 1.0.0