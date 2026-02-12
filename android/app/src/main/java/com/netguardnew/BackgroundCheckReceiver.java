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
import java.io.BufferedReader;
import java.io.InputStreamReader;
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
    private static final long URL_SYNC_INTERVAL = 10 * 60 * 1000; // Check for URL changes every 10 minutes
    private static final String URL_SYNC_KEY = "last_url_sync";

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
                    "NetGuard:BackgroundCheckWakeLock");
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

    private void performBackgroundUrlSync(Context context, String configJson) {
        try {
            SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            long lastUrlSync = preferences.getLong(URL_SYNC_KEY, 0);
            long currentTime = System.currentTimeMillis();

            // Check if it's time to sync URLs
            if (currentTime - lastUrlSync > URL_SYNC_INTERVAL) {
                JSONObject config = new JSONObject(configJson);

                // Get API endpoint from configuration if available
                String apiEndpoint = config.optString("apiEndpoint", "");
                if (!apiEndpoint.isEmpty()) {
                    Log.d(TAG, "Performing background URL sync from: " + apiEndpoint);

                    boolean syncSuccess = syncUrlsFromApi(context, apiEndpoint);
                    if (syncSuccess) {
                        preferences.edit()
                                .putLong(URL_SYNC_KEY, currentTime)
                                .apply();
                        Log.d(TAG, "Background URL sync completed successfully");
                    }
                }
            }

        } catch (Exception e) {
            Log.e(TAG, "Error in background URL sync", e);
        }
    }

    private boolean syncUrlsFromApi(Context context, String apiEndpoint) {
        try {
            URL url = new URL(apiEndpoint);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();

            connection.setRequestMethod("GET");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("User-Agent", "NetGuard-Background-Sync/2.0");

            int responseCode = connection.getResponseCode();
            if (responseCode == HttpURLConnection.HTTP_OK) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
                StringBuilder response = new StringBuilder();
                String line;

                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();

                // Parse API response
                String responseString = response.toString();
                JSONArray newUrls;

                try {
                    // Try to parse as JSONObject first
                    JSONObject jsonResponse = new JSONObject(responseString);

                    // Handle different API response formats
                    if (jsonResponse.has("data") && jsonResponse.get("data") instanceof JSONArray) {
                        newUrls = jsonResponse.getJSONArray("data");
                    } else {
                        Log.w(TAG, "Unexpected JSONObject response format");
                        return false;
                    }
                } catch (org.json.JSONException e) {
                    // If JSONObject parsing fails, try JSONArray
                    try {
                        newUrls = new JSONArray(responseString);
                    } catch (org.json.JSONException e2) {
                        Log.w(TAG, "Response is neither valid JSONObject nor JSONArray");
                        return false;
                    }
                }

                // Check if URLs have changed
                SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String currentConfigJson = preferences.getString("service_config", "{}");
                JSONObject currentConfig = new JSONObject(currentConfigJson);

                // Get currently selected callback name to filter URLs
                String selectedCallback = currentConfig.optString("callbackName", "");
                if (selectedCallback.isEmpty() && currentConfig.has("callbackConfig")) {
                    JSONObject cb = currentConfig.optJSONObject("callbackConfig");
                    if (cb != null)
                        selectedCallback = cb.optString("name", "");
                }

                // Filter new URLs by callback if needed and deduplicate
                JSONArray filteredNewUrls = new JSONArray();
                java.util.HashSet<String> seenUrls = new java.util.HashSet<>();
                for (int i = 0; i < newUrls.length(); i++) {
                    JSONObject item = newUrls.getJSONObject(i);
                    String urlString = item.optString("url", "");
                    String itemCallback = item.optString("callback_name", "");

                    if (!urlString.isEmpty()) {
                        if (selectedCallback.isEmpty() || selectedCallback.equals(itemCallback)) {
                            if (!seenUrls.contains(urlString)) {
                                seenUrls.add(urlString);
                                filteredNewUrls.put(urlString);
                            }
                        }
                    }
                }

                // Get current URLs for comparison
                JSONArray currentUrls = currentConfig.optJSONArray("urls");
                if (currentUrls == null && currentConfig.has("urls")) {
                    try {
                        currentUrls = new JSONArray(currentConfig.getString("urls"));
                    } catch (Exception e) {
                    }
                }

                boolean hasChanged = false;
                if (currentUrls == null || filteredNewUrls.length() != currentUrls.length()) {
                    hasChanged = true;
                } else {
                    // Compare actual contents
                    for (int i = 0; i < filteredNewUrls.length(); i++) {
                        if (!filteredNewUrls.getString(i).equals(currentUrls.getString(i))) {
                            hasChanged = true;
                            break;
                        }
                    }
                }

                if (hasChanged) {
                    Log.d(TAG, "URLs have changed. Updating configuration.");

                    currentConfig.put("urls", filteredNewUrls);
                    preferences.edit()
                            .putString("service_config", currentConfig.toString())
                            .putLong("last_url_update", System.currentTimeMillis())
                            .putInt("new_urls_count", filteredNewUrls.length())
                            .apply();

                    Log.d(TAG, "Service configuration updated with " + filteredNewUrls.length() + " URLs");
                    return true;
                }

                connection.disconnect();
                return true;
            } else {
                Log.w(TAG, "Background URL sync failed with HTTP " + responseCode);
                return false;
            }

        } catch (Exception e) {
            Log.e(TAG, "Error syncing URLs from API", e);
            return false;
        }
    }

    private void performBackgroundCheck(Context context, String configJson, PowerManager.WakeLock wakeLock) {
        // First, try to sync URLs from API
        performBackgroundUrlSync(context, configJson);
        ExecutorService executorService = Executors.newSingleThreadExecutor();

        executorService.execute(() -> {
            try {
                Log.d(TAG, "Starting background URL checks");

                JSONObject config = new JSONObject(configJson);

                // Robustly extract URLs array: support multiple shapes (JSONArray or
                // stringified JSON or nested config)
                JSONArray urlsArray = null;
                try {
                    if (config.has("urls")) {
                        Object urlsObj = config.get("urls");
                        if (urlsObj instanceof JSONArray) {
                            urlsArray = (JSONArray) urlsObj;
                        } else {
                            urlsArray = new JSONArray(config.getString("urls"));
                        }
                    } else if (config.has("config") && config.get("config") instanceof JSONObject) {
                        JSONObject inner = config.getJSONObject("config");
                        if (inner.has("urls")) {
                            Object u = inner.get("urls");
                            if (u instanceof JSONArray) {
                                urlsArray = (JSONArray) u;
                            } else {
                                urlsArray = new JSONArray(inner.getString("urls"));
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to parse urls from config in primary ways, attempting fallbacks", e);
                }

                if (urlsArray == null) {
                    Log.w(TAG, "No URLs found in config - aborting background check");
                    wakeLock.release();
                    return;
                }

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
                            Thread.sleep(2000 + (int) (Math.random() * 3000)); // 2-5 second delay
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                            break;
                        }
                    }
                }

                // Update statistics
                updateStatistics(context, results);

                // Ensure callback URL is present in config object for sendBackgroundCallback
                String callbackUrl = null;
                try {
                    if (config.has("callbackUrl")) {
                        callbackUrl = config.optString("callbackUrl", null);
                    } else if (config.has("callbackConfig")) {
                        JSONObject cb = config.optJSONObject("callbackConfig");
                        if (cb != null)
                            callbackUrl = cb.optString("url", null);
                    } else if (config.has("config") && config.get("config") instanceof JSONObject) {
                        JSONObject inner = config.getJSONObject("config");
                        if (inner.has("callbackUrl")) {
                            callbackUrl = inner.optString("callbackUrl", null);
                        } else if (inner.has("callbackConfig")) {
                            JSONObject cb = inner.optJSONObject("callbackConfig");
                            if (cb != null)
                                callbackUrl = cb.optString("url", null);
                        }
                    }

                    if (callbackUrl != null && (config.isNull("callbackUrl") || !config.has("callbackUrl"))) {
                        config.put("callbackUrl", callbackUrl);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Could not normalize callbackUrl in config", e);
                }

                // Send callback if configured (native will perform the callback)
                if (config.has("callbackUrl") && !config.isNull("callbackUrl")) {
                    sendBackgroundCallback(context, results, config);
                }

                // Save last check time
                SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                preferences.edit()
                        .putLong("last_background_check", System.currentTimeMillis())
                        .apply();

                Log.d(TAG, "Background check completed successfully. Checked " + results.size() + " URLs");

                // Start HeadlessJsTask to update React Native state.
                // We set a flag "native_results_only" so JS Headless task will not re-run
                // network checks or resend callbacks.
                startHeadlessJsTask(context, results, configJson);

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
                String userAgent = USER_AGENTS[(int) (Math.random() * USER_AGENTS.length)];
                connection.setRequestProperty("User-Agent", userAgent);
                connection.setRequestProperty("Accept",
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
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
                        responseCode == 429; // Rate limited (but responding)

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
                    Thread.sleep(Math.min(1000 * (long) Math.pow(2, attempt), 10000));
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

    private void startHeadlessJsTask(Context context, List<URLCheckResult> results, String serviceConfigJson) {
        try {
            Intent serviceIntent = new Intent(context, BackgroundCheckService.class);

            // Convert results to bundle data
            WritableMap resultData = Arguments.createMap();
            resultData.putString("source", "AlarmManager");
            resultData.putString("timestamp", String.valueOf(System.currentTimeMillis()));
            resultData.putInt("totalChecked", results.size());

            long activeCount = results.stream().filter(r -> r.isActive).count();
            long inactiveCount = results.stream().filter(r -> !r.isActive).count();

            resultData.putInt("activeCount", (int) activeCount);
            resultData.putInt("inactiveCount", (int) inactiveCount);

            serviceIntent.putExtra("resultData", Arguments.toBundle(resultData));

            // Attach the saved service configuration so JS Headless task can use it if
            // needed
            if (serviceConfigJson != null) {
                serviceIntent.putExtra("service_config", serviceConfigJson);
            }

            // IMPORTANT: indicate that these are native results only — JS should not re-run
            // checks/callbacks
            serviceIntent.putExtra("native_results_only", true);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }

            Log.d(TAG, "HeadlessJsTask started to update React Native state (native results only)");

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
                                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                                        ? android.app.PendingIntent.FLAG_IMMUTABLE
                                        : 0));

                android.app.AlarmManager alarmManager = (android.app.AlarmManager) context
                        .getSystemService(Context.ALARM_SERVICE);

                long nextTriggerTime = System.currentTimeMillis() + (intervalMinutes * 60 * 1000L);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(
                            android.app.AlarmManager.RTC_WAKEUP,
                            nextTriggerTime,
                            pendingIntent);
                } else {
                    alarmManager.setExact(
                            android.app.AlarmManager.RTC_WAKEUP,
                            nextTriggerTime,
                            pendingIntent);
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

            int totalActive = preferences.getInt("total_active_results", 0) + (int) activeCount;
            int totalInactive = preferences.getInt("total_inactive_results", 0) + (int) inactiveCount;

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
            ConnectivityManager connectivityManager = (ConnectivityManager) context
                    .getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo activeNetworkInfo = connectivityManager.getActiveNetworkInfo();
            return activeNetworkInfo != null && activeNetworkInfo.isConnected();
        } catch (Exception e) {
            Log.e(TAG, "Error checking network availability", e);
            return false;
        }
    }

    private String getNetworkType(Context context) {
        try {
            ConnectivityManager connectivityManager = (ConnectivityManager) context
                    .getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo activeNetworkInfo = connectivityManager.getActiveNetworkInfo();

            if (activeNetworkInfo == null)
                return "none";

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

    // เช็คเครือข่ายซิม
    private String getNetworkCarrier(Context context) {
        try {
            ConnectivityManager connectivityManager = (ConnectivityManager) context
                    .getSystemService(Context.CONNECTIVITY_SERVICE);
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
                TelephonyManager telephonyManager = (TelephonyManager) context
                        .getSystemService(Context.TELEPHONY_SERVICE);
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
            ConnectivityManager connectivityManager = (ConnectivityManager) context
                    .getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo activeNetworkInfo = connectivityManager.getActiveNetworkInfo();

            if (activeNetworkInfo == null)
                return "none";

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
