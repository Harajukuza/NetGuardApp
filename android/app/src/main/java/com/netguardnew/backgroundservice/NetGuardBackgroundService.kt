package com.netguardnew.backgroundservice

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

class NetGuardBackgroundService : Service() {

    companion object {
        private const val TAG = "NetGuardBgService"
        private const val NOTIFICATION_ID = 12345
        private const val CHANNEL_ID = "NETGUARD_BACKGROUND"
        private const val WAKELOCK_TAG = "NetGuard::BackgroundWakeLock"
        private const val REQUEST_TIMEOUT = 30000L // 30 seconds
        private const val CALLBACK_TIMEOUT = 15000L // 15 seconds

        // Service state tracking
        var isServiceRunning = false
        var serviceStartTime = 0L
        var totalChecks = 0
        var successfulCallbacks = 0
        var failedCallbacks = 0
        var lastCheckTime = 0L

        // Intent extras
        const val EXTRA_URLS = "urls"
        const val EXTRA_CALLBACK_CONFIG = "callback_config"
        const val EXTRA_CHECK_INTERVAL = "check_interval"
        const val EXTRA_REACT_CONTEXT = "react_context"
    }

    private var job: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val client = OkHttpClient.Builder()
        .connectTimeout(REQUEST_TIMEOUT, TimeUnit.MILLISECONDS)
        .readTimeout(REQUEST_TIMEOUT, TimeUnit.MILLISECONDS)
        .writeTimeout(REQUEST_TIMEOUT, TimeUnit.MILLISECONDS)
        .build()

    private val userAgents = arrayOf(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )

