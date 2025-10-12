package com.netguardnew.backgroundservice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import androidx.work.WorkManager
import org.json.JSONObject
import org.json.JSONArray

class BackgroundServiceModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "BackgroundServiceModule"
        const val MODULE_NAME = "NetGuardBackgroundService"
    }

    private val context = reactContext

    override fun getName(): String = MODULE_NAME

    init {
        Log.d(TAG, "🟢 BackgroundServiceModule initialized")
    }

    @ReactMethod
    fun startBackgroundService(
        urls: ReadableArray,
        callbackConfig: ReadableMap?,
        checkIntervalMinutes: Int,
        promise: Promise
    ) {
        try {
            Log.d(TAG, "🚀 Starting background service...")
            Log.d(TAG, "📋 URLs: ${urls.size()}")
            Log.d(TAG, "⏰ Interval: ${checkIntervalMinutes}m")

            val intent = Intent(context, NetGuardBackgroundService::class.java)

            // Convert URLs to JSON string
            val urlsJson = convertUrlsToJson(urls)
            intent.putExtra(NetGuardBackgroundService.EXTRA_URLS, urlsJson)
            Log.d(TAG, "📤 URLs JSON: $urlsJson")

            // Convert callback config to JSON string
            callbackConfig?.let { config ->
                val callbackJson = convertCallbackToJson(config)
                intent.putExtra(NetGuardBackgroundService.EXTRA_CALLBACK_CONFIG, callbackJson)
                Log.d(TAG, "📞 Callback JSON: $callbackJson")
            }

            // Set check interval
            val intervalMs = checkIntervalMinutes * 60 * 1000L
            intent.putExtra(NetGuardBackgroundService.EXTRA_CHECK_INTERVAL, intervalMs)

            // Start service
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }

            Log.d(TAG, "✅ Background service start command sent")

            // Return success with service info
            val result = Arguments.createMap().apply {
                putBoolean("success", true)
                putString("message", "Background service started successfully")
                putInt("urlCount", urls.size())
                putInt("intervalMinutes", checkIntervalMinutes)
                putDouble("startTime", System.currentTimeMillis().toDouble())
            }

            promise.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error starting background service", e)
            promise.reject("SERVICE_START_ERROR", "Failed to start background service: ${e.message}", e)
        }
    }

    @ReactMethod
    fun stopBackgroundService(promise: Promise) {
        try {
            Log.d(TAG, "🛑 Stopping background service...")

            val intent = Intent(context, NetGuardBackgroundService::class.java)
            val stopped = context.stopService(intent)

            // Also cancel any WorkManager tasks
            WorkManager.getInstance(context).cancelUniqueWork("NetGuardPeriodicWork")

            Log.d(TAG, "✅ Background service stop command sent (stopped: $stopped)")

            val result = Arguments.createMap().apply {
                putBoolean("success", true)
                putString("message", "Background service stopped successfully")
                putBoolean("wasRunning", stopped)
                putDouble("stopTime", System.currentTimeMillis().toDouble())
            }

            promise.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error stopping background service", e)
            promise.reject("SERVICE_STOP_ERROR", "Failed to stop background service: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getServiceStatus(promise: Promise) {
        try {
            Log.d(TAG, "📊 Getting service status...")

            val status = Arguments.createMap().apply {
                putBoolean("isRunning", NetGuardBackgroundService.isServiceRunning)
                putDouble("startTime", NetGuardBackgroundService.serviceStartTime.toDouble())
                putInt("totalChecks", NetGuardBackgroundService.totalChecks)
                putInt("successfulCallbacks", NetGuardBackgroundService.successfulCallbacks)
                putInt("failedCallbacks", NetGuardBackgroundService.failedCallbacks)
                putDouble("lastCheckTime", NetGuardBackgroundService.lastCheckTime.toDouble())

                if (NetGuardBackgroundService.isServiceRunning) {
                    val uptime = System.currentTimeMillis() - NetGuardBackgroundService.serviceStartTime
                    putDouble("uptime", uptime.toDouble())
                }
            }

            Log.d(TAG, "✅ Service status retrieved")
            promise.resolve(status)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error getting service status", e)
            promise.reject("STATUS_ERROR", "Failed to get service status: ${e.message}", e)
        }
    }

    @ReactMethod
    fun updateServiceConfiguration(
        urls: ReadableArray,
        callbackConfig: ReadableMap?,
        checkIntervalMinutes: Int,
        promise: Promise
    ) {
        try {
            Log.d(TAG, "🔄 Updating service configuration...")

            // Stop current service
            context.stopService(Intent(context, NetGuardBackgroundService::class.java))

            // Wait a moment for service to stop
            Thread.sleep(1000)

            // Start with new configuration
            startBackgroundService(urls, callbackConfig, checkIntervalMinutes, promise)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error updating service configuration", e)
            promise.reject("CONFIG_UPDATE_ERROR", "Failed to update configuration: ${e.message}", e)
        }
    }

    @ReactMethod
    fun performManualCheck(
        urls: ReadableArray,
        callbackConfig: ReadableMap?,
        promise: Promise
    ) {
        try {
            Log.d(TAG, "🔍 Performing manual check...")

            // Create a temporary intent for manual check
            val intent = Intent(context, NetGuardBackgroundService::class.java).apply {
                putExtra("MANUAL_CHECK", true)
                putExtra(NetGuardBackgroundService.EXTRA_URLS, convertUrlsToJson(urls))
                callbackConfig?.let {
                    putExtra(NetGuardBackgroundService.EXTRA_CALLBACK_CONFIG, convertCallbackToJson(it))
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }

            val result = Arguments.createMap().apply {
                putBoolean("success", true)
                putString("message", "Manual check initiated")
                putInt("urlCount", urls.size())
                putDouble("checkTime", System.currentTimeMillis().toDouble())
            }

            promise.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error performing manual check", e)
            promise.reject("MANUAL_CHECK_ERROR", "Failed to perform manual check: ${e.message}", e)
        }
    }

    @ReactMethod
    fun requestBatteryOptimizationExemption(promise: Promise) {
        try {
            Log.d(TAG, "🔋 Requesting battery optimization exemption...")

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent().apply {
                    action = android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                    data = android.net.Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }

                if (intent.resolveActivity(context.packageManager) != null) {
                    context.startActivity(intent)
                    promise.resolve(Arguments.createMap().apply {
                        putBoolean("success", true)
                        putString("message", "Battery optimization settings opened")
                    })
                } else {
                    promise.resolve(Arguments.createMap().apply {
                        putBoolean("success", false)
                        putString("message", "Battery optimization settings not available")
                    })
                }
            } else {
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("success", false)
                    putString("message", "Battery optimization not applicable for this Android version")
                })
            }

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error requesting battery optimization exemption", e)
            promise.reject("BATTERY_OPTIMIZATION_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN built in Event Emitter Calls.
        Log.d(TAG, "👂 Event listener added: $eventName")
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN built in Event Emitter Calls.
        Log.d(TAG, "🔇 Event listeners removed: $count")
    }

    // Helper functions
    private fun convertUrlsToJson(urls: ReadableArray): String {
        val jsonArray = JSONArray()
        for (i in 0 until urls.size()) {
            val urlMap = urls.getMap(i)
            val jsonObject = JSONObject().apply {
                put("id", urlMap?.getString("id") ?: "")
                put("url", urlMap?.getString("url") ?: "")
            }
            jsonArray.put(jsonObject)
        }
        return jsonArray.toString()
    }

    private fun convertCallbackToJson(callbackConfig: ReadableMap): String {
        return JSONObject().apply {
            put("name", callbackConfig.getString("name") ?: "")
            put("url", callbackConfig.getString("url") ?: "")
        }.toString()
    }

    // Send events to React Native
    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(eventName, params)
        } catch (e: Exception) {
            Log.e(TAG, "Error sending event: $eventName", e)
        }
    }

    // Constants for React Native
    override fun getConstants(): MutableMap<String, Any> {
        return hashMapOf(
            "SUPPORTED" to true,
            "PLATFORM" to "Android",
            "MIN_INTERVAL_MINUTES" to 1,
            "MAX_INTERVAL_MINUTES" to 1440, // 24 hours
            "DEFAULT_INTERVAL_MINUTES" to 60
        )
    }
}
