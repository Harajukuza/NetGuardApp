# NetGuard Pro - คู่มือการติดตั้งและแก้ไขปัญหา

## 📋 ข้อกำหนดระบบ
- Node.js >= 20
- React Native CLI
- Android Studio (สำหรับ Android)
- Xcode (สำหรับ iOS)

## 🚀 การติดตั้งเบื้องต้น

### 1. ติดตั้ง Dependencies
```bash
# ติดตั้ง package ทั้งหมด
npm install

# หรือใช้ yarn
yarn install
```

### 2. ติดตั้ง iOS Pods (สำหรับ iOS เท่านั้น)
```bash
cd ios
pod install
cd ..
```

## 🔧 การแก้ไขปัญหา Background Service

### ❌ ปัญหา: "Failed to start background service: TypeError: Cannot read property 'start' of null"

#### วิธีแก้ไข:

### สำหรับ Android:

1. **ตรวจสอบการติดตั้ง react-native-background-actions:**
```bash
npm list react-native-background-actions
```

2. **ถ้ายังไม่ได้ติดตั้ง หรือติดตั้งไม่สมบูรณ์:**
```bash
npm uninstall react-native-background-actions
npm install react-native-background-actions@^4.0.1
```

3. **Clean และ Rebuild Project:**
```bash
cd android
./gradlew clean
cd ..
npx react-native run-android
```

4. **เพิ่ม Permissions ใน AndroidManifest.xml:**
ตรวจสอบว่ามี permissions ต่อไปนี้ใน `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

5. **เพิ่ม Service Declaration:**
ใน AndroidManifest.xml เพิ่ม:
```xml
<service 
    android:name="com.asterinet.react.bgactions.RNBackgroundActionsTask"
    android:foregroundServiceType="dataSync" />
```

### สำหรับ iOS:

1. **ติดตั้ง Pods ใหม่:**
```bash
cd ios
pod deintegrate
pod install
cd ..
```

2. **เพิ่ม Background Modes:**
- เปิด Xcode
- เลือก project ของคุณ
- ไปที่ Signing & Capabilities
- เพิ่ม "Background Modes"
- เลือก:
  - ✅ Background fetch
  - ✅ Background processing
  - ✅ Remote notifications

3. **เพิ่มใน Info.plist:**
```xml
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>processing</string>
    <string>remote-notification</string>
</array>
```

## 🔄 การใช้งาน Fallback Mode

แอปพลิเคชันมี **BackgroundServiceManager** ที่จะทำงานใน 2 โหมด:

### 1. Native Mode (เต็มประสิทธิภาพ)
- ใช้เมื่อ react-native-background-actions ติดตั้งสมบูรณ์
- ทำงานได้แม้ปิดแอป
- แสดง notification ตลอดเวลา

### 2. Fallback Mode (จำกัด)
- ใช้เมื่อไม่สามารถใช้ native background service
- Android: ทำงานได้ในพื้นหลังแต่อาจถูกระบบหยุด
- iOS: ทำงานเฉพาะเมื่อแอปเปิดอยู่

## 📱 การตั้งค่าเพิ่มเติมสำหรับ Background Service

### Android - ปิด Battery Optimization:
1. ไปที่ Settings > Apps > NetGuard
2. Battery > Unrestricted
3. หรือเมื่อแอปขอ permission ให้อนุญาต

### iOS - Background App Refresh:
1. Settings > General > Background App Refresh
2. เปิดสำหรับ NetGuard

## 🛠️ คำสั่งที่มีประโยชน์

### รัน Development Server:
```bash
npx react-native start --reset-cache
```

### รันแอปบน Android:
```bash
npx react-native run-android
```

### รันแอปบน iOS:
```bash
npx react-native run-ios
```

### ดู Logs Android:
```bash
adb logcat | grep -i netguard
```

### Clear Cache:
```bash
npx react-native start --reset-cache
cd android && ./gradlew clean
cd ios && pod deintegrate && pod install
```

## ✅ ตรวจสอบการติดตั้งสำเร็จ

1. **เปิดแอป** - ควรไม่มี error แสดง
2. **กดปุ่ม Background Service** - Switch ควรทำงานได้
3. **ดู Service Mode** - จะแสดงว่าใช้ Native หรือ Fallback
4. **เพิ่ม URLs และ Callback** - ทดสอบการทำงาน
5. **ดู Console Log** - ควรเห็นข้อความ:
   - ✅ "Native background service started successfully" (ถ้า Native Mode)
   - หรือ "📱 Starting fallback interval mode..." (ถ้า Fallback Mode)

## 🐛 Debug Tips

### เปิด Debug Mode:
```javascript
// ใน App.tsx
const DEBUG_MODE = true; // เปลี่ยนเป็น true เพื่อดู logs มากขึ้น
```

### ดู Background Logs:
- กดปุ่ม "LOGS" ที่มุมขวาล่าง (ในโหมด DEV)
- ดูประวัติการทำงานของ Background Service

## 📞 การแก้ไขปัญหาเพิ่มเติม

### ปัญหา: Callback ไม่ส่ง
1. ตรวจสอบ URL format ให้ถูกต้อง (https://...)
2. ตรวจสอบ Network connection
3. ดู Console logs สำหรับ error messages

### ปัญหา: URLs ไม่ update สถานะ
1. ตรวจสอบว่า URL สามารถเข้าถึงได้
2. ลอง Clear cache และ restart app
3. ตรวจสอบ timeout settings (default 10 วินาที)

### ปัญหา: แอปหยุดทำงานใน Background
1. ตรวจสอบ Battery optimization settings
2. Lock app ใน Recent apps
3. ตรวจสอบ RAM ว่าเพียงพอ

## 📝 หมายเหตุสำคัญ

- **iOS Limitations**: iOS มีข้อจำกัดในการทำงาน background มากกว่า Android
- **Battery Usage**: Background service จะใช้แบตเตอรี่ ควรตั้ง interval ที่เหมาะสม
- **Network**: ตรวจสอบให้แน่ใจว่าอุปกรณ์มีการเชื่อมต่อ internet
- **Permissions**: ต้องให้ permissions ทั้งหมดที่แอปขอ

## 🆘 ติดต่อสอบถาม

หากพบปัญหาที่ไม่สามารถแก้ไขได้:
1. ตรวจสอบ logs ทั้งหมด
2. บันทึก error messages
3. ระบุ: 
   - เวอร์ชัน OS
   - รุ่นอุปกรณ์
   - ขั้นตอนที่ทำให้เกิดปัญหา

---

**Version**: 2.0  
**Last Updated**: 2024  
**Compatible with**: React Native 0.81.4