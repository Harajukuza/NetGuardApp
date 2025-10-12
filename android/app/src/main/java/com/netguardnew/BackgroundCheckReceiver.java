package com.netguardnew;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import android.telephony.TelephonyManager;
import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Broadcast Receiver for handling scheduled background URL checks
 * Triggered by AlarmManager for reliable background execution
 */
public class BackgroundCheckReceiver extends BroadcastReceiver {

    private static final String TAG = "NetGuard:BackgroundCheckReceiver";
    private static final String PREFS_NAME = "NetGuardBackgroundService";

    private static final String[] USER_AGENTS = {
        "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "NetGuard-Background-Receiver/2.0 (Android; AlarmManager-Triggered)"
    };

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "Background check alarm received");

        try {
            // Acquire wake lock for this operation
            PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "NetGuard:BackgroundCheckWakeLock"
            );
            wakeLock.acquire(10 * 60 * 1000L); // 10 minutes timeout

            // Check if network is available
            if (!isNetworkAvailable(context)) {
                Log.w(TAG, "No network available, skipping background check");
                rescheduleCheck(context);
                wakeLock.release();
                return;
            }

            // Load service configuration
            SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String configJson = preferences.getString("service_config", null);

            if (configJson == null) {
                Log.w(TAG, "No service configuration found");
                wakeLock.release();
                return;
            }

            // Parse configuration and perform checks
            performBackgroundCheck(context, configJson, wakeLock);

            // Reschedule next check if using AlarmManager on Android 6+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                rescheduleCheck(context);
            }

        } catch (Exception e) {
            Log.e(TAG, "Error in background check receiver", e);
        }
    }

    private void performBackgroundCheck(Context context, String configJson, PowerManager.WakeLock wakeLock) {
        ExecutorService executorService = Executors.newSingleThreadExecutor();

        executorService.execute(() -> {
            try {
                Log.d(TAG, "Starting background URL checks");

                JSONObject config = new JSONObject(configJson);
                JSONArray urlsArray = new JSONArray(config.getString("urls"));

                List<URLCheckResult> results = new ArrayList<>();

                // Perform URL checks
                for (int i = 0; i < urlsArray.length(); i++) {
                    String url = urlsArray.getString(i);
                    URLCheckResult result = checkSingleURL(url, config);
                    results.add(result);

                    Log.d(TAG, "Checked URL: " + url + " - Status: " + (result.isActive ? "active" : "inactive"));

                    // Add delay between requests to avoid rate limiting
                    if (i < urlsArray.length() - 1) {
                        try {
                            Thread.sleep(2000 + (int)(Math.random() * 3000)); // 2-5 second delay
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                            break;
                        }
                    }
                }

                // Update statistics
                updateStatistics(context, results);

                // Send callback if configured
                if (config.has("callbackUrl") && !config.isNull("callbackUrl")) {
                    sendBackgroundCallback(context, results, config);
                }

                // Save last check time
                SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                preferences.edit()
                    .putLong("last_background_check", System.currentTimeMillis())
                    .apply();

                Log.d(TAG, "Background check completed successfully. Checked " + results.size() + " URLs");

                // Start HeadlessJsTask to update React Native state
                startHeadlessJsTask(context, results);

            } catch (Exception e) {
                Log.e(TAG, "Error performing background check", e);
            } finally {
                // Release wake lock
                if (wakeLock.isHeld()) {
                    wakeLock.release();
                }
                executorService.shutdown();
            }
        });
    }

    private URLCheckResult checkSingleURL(String urlString, JSONObject config) {
        long startTime = System.currentTimeMillis();
        int timeoutMs = config.optInt("timeoutMs", 30000);
        int retryAttempts = config.optInt("retryAttempts", 2);

        for (int attempt = 0; attempt < retryAttempts; attempt++) {
            try {
                URL url = new URL(urlString);
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();

                // Configure connection
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(timeoutMs);
                connection.setReadTimeout(timeoutMs);

                // Use random user agent
                String userAgent = USER_AGENTS[(int)(Math.random() * USER_AGENTS.length)];
                connection.setRequestProperty("User-Agent", userAgent);
                connection.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                connection.setRequestProperty("Accept-Language", "en-US,en;q=0.5");
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.setRequestProperty("Pragma", "no-cache");

                // Make request
                int responseCode = connection.getResponseCode();
                long responseTime = System.currentTimeMillis() - startTime;

                // Determine if URL is active based on response code
                boolean isActive = (responseCode >= 200 && responseCode < 300) || // Success
                                 (responseCode >= 300 && responseCode < 400) || // Redirect
                                 responseCode == 401 || // Unauthorized (but responding)
                                 responseCode == 403 || // Forbidden (but responding)
                                 responseCode == 429;   // Rate limited (but responding)

                connection.disconnect();

                return new URLCheckResult(urlString, isActive, responseTime, responseCode, null);

            } catch (Exception e) {
                Log.w(TAG, "URL check attempt " + (attempt + 1) + " failed for " + urlString + ": " + e.getMessage());

                // If this is the last attempt, return error result
                if (attempt == retryAttempts - 1) {
                    long responseTime = System.currentTimeMillis() - startTime;
                    return new URLCheckResult(urlString, false, responseTime, -1, e.getMessage());
                }

                // Wait before retry with exponential backoff
                try {
                    Thread.sleep(Math.min(1000 * (long)Math.pow(2, attempt), 10000));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        // Fallback result
        long responseTime = System.currentTimeMillis() - startTime;
        return new URLCheckResult(urlString, false, responseTime, -1, "Maximum retries exceeded");
    }

    private void sendBackgroundCallback(Context context, List<URLCheckResult> results, JSONObject config) {
        try {
            String callbackUrl = config.getString("callbackUrl");
            if (callbackUrl == null || callbackUrl.isEmpty()) {
                return;
            }

            Log.d(TAG, "Sending background callback to: " + callbackUrl);

            // Build payload
            JSONObject payload = new JSONObject();
            payload.put("checkType", "alarm_manager_background");
            payload.put("timestamp", System.currentTimeMillis());
            payload.put("isBackground", true);
            payload.put("platform", "android");
            payload.put("source", "AlarmManager");

            // Summary
            JSONObject summary = new JSONObject();
            long activeCount = results.stream().filter(r -> r.isActive).count();
            long inactiveCount = results.stream().filter(r -> !r.isActive).count();
            summary.put("total", results.size());
            summary.put("active", activeCount);
            summary.put("inactive", inactiveCount);
            payload.put("summary", summary);

            // URL results
            JSONArray urlsArray = new JSONArray();
            for (URLCheckResult result : results) {
                JSONObject urlObj = new JSONObject();
                urlObj.put("url", result.url);
                urlObj.put("status", result.isActive ? "active" : "inactive");
                urlObj.put("responseTime", result.responseTime);
                urlObj.put("statusCode", result.statusCode);
                urlObj.put("timestamp", System.currentTimeMillis());
                if (result.error != null) {
                    urlObj.put("error", result.error);
                }
                urlsArray.put(urlObj);
            }
            payload.put("urls", urlsArray);

            // Device information
            JSONObject device = new JSONObject();
            device.put("platform", "android");
            device.put("version", Build.VERSION.RELEASE);
            device.put("model", Build.MODEL);
            device.put("brand", Build.BRAND);
            device.put("sdk", Build.VERSION.SDK_INT);
            payload.put("device", device);

            // Network information
            JSONObject network = new JSONObject();
            network.put("type", getNetworkTypeFormatted(context)); // ใช้ getNetworkTypeFormatted แทน getNetworkType
            network.put("carrier", getNetworkCarrier(context)); // เพิ่มบรรทัดนี้
            network.put("isConnected", isNetworkAvailable(context));
            network.put("displayName", getNetworkDisplayName(context)); // เพิ่มบรรทัดนี้
            payload.put("network", network);

            // Add callback name if available
            if (config.has("callbackName")) {
                payload.put("callbackName", config.getString("callbackName"));
            }

            // Send HTTP request
            URL url = new URL(callbackUrl);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            connection.setRequestProperty("User-Agent", "NetGuard-AlarmManager-Callback/2.0");
            connection.setRequestProperty("Accept", "application/json");
            connection.setDoOutput(true);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);

            // Write payload
            OutputStream os = connection.getOutputStream();
            os.write(payload.toString().getBytes("UTF-8"));
            os.flush();
            os.close();

            // Check response
            int responseCode = connection.getResponseCode();
            if (responseCode >= 200 && responseCode < 300) {
                Log.d(TAG, "Background callback sent successfully: " + responseCode);
                updateCallbackStatistics(context, true);
            } else {
                Log.w(TAG, "Background callback failed with status: " + responseCode);
                updateCallbackStatistics(context, false);
            }

            connection.disconnect();

        } catch (Exception e) {
            Log.e(TAG, "Error sending background callback", e);
            updateCallbackStatistics(context, false);
        }
    }

    private void startHeadlessJsTask(Context context, List<URLCheckResult> results) {
        try {
            Intent serviceIntent = new Intent(context, BackgroundCheckService.class);

            // Convert results to bundle data
            WritableMap resultData = Arguments.createMap();
            resultData.putString("source", "AlarmManager");
            resultData.putString("timestamp", String.valueOf(System.currentTimeMillis()));
            resultData.putInt("totalChecked", results.size());

            long activeCount = results.stream().filter(r -> r.isActive).count();
            long inactiveCount = results.stream().filter(r -> !r.isActive).count();

            resultData.putInt("activeCount", (int)activeCount);
            resultData.putInt("inactiveCount", (int)inactiveCount);

            serviceIntent.putExtra("resultData", Arguments.toBundle(resultData));
            context.startService(serviceIntent);

            Log.d(TAG, "HeadlessJsTask started to update React Native state");

        } catch (Exception e) {
            Log.e(TAG, "Error starting HeadlessJsTask", e);
        }
    }

    private void rescheduleCheck(Context context) {
        try {
            SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String configJson = preferences.getString("service_config", null);

            if (configJson != null) {
                JSONObject config = new JSONObject(configJson);
                int intervalMinutes = config.optInt("intervalMinutes", 60);

                // Use BackgroundServiceModule to reschedule
                Intent intent = new Intent(context, BackgroundCheckReceiver.class);
                android.app.PendingIntent pendingIntent = android.app.PendingIntent.getBroadcast(
                    context,
                    1001,
                    intent,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT |
                    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? android.app.PendingIntent.FLAG_IMMUTABLE : 0)
                );

                android.app.AlarmManager alarmManager =
                    (android.app.AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

                long nextTriggerTime = System.currentTimeMillis() + (intervalMinutes * 60 * 1000L);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(
                        android.app.AlarmManager.RTC_WAKEUP,
                        nextTriggerTime,
                        pendingIntent
                    );
                } else {
                    alarmManager.setExact(
                        android.app.AlarmManager.RTC_WAKEUP,
                        nextTriggerTime,
                        pendingIntent
                    );
                }

                Log.d(TAG, "Next background check scheduled in " + intervalMinutes + " minutes");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error rescheduling background check", e);
        }
    }

    private void updateStatistics(Context context, List<URLCheckResult> results) {
        try {
            SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            int totalChecks = preferences.getInt("total_background_checks", 0) + 1;
            long activeCount = results.stream().filter(r -> r.isActive).count();
            long inactiveCount = results.stream().filter(r -> !r.isActive).count();

            int totalActive = preferences.getInt("total_active_results", 0) + (int)activeCount;
            int totalInactive = preferences.getInt("total_inactive_results", 0) + (int)inactiveCount;

            preferences.edit()
                .putInt("total_background_checks", totalChecks)
                .putInt("total_active_results", totalActive)
                .putInt("total_inactive_results", totalInactive)
                .putLong("last_background_check", System.currentTimeMillis())
                .apply();

            Log.d(TAG, "Statistics updated - Total checks: " + totalChecks +
                      ", Active: " + activeCount + ", Inactive: " + inactiveCount);

        } catch (Exception e) {
            Log.e(TAG, "Error updating statistics", e);
        }
    }

    private void updateCallbackStatistics(Context context, boolean success) {
        try {
            SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            if (success) {
                int successCount = preferences.getInt("successful_callbacks", 0) + 1;
                preferences.edit()
                    .putInt("successful_callbacks", successCount)
                    .putLong("last_successful_callback", System.currentTimeMillis())
                    .apply();
            } else {
                int failedCount = preferences.getInt("failed_callbacks", 0) + 1;
                preferences.edit()
                    .putInt("failed_callbacks", failedCount)
                    .putLong("last_failed_callback", System.currentTimeMillis())
                    .apply();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error updating callback statistics", e);
        }
    }

    private boolean isNetworkAvailable(Context context) {
        try {
            ConnectivityManager connectivityManager =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo activeNetworkInfo = connectivityManager.getActiveNetworkInfo();
            return activeNetworkInfo != null && activeNetworkInfo.isConnected();
        } catch (Exception e) {
            Log.e(TAG, "Error checking network availability", e);
            return false;
        }
    }

    private String getNetworkType(Context context) {
        try {
            ConnectivityManager connectivityManager =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
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

    //เช็คเครือข่ายซิม
    private String getNetworkCarrier(Context context) {
        try {
            ConnectivityManager connectivityManager =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo activeNetworkInfo = connectivityManager.getActiveNetworkInfo();

            if (activeNetworkInfo == null) {
                return "Unknown";
            }

            // ถ้าเป็น WiFi
            if (activeNetworkInfo.getType() == ConnectivityManager.TYPE_WIFI) {
                return "WiFi";
            }

            // ถ้าเป็น Mobile/Cellular
            if (activeNetworkInfo.getType() == ConnectivityManager.TYPE_MOBILE) {
                TelephonyManager telephonyManager = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
                if (telephonyManager != null) {
                    String operatorName = telephonyManager.getNetworkOperatorName();
                    if (operatorName != null && !operatorName.isEmpty()) {
                        return operatorName;
                    }

                    // Fallback to SIM operator
                    String simOperatorName = telephonyManager.getSimOperatorName();
                    if (simOperatorName != null && !simOperatorName.isEmpty()) {
                        return simOperatorName;
                    }
                }
                return "Mobile";
            }

            return "Unknown";
        } catch (SecurityException e) {
            Log.w(TAG, "Permission denied for reading phone state", e);
            return "Unknown";
        } catch (Exception e) {
            Log.e(TAG, "Error getting network carrier", e);
            return "Unknown";
        }
    }

    private String getNetworkTypeFormatted(Context context) {
        try {
            ConnectivityManager connectivityManager =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo activeNetworkInfo = connectivityManager.getActiveNetworkInfo();

            if (activeNetworkInfo == null) return "none";

            int type = activeNetworkInfo.getType();
            switch (type) {
                case ConnectivityManager.TYPE_WIFI:
                    return "wifi";
                case ConnectivityManager.TYPE_MOBILE:
                    return "cellular"; // เปลี่ยนจาก "mobile" เป็น "cellular" ให้ตรงกับเดิม
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

    private String getNetworkDisplayName(Context context) {
        try {
            String networkType = getNetworkTypeFormatted(context);
            String carrier = getNetworkCarrier(context);

            if ("wifi".equals(networkType)) {
                return "WiFi";
            } else if ("cellular".equals(networkType)) {
                return carrier + " (cellular)";
            } else {
                return networkType;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting network display name", e);
            return "Unknown";
        }
    }

    // Helper class for URL check results
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
}
