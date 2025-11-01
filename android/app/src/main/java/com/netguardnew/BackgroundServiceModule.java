package com.netguardnew;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import android.telephony.TelephonyManager;
import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import org.json.JSONObject;
import org.json.JSONArray;
import org.json.JSONException;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Enhanced Background Service Module
 * Provides native Android capabilities for stable background monitoring
 */
public class BackgroundServiceModule extends ReactContextBaseJavaModule {

    private static final String TAG = "NetGuard:BackgroundServiceModule";
    private static final String PREFS_NAME = "NetGuardBackgroundService";
    private static final int REQUEST_CODE_BACKGROUND_CHECK = 1001;

    private final ReactApplicationContext reactContext;
    private final ExecutorService executorService;
    private PowerManager.WakeLock wakeLock;
    private AlarmManager alarmManager;
    private SharedPreferences preferences;

    // Network monitoring
    private ConnectivityManager connectivityManager;
    private boolean lastNetworkState = false;

    public BackgroundServiceModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.executorService = Executors.newFixedThreadPool(3);
        this.alarmManager = (AlarmManager) reactContext.getSystemService(Context.ALARM_SERVICE);
        this.preferences = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.connectivityManager = (ConnectivityManager) reactContext.getSystemService(Context.CONNECTIVITY_SERVICE);