    // Service configuration
    private var urls = mutableListOf<String>()
    private var callbackConfig: JSONObject? = null
    private var checkInterval = 60000L // Default 1 minute
    private var reactContext: ReactApplicationContext? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "🟢 NetGuard Background Service Created")
        createNotificationChannel()
        acquireWakeLock()
        schedulePeriodicWork()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "🚀 Service onStartCommand called")

        // Extract configuration from intent
        intent?.let { extractConfigFromIntent(it) }

        // Start foreground service
        startForeground(NOTIFICATION_ID, createNotification("Initializing URL monitoring..."))

        // Update service state
        isServiceRunning = true
        serviceStartTime = System.currentTimeMillis()

        // Start monitoring coroutine
        startMonitoring()

        Log.d(TAG, "✅ Background service started successfully")

        // Return START_STICKY to restart service if killed
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "🛑 Service onDestroy called")

        // Update service state
        isServiceRunning = false

        // Cancel monitoring job
        job?.cancel()

        // Release wake lock
        releaseWakeLock()

        // Cancel periodic work
        WorkManager.getInstance(this).cancelUniqueWork("NetGuardPeriodicWork")

        // Send service stopped event
        sendEventToReact("onServiceStopped", null)

        super.onDestroy()
        Log.d(TAG, "🔴 NetGuard Background Service Destroyed")
    }

    private fun extractConfigFromIntent(intent: Intent) {
        try {
            // Extract URLs
            val urlsJson = intent.getStringExtra(EXTRA_URLS)
            if (!urlsJson.isNullOrEmpty()) {
                val urlsArray = JSONArray(urlsJson)
                urls.clear()
                for (i in 0 until urlsArray.length()) {
                    val urlObj = urlsArray.getJSONObject(i)
                    urls.add(urlObj.getString("url"))
                }
                Log.d(TAG, "📋 Loaded ${urls.size} URLs to monitor")
            }

            // Extract callback config
            val callbackJson = intent.getStringExtra(EXTRA_CALLBACK_CONFIG)
            if (!callbackJson.isNullOrEmpty()) {
                callbackConfig = JSONObject(callbackJson)
                Log.d(TAG, "📞 Callback configured: ${callbackConfig?.optString("name")}")
            }

            // Extract check interval
            checkInterval = intent.getLongExtra(EXTRA_CHECK_INTERVAL, 60000L)
            Log.d(TAG, "⏰ Check interval: ${checkInterval / 1000}s")

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error extracting config from intent", e)
        }
    }

    private fun startMonitoring() {
        job = CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
            Log.d(TAG, "🔄 Starting monitoring loop")

            try {
                while (isActive && isServiceRunning) {
                    try {
                        Log.d(TAG, "🔍 Starting URL check cycle")
                        updateNotification("Checking ${urls.size} URLs...")

                        // Perform URL checks
                        val results = performUrlChecks()

                        // Send callback if configured
                        if (callbackConfig != null && results.isNotEmpty()) {
                            sendCallback(results)
                        }

                        // Update statistics
                        totalChecks++
                        lastCheckTime = System.currentTimeMillis()

                        // Send update to React Native
                        sendStatsUpdateToReact()

                        // Update notification with results
                        val activeCount = results.count { it.getBoolean("isActive") }
                        val inactiveCount = results.size - activeCount
                        updateNotification("✅ $activeCount active, ❌ $inactiveCount inactive")

                        Log.d(TAG, "✅ Check cycle completed: $activeCount active, $inactiveCount inactive")

                    } catch (e: Exception) {
                        Log.e(TAG, "❌ Error in monitoring cycle", e)
                        updateNotification("⚠️ Monitoring error - retrying...")
                        // Continue monitoring despite errors
                    }

                    // Wait for next check interval
                    Log.d(TAG, "💤 Waiting ${checkInterval / 1000}s for next check")
                    delay(checkInterval)
                }
            } catch (e: CancellationException) {
                Log.d(TAG, "🛑 Monitoring cancelled")
            } catch (e: Exception) {
                Log.e(TAG, "💥 Fatal error in monitoring loop", e)

                // Restart monitoring after delay
                delay(5000)
                if (isServiceRunning) {
                    startMonitoring()
                }
            }
        }
    }

    private suspend fun performUrlChecks(): List<JSONObject> = withContext(Dispatchers.IO) {
        val results = mutableListOf<JSONObject>()

        Log.d(TAG, "🌐 Checking ${urls.size} URLs")

        for ((index, url) in urls.withIndex()) {
            try {
                // Random delay between requests (5-30 seconds)
                if (index > 0) {
                    val randomDelay = (5000..30000).random()
                    Log.d(TAG, "⏱️ Random delay: ${randomDelay}ms before checking $url")
                    delay(randomDelay.toLong())
                }

                val result = checkSingleUrl(url)
                results.add(result)

                Log.d(TAG, "📊 URL: $url - Status: ${if (result.getBoolean("isActive")) "ACTIVE" else "INACTIVE"}")

            } catch (e: Exception) {
                Log.e(TAG, "❌ Error checking URL: $url", e)

                val errorResult = JSONObject().apply {
                    put("url", url)
                    put("isActive", false)
                    put("error", e.message ?: "Unknown error")
                    put("timestamp", System.currentTimeMillis())
                    put("responseTime", -1)
                }
                results.add(errorResult)
            }
        }

        Log.d(TAG, "📈 URL checks completed: ${results.size} results")
        results
    }

    private suspend fun checkSingleUrl(url: String): JSONObject = withContext(Dispatchers.IO) {
        val startTime = System.currentTimeMillis()
        val result = JSONObject()

        try {
            val randomUserAgent = userAgents.random()

            val request = Request.Builder()
                .url(url)
                .header("User-Agent", randomUserAgent)
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                .header("Accept-Language", "en-US,en;q=0.5")
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .build()

            Log.d(TAG, "📡 Fetching: $url")

            val response = client.newCall(request).execute()
            val responseTime = System.currentTimeMillis() - startTime

            val isSuccess = response.isSuccessful ||
                           response.code in 300..399 || // Redirects
                           response.code in listOf(401, 403, 429) // Auth/Rate limit

            result.apply {
                put("url", url)
                put("isActive", isSuccess)
                put("statusCode", response.code)
                put("statusText", response.message)
                put("responseTime", responseTime)
                put("timestamp", System.currentTimeMillis())
                put("isRedirect", response.code in 300..399)
                if (!isSuccess) {
                    put("error", "HTTP ${response.code}: ${response.message}")
                }
            }

            response.close()
            Log.d(TAG, "✅ $url responded with ${response.code} in ${responseTime}ms")

        } catch (e: SocketTimeoutException) {
            val responseTime = System.currentTimeMillis() - startTime
            result.apply {
                put("url", url)
                put("isActive", false)
                put("error", "Request timeout")
                put("errorType", "timeout")
                put("responseTime", responseTime)
                put("timestamp", System.currentTimeMillis())
            }
            Log.w(TAG, "⏱️ Timeout for $url after ${responseTime}ms")

        } catch (e: UnknownHostException) {
            val responseTime = System.currentTimeMillis() - startTime
            result.apply {
                put("url", url)
                put("isActive", false)
                put("error", "DNS resolution failed")
                put("errorType", "network")
                put("responseTime", responseTime)
                put("timestamp", System.currentTimeMillis())
            }
            Log.w(TAG, "🌐 DNS error for $url: ${e.message}")

        } catch (e: ConnectException) {
            val responseTime = System.currentTimeMillis() - startTime
            result.apply {
                put("url", url)
                put("isActive", false)
                put("error", "Connection failed")
                put("errorType", "network")
                put("responseTime", responseTime)
                put("timestamp", System.currentTimeMillis())
            }
            Log.w(TAG, "🔌 Connection error for $url: ${e.message}")

        } catch (e: Exception) {
            val responseTime = System.currentTimeMillis() - startTime
            result.apply {
                put("url", url)
                put("isActive", false)
                put("error", e.message ?: "Unknown error")
                put("errorType", "unknown")
                put("responseTime", responseTime)
                put("timestamp", System.currentTimeMillis())
            }
            Log.e(TAG, "❌ Unexpected error for $url", e)
        }

        result
    }

    private suspend fun sendCallback(results: List<JSONObject>) = withContext(Dispatchers.IO) {
        try {
            val callbackUrl = callbackConfig?.getString("url")
            val callbackName = callbackConfig?.getString("name") ?: "Unknown"

            if (callbackUrl.isNullOrEmpty()) {
                Log.w(TAG, "⚠️ No callback URL configured")
                return@withContext
            }

            Log.d(TAG, "📤 Sending callback to: $callbackUrl")

            val activeCount = results.count { it.getBoolean("isActive") }
            val inactiveCount = results.size - activeCount

            val payload = JSONObject().apply {
                put("checkType", "background_batch")
                put("timestamp", System.currentTimeMillis())
                put("isBackground", true)
                put("backgroundServiceRunning", true)
                put("serviceStats", JSONObject().apply {
                    put("totalChecks", totalChecks)
                    put("successfulCallbacks", successfulCallbacks)
                    put("failedCallbacks", failedCallbacks)
                    put("uptime", System.currentTimeMillis() - serviceStartTime)
                    put("startTime", serviceStartTime)
                    put("lastCheckTime", lastCheckTime)
                })
                put("summary", JSONObject().apply {
                    put("total", results.size)
                    put("active", activeCount)
                    put("inactive", inactiveCount)
                })
                put("urls", JSONArray(results))
                put("device", getDeviceInfo())
                put("callbackName", callbackName)
            }

            val requestBody = payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())

            val request = Request.Builder()
                .url(callbackUrl)
                .post(requestBody)
                .header("Content-Type", "application/json")
                .header("User-Agent", "NetGuard-Background/2.0")
                .header("Accept", "application/json")
                .build()

            // Use separate client with shorter timeout for callbacks
            val callbackClient = OkHttpClient.Builder()
                .connectTimeout(CALLBACK_TIMEOUT, TimeUnit.MILLISECONDS)
                .readTimeout(CALLBACK_TIMEOUT, TimeUnit.MILLISECONDS)
                .writeTimeout(CALLBACK_TIMEOUT, TimeUnit.MILLISECONDS)
                .build()

            val response = callbackClient.newCall(request).execute()

            if (response.isSuccessful) {
                successfulCallbacks++
                Log.d(TAG, "✅ Callback sent successfully: HTTP ${response.code}")
            } else {
                failedCallbacks++
                Log.w(TAG, "⚠️ Callback failed: HTTP ${response.code} - ${response.message}")
            }

            response.close()

        } catch (e: Exception) {
            failedCallbacks++
            Log.e(TAG, "❌ Error sending callback", e)
        }
    }

    private fun getDeviceInfo(): JSONObject {
        return JSONObject().apply {
            put("id", android.provider.Settings.Secure.getString(contentResolver, android.provider.Settings.Secure.ANDROID_ID))
            put("model", Build.MODEL)
            put("brand", Build.BRAND)
            put("platform", "Android")
            put("version", Build.VERSION.RELEASE)
            put("sdk", Build.VERSION.SDK_INT)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "NetGuard Background Monitoring",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Continuous URL monitoring service"
                setShowBadge(false)
                enableLights(false)
                enableVibration(false)
            }

            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
            Log.d(TAG, "📱 Notification channel created")
        }
    }

    private fun createNotification(contentText: String): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🔍 NetGuard Monitoring")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(contentText: String) {
        try {
            val notification = createNotification(contentText)
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            Log.e(TAG, "Error updating notification", e)
        }
    }

    private fun acquireWakeLock() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                WAKELOCK_TAG
            ).apply {
                acquire(10*60*1000L /*10 minutes*/)
            }
            Log.d(TAG, "🔋 Wake lock acquired")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to acquire wake lock", e)
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.let {
                if (it.isHeld) {
                    it.release()
                    Log.d(TAG, "🔋 Wake lock released")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error releasing wake lock", e)
        }
    }

    private fun schedulePeriodicWork() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(false)
            .build()

        val workRequest = PeriodicWorkRequestBuilder<NetGuardPeriodicWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 1, TimeUnit.MINUTES)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "NetGuardPeriodicWork",
            ExistingPeriodicWorkPolicy.KEEP,
            workRequest
        )

        Log.d(TAG, "⚙️ Periodic work scheduled")
    }

    private fun sendEventToReact(eventName: String, params: WritableMap?) {
        try {
            reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(eventName, params)
        } catch (e: Exception) {
            Log.e(TAG, "Error sending event to React Native: $eventName", e)
        }
    }

    private fun sendStatsUpdateToReact() {
        try {
            val stats = Arguments.createMap().apply {
                putBoolean("isRunning", isServiceRunning)
                putDouble("startTime", serviceStartTime.toDouble())
                putInt("totalChecks", totalChecks)
                putInt("successfulCallbacks", successfulCallbacks)
                putInt("failedCallbacks", failedCallbacks)
                putDouble("lastCheckTime", lastCheckTime.toDouble())
                putDouble("uptime", (System.currentTimeMillis() - serviceStartTime).toDouble())
            }
            sendEventToReact("onServiceStatsUpdate", stats)
        } catch (e: Exception) {
            Log.e(TAG, "Error sending stats update", e)
        }
    }
}