        initializeNetworkMonitoring();
    }

    @Override
    @NonNull
    public String getName() {
        return "BackgroundServiceModule";
    }

    private void initializeNetworkMonitoring() {
        // Monitor network state changes
        executorService.execute(() -> {
            while (true) {
                try {
                    boolean currentNetworkState = isNetworkAvailable();
                    if (currentNetworkState != lastNetworkState) {
                        lastNetworkState = currentNetworkState;

                        WritableMap networkInfo = Arguments.createMap();
                        networkInfo.putBoolean("isConnected", currentNetworkState);
                        networkInfo.putString("type", getNetworkType());
                        networkInfo.putString("timestamp", String.valueOf(System.currentTimeMillis()));

                        sendNetworkChangeEvent(networkInfo);
                        Log.d(TAG, "Network state changed: " + currentNetworkState);
                    }

                    Thread.sleep(5000); // Check every 5 seconds
                } catch (InterruptedException e) {
                    Log.e(TAG, "Network monitoring thread interrupted", e);
                    break;
                } catch (Exception e) {
                    Log.e(TAG, "Error in network monitoring", e);
                    try {
                        Thread.sleep(10000); // Wait longer on error
                    } catch (InterruptedException ie) {
                        break;
                    }
                }
            }
        });
    }

    private void sendNetworkChangeEvent(WritableMap networkInfo) {
        if (reactContext.hasActiveCatalystInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("NetworkStateChanged", networkInfo);
        }
    }

    /**
     * Start enhanced background service with native capabilities
     */
    @ReactMethod
    public void startEnhancedBackgroundService(ReadableMap config, Promise promise) {
        try {
            Log.d(TAG, "Starting enhanced background service");

            // Save configuration
            saveServiceConfig(config);

            // Acquire wake lock for critical operations
            acquireWakeLock();

            // Schedule periodic checks using AlarmManager for reliability
            schedulePeriodicChecks(config);

            // Start immediate check
            performImmediateCheck(config);

            WritableMap result = Arguments.createMap();
            result.putBoolean("success", true);
            result.putString("message", "Enhanced background service started");
            result.putString("timestamp", String.valueOf(System.currentTimeMillis()));

            promise.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error starting enhanced background service", e);
            promise.reject("START_ERROR", "Failed to start enhanced background service", e);
        }
    }

    /**
     * Stop enhanced background service
     */
    @ReactMethod
    public void stopEnhancedBackgroundService(Promise promise) {
        try {
            Log.d(TAG, "Stopping enhanced background service");

            // Cancel scheduled alarms
            cancelPeriodicChecks();

            // Release wake lock
            releaseWakeLock();

            // Clear configuration
            clearServiceConfig();

            WritableMap result = Arguments.createMap();
            result.putBoolean("success", true);
            result.putString("message", "Enhanced background service stopped");
            result.putString("timestamp", String.valueOf(System.currentTimeMillis()));

            promise.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error stopping enhanced background service", e);
            promise.reject("STOP_ERROR", "Failed to stop enhanced background service", e);
        }
    }

    /**
     * Perform URL checks natively with better network handling
     */
    @ReactMethod
    public void performNativeURLCheck(ReadableMap config, Promise promise) {
        executorService.execute(() -> {
            try {
                Log.d(TAG, "Performing native URL check");

                if (!isNetworkAvailable()) {
                    WritableMap errorResult = Arguments.createMap();
                    errorResult.putBoolean("success", false);
                    errorResult.putString("error", "No network connection available");
                    promise.resolve(errorResult);
                    return;
                }

                JSONArray urlsArray = new JSONArray(config.getString("urls"));
                List<URLCheckResult> results = new ArrayList<>();

                for (int i = 0; i < urlsArray.length(); i++) {
                    String url = urlsArray.getString(i);
                    URLCheckResult result = checkSingleURL(url, config);
                    results.add(result);

                    // Add delay between requests
                    if (i < urlsArray.length() - 1) {
                        Thread.sleep(2000 + (int)(Math.random() * 3000));
                    }
                }

                // Send callback if configured
                if (config.hasKey("callbackUrl") && !config.isNull("callbackUrl")) {
                    sendNativeCallback(results, config);
                }

                // Prepare response
                WritableMap result = Arguments.createMap();
                result.putBoolean("success", true);
                result.putInt("totalChecked", results.size());
                result.putInt("activeCount", (int) results.stream().filter(r -> r.isActive).count());
                result.putInt("inactiveCount", (int) results.stream().filter(r -> !r.isActive).count());
                result.putString("timestamp", String.valueOf(System.currentTimeMillis()));

                promise.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Error performing native URL check", e);
                WritableMap errorResult = Arguments.createMap();
                errorResult.putBoolean("success", false);
                errorResult.putString("error", e.getMessage());
                promise.resolve(errorResult);
            }
        });
    }

    /**
     * Get detailed network information
     */
    @ReactMethod
    public void getNetworkInfo(Promise promise) {
        try {
            WritableMap networkInfo = Arguments.createMap();
            
            // Get network type and status
            String networkType = getNetworkTypeFormatted();
            String carrier = getNetworkCarrier();
            boolean isConnected = isNetworkAvailable();
            
            // Check WiFi state
            boolean isWifiEnabled = isWifiEnabled();
            
            // Check mobile data state
            boolean isMobileEnabled = isMobileDataEnabled();
            
            // Get display name
            String displayName = getNetworkDisplayName(networkType, carrier);

            networkInfo.putString("type", networkType);
            networkInfo.putString("carrier", carrier);
            networkInfo.putBoolean("isConnected", isConnected);
            networkInfo.putBoolean("isWifiEnabled", isWifiEnabled);
            networkInfo.putBoolean("isMobileEnabled", isMobileEnabled);
            networkInfo.putString("displayName", displayName);

            promise.resolve(networkInfo);
        } catch (Exception e) {
            Log.e(TAG, "Error getting network info", e);
            promise.reject("NETWORK_ERROR", "Failed to get network info", e);
        }
    }

    private String getNetworkDisplayName(String networkType, String carrier) {
        if ("wifi".equals(networkType)) {
            return "WiFi Connection";
        } else if ("cellular".equals(networkType)) {
            return carrier + " (Mobile)";
        } else if ("ethernet".equals(networkType)) {
            return "Ethernet Connection";
        } else {
            return networkType + " Connection";
        }
    }

    /**
     * Get background service status
     */
    @ReactMethod
    public void getServiceStatus(Promise promise) {
        try {
            WritableMap status = Arguments.createMap();
            status.putBoolean("isConfigured", hasServiceConfig());
            status.putBoolean("hasWakeLock", wakeLock != null && wakeLock.isHeld());
            status.putBoolean("alarmsScheduled", areAlarmsScheduled());
            status.putString("lastCheckTime", getLastCheckTime());
            status.putInt("totalChecks", getTotalChecks());
            status.putInt("successfulChecks", getSuccessfulChecks());
            status.putInt("failedChecks", getFailedChecks());

            promise.resolve(status);
        } catch (Exception e) {
            Log.e(TAG, "Error getting service status", e);
            promise.reject("STATUS_ERROR", "Failed to get service status", e);
        }
    }

    // Private helper methods

    private void saveServiceConfig(ReadableMap config) {
        try {
            JSONObject configJson = new JSONObject();
            configJson.put("urls", config.getString("urls"));
            configJson.put("intervalMinutes", config.getInt("intervalMinutes"));
            configJson.put("timeoutMs", config.getInt("timeoutMs"));
            configJson.put("retryAttempts", config.getInt("retryAttempts"));

            if (config.hasKey("callbackUrl") && !config.isNull("callbackUrl")) {
                configJson.put("callbackUrl", config.getString("callbackUrl"));
            }
            if (config.hasKey("callbackName") && !config.isNull("callbackName")) {
                configJson.put("callbackName", config.getString("callbackName"));
            }

            preferences.edit()
                .putString("service_config", configJson.toString())
                .putLong("config_saved_time", System.currentTimeMillis())
                .apply();

        } catch (JSONException e) {
            Log.e(TAG, "Error saving service config", e);
        }
    }

    private void clearServiceConfig() {
        preferences.edit()
            .remove("service_config")
            .remove("config_saved_time")
            .apply();
    }

    private boolean hasServiceConfig() {
        return preferences.contains("service_config");
    }

    private void acquireWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) reactContext.getSystemService(Context.POWER_SERVICE);
            if (powerManager != null && (wakeLock == null || !wakeLock.isHeld())) {
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "NetGuard:BackgroundServiceWakeLock"
                );
                wakeLock.acquire(60 * 60 * 1000L); // 1 hour timeout
                Log.d(TAG, "Wake lock acquired");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error acquiring wake lock", e);
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
                Log.d(TAG, "Wake lock released");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error releasing wake lock", e);
        }
    }

    private void schedulePeriodicChecks(ReadableMap config) {
        try {
            int intervalMinutes = config.getInt("intervalMinutes");
            long intervalMs = intervalMinutes * 60 * 1000L;

            Intent intent = new Intent(reactContext, BackgroundCheckReceiver.class);
            intent.putExtra("config", config.getString("urls"));

            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                reactContext,
                REQUEST_CODE_BACKGROUND_CHECK,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            long triggerTime = System.currentTimeMillis() + intervalMs;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    triggerTime,
                    pendingIntent
                );
            } else {
                alarmManager.setRepeating(
                    AlarmManager.RTC_WAKEUP,
                    triggerTime,
                    intervalMs,
                    pendingIntent
                );
            }

            Log.d(TAG, "Periodic checks scheduled with interval: " + intervalMinutes + " minutes");

        } catch (Exception e) {
            Log.e(TAG, "Error scheduling periodic checks", e);
        }
    }

    private void cancelPeriodicChecks() {
        try {
            Intent intent = new Intent(reactContext, BackgroundCheckReceiver.class);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                reactContext,
                REQUEST_CODE_BACKGROUND_CHECK,
                intent,
                PendingIntent.FLAG_NO_CREATE | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            if (pendingIntent != null) {
                alarmManager.cancel(pendingIntent);
                Log.d(TAG, "Periodic checks cancelled");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error cancelling periodic checks", e);
        }
    }

    private boolean areAlarmsScheduled() {
        Intent intent = new Intent(reactContext, BackgroundCheckReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            reactContext,
            REQUEST_CODE_BACKGROUND_CHECK,
            intent,
            PendingIntent.FLAG_NO_CREATE | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        return pendingIntent != null;
    }

    private void performImmediateCheck(ReadableMap config) {
        executorService.execute(() -> {
            try {
                // Perform immediate check in background
                performNativeURLCheck(config, new Promise() {
                    @Override
                    public void resolve(Object value) {
                        Log.d(TAG, "Immediate check completed successfully");
                    }

                    @Override
                    public void reject(String code, String message) {
                        Log.e(TAG, "Immediate check failed: " + message);
                    }

                    @Override
                    public void reject(String code, String message, Throwable e) {
                        Log.e(TAG, "Immediate check failed: " + message, e);
                    }

                    @Override
                    public void reject(String code, Throwable e) {
                        Log.e(TAG, "Immediate check failed", e);
                    }

                    @Override
                    public void reject(String message) {
                        Log.e(TAG, "Immediate check failed: " + message);
                    }

                    @Override
                    public void reject(String code, String message, Throwable e, WritableMap userInfo) {
                        Log.e(TAG, "Immediate check failed: " + message, e);
                    }

                    @Override
                    public void reject(String code, String message, WritableMap userInfo) {
                        Log.e(TAG, "Immediate check failed: " + message);
                    }

                    @Override
                    public void reject(String code, Throwable e, WritableMap userInfo) {
                        Log.e(TAG, "Immediate check failed", e);
                    }

                    @Override
                    public void reject(String message, WritableMap userInfo) {
                        Log.e(TAG, "Immediate check failed: " + message);
                    }

                    @Override
                    public void reject(Throwable e, WritableMap userInfo) {
                        Log.e(TAG, "Immediate check failed", e);
                    }

                    @Override
                    public void reject(Throwable e) {
                        Log.e(TAG, "Immediate check failed", e);
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "Error in immediate check", e);
            }
        });
    }

    private URLCheckResult checkSingleURL(String urlString, ReadableMap config) {
        long startTime = System.currentTimeMillis();
        int timeoutMs = config.hasKey("timeoutMs") ? config.getInt("timeoutMs") : 30000;
        int retryAttempts = config.hasKey("retryAttempts") ? config.getInt("retryAttempts") : 3;

        for (int attempt = 0; attempt < retryAttempts; attempt++) {
            try {
                URL url = new URL(urlString);
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();

                connection.setRequestMethod("GET");
                connection.setConnectTimeout(timeoutMs);
                connection.setReadTimeout(timeoutMs);
                connection.setRequestProperty("User-Agent", "NetGuard-Native-Android/2.0");
                connection.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                connection.setRequestProperty("Cache-Control", "no-cache");

                int responseCode = connection.getResponseCode();
                long responseTime = System.currentTimeMillis() - startTime;

                boolean isActive = (responseCode >= 200 && responseCode < 300) ||
                                 (responseCode >= 300 && responseCode < 400) ||
                                 responseCode == 401 || responseCode == 403 || responseCode == 429;

                connection.disconnect();

                // Update statistics
                updateCheckStatistics(true);

                return new URLCheckResult(urlString, isActive, responseTime, responseCode, null);

            } catch (Exception e) {
                Log.w(TAG, "URL check attempt " + (attempt + 1) + " failed for " + urlString + ": " + e.getMessage());

                if (attempt == retryAttempts - 1) {
                    long responseTime = System.currentTimeMillis() - startTime;
                    updateCheckStatistics(false);
                    return new URLCheckResult(urlString, false, responseTime, -1, e.getMessage());
                }

                // Wait before retry
                try {
                    Thread.sleep(Math.min(1000 * (attempt + 1), 5000));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        // Fallback
        long responseTime = System.currentTimeMillis() - startTime;
        updateCheckStatistics(false);
        return new URLCheckResult(urlString, false, responseTime, -1, "Maximum retries exceeded");
    }

    private void sendNativeCallback(List<URLCheckResult> results, ReadableMap config) {
        try {
            String callbackUrl = config.getString("callbackUrl");
            if (callbackUrl == null || callbackUrl.isEmpty()) {
                return;
            }

            JSONObject payload = new JSONObject();
            payload.put("checkType", "native_background");
            payload.put("timestamp", System.currentTimeMillis());
            payload.put("isBackground", true);
            payload.put("platform", "android");

            // Summary
            JSONObject summary = new JSONObject();
            long activeCount = results.stream().filter(r -> r.isActive).count();
            long inactiveCount = results.stream().filter(r -> !r.isActive).count();
            summary.put("total", results.size());
            summary.put("active", activeCount);
            summary.put("inactive", inactiveCount);
            payload.put("summary", summary);

            // URLs
            JSONArray urlsArray = new JSONArray();
            for (URLCheckResult result : results) {
                JSONObject urlObj = new JSONObject();
                urlObj.put("url", result.url);
                urlObj.put("status", result.isActive ? "active" : "inactive");
                urlObj.put("responseTime", result.responseTime);
                urlObj.put("statusCode", result.statusCode);
                if (result.error != null) {
                    urlObj.put("error", result.error);
                }
                urlsArray.put(urlObj);
            }
            payload.put("urls", urlsArray);

            // Device info
            JSONObject device = new JSONObject();
            device.put("platform", "android");
            device.put("version", Build.VERSION.RELEASE);
            device.put("model", Build.MODEL);
            device.put("brand", Build.BRAND);
            payload.put("device", device);

            // Network info
            JSONObject network = new JSONObject();
            network.put("type", getNetworkType());
            network.put("carrier", getNetworkOperator());
            network.put("isConnected", isNetworkAvailable());
            payload.put("network", network);

            if (config.hasKey("callbackName")) {
                payload.put("callbackName", config.getString("callbackName"));
            }

            // Send callback
            URL url = new URL(callbackUrl);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("User-Agent", "NetGuard-Native-Callback/2.0");
            connection.setDoOutput(true);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);

            OutputStream os = connection.getOutputStream();
            os.write(payload.toString().getBytes("UTF-8"));
            os.close();

            int responseCode = connection.getResponseCode();

            if (responseCode >= 200 && responseCode < 300) {
                Log.d(TAG, "Callback sent successfully: " + responseCode);
                updateCallbackStatistics(true);
            } else {
                Log.w(TAG, "Callback failed with status: " + responseCode);
                updateCallbackStatistics(false);
            }

            connection.disconnect();

        } catch (Exception e) {
            Log.e(TAG, "Error sending native callback", e);
            updateCallbackStatistics(false);
        }
    }

    // Network utility methods
    private boolean isNetworkAvailable() {
        try {
            ConnectivityManager cm = (ConnectivityManager) reactContext.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
                return activeNetwork != null && activeNetwork.isConnected();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error checking network availability", e);
        }
        return false;
    }

    private String getNetworkType() {
        try {
            NetworkInfo activeNetworkInfo = connectivityManager.getActiveNetworkInfo();
            if (activeNetworkInfo == null) return "none";

            int type = activeNetworkInfo.getType();
            switch (type) {
                case ConnectivityManager.TYPE_WIFI:
                    return "wifi";
                case ConnectivityManager.TYPE_MOBILE:
                    return "mobile";
                case ConnectivityManager.TYPE_ETHERNET:
                    return "ethernet";
                default:
                    return "unknown";
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting network type", e);
            return "error";
        }
    }

    private String getNetworkOperator() {
        try {
            NetworkInfo activeNetworkInfo = connectivityManager.getActiveNetworkInfo();
            if (activeNetworkInfo == null || activeNetworkInfo.getType() != ConnectivityManager.TYPE_MOBILE) {
                return "unknown";
            }

            android.telephony.TelephonyManager telephonyManager =
                (android.telephony.TelephonyManager) reactContext.getSystemService(Context.TELEPHONY_SERVICE);

            if (telephonyManager != null) {
                String operatorName = telephonyManager.getNetworkOperatorName();
                return operatorName != null && !operatorName.isEmpty() ? operatorName : "unknown";
            }

            return "unknown";
        } catch (Exception e) {
            Log.e(TAG, "Error getting network operator", e);
            return "error";
        }
    }

    private boolean isWifiEnabled() {
        try {
            ConnectivityManager cm = (ConnectivityManager) reactContext.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                NetworkInfo wifi = cm.getNetworkInfo(ConnectivityManager.TYPE_WIFI);
                return wifi != null && wifi.isAvailable();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error checking WiFi state", e);
        }
        return false;
    }

    private boolean isMobileDataEnabled() {
        try {
            ConnectivityManager cm = (ConnectivityManager) reactContext.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                NetworkInfo mobile = cm.getNetworkInfo(ConnectivityManager.TYPE_MOBILE);
                return mobile != null && mobile.isAvailable();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error checking mobile data state", e);
        }
        return false;
    }

    // Statistics methods

    private void updateCheckStatistics(boolean success) {
        int totalChecks = preferences.getInt("total_checks", 0) + 1;
        preferences.edit()
            .putInt("total_checks", totalChecks)
            .putLong("last_check_time", System.currentTimeMillis())
            .apply();

        if (success) {
            int successfulChecks = preferences.getInt("successful_checks", 0) + 1;
            preferences.edit().putInt("successful_checks", successfulChecks).apply();
        } else {
            int failedChecks = preferences.getInt("failed_checks", 0) + 1;
            preferences.edit().putInt("failed_checks", failedChecks).apply();
        }
    }

    private void updateCallbackStatistics(boolean success) {
        if (success) {
            int successfulCallbacks = preferences.getInt("successful_callbacks", 0) + 1;
            preferences.edit().putInt("successful_callbacks", successfulCallbacks).apply();
        } else {
            int failedCallbacks = preferences.getInt("failed_callbacks", 0) + 1;
            preferences.edit().putInt("failed_callbacks", failedCallbacks).apply();
        }
    }

    private String getLastCheckTime() {
        long lastCheckTime = preferences.getLong("last_check_time", 0);
        return lastCheckTime > 0 ? String.valueOf(lastCheckTime) : "never";
    }

    private int getTotalChecks() {
        return preferences.getInt("total_checks", 0);
    }

    private int getSuccessfulChecks() {
        return preferences.getInt("successful_checks", 0);
    }

    private int getFailedChecks() {
        return preferences.getInt("failed_checks", 0);
    }

    // Helper classes

    private static class URLCheckResult {
        final String url;
        final boolean isActive;
        final long responseTime;
        final int statusCode;
        final String error;

        URLCheckResult(String url, boolean isActive, long responseTime, int statusCode, String error) {
            this.url = url;
            this.isActive = isActive;
            this.responseTime = responseTime;
            this.statusCode = statusCode;
            this.error = error;
        }
    }

    private void startHeadlessJsTask(Context context, List<URLCheckResult> results, String serviceConfigJson) {
        try {
            Intent serviceIntent = new Intent(context, BackgroundCheckService.class);
            WritableMap resultData = Arguments.createMap();
            
            // เพิ่ม source เพื่อระบุว่ามาจาก native service
            resultData.putString("source", "native");
            resultData.putString("timestamp", String.valueOf(System.currentTimeMillis()));
            resultData.putString("serviceConfig", serviceConfigJson);
            
            serviceIntent.putExtra("resultData", Arguments.toBundle(resultData));
            
            // ...existing code...
        } catch (Exception e) {
            Log.e(TAG, "Error starting HeadlessJS task", e);
        }
    }

    // เพิ่มใน BackgroundServiceModule.java
    private String getNetworkTypeFormatted() {
        try {
            ConnectivityManager cm = (ConnectivityManager) reactContext.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
                if (activeNetwork != null) {
                    switch (activeNetwork.getType()) {
                        case ConnectivityManager.TYPE_WIFI:
                            return "wifi";
                        case ConnectivityManager.TYPE_MOBILE:
                            return "cellular";
                        case ConnectivityManager.TYPE_ETHERNET:
                            return "ethernet";
                        default:
                            return "unknown";
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting network type", e);
        }
        return "none";
    }

    private String getNetworkCarrier() {
        try {
            TelephonyManager tm = (TelephonyManager) reactContext.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm != null) {
                String operatorName = tm.getNetworkOperatorName();
                if (operatorName != null && !operatorName.isEmpty()) {
                    return operatorName;
                }
                
                // Fallback to numeric operator
                String operator = tm.getNetworkOperator();
                if (operator != null && !operator.isEmpty()) {
                    return "Carrier " + operator;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting carrier info", e);
        }
        return "Unknown Carrier";
    }
    
}
