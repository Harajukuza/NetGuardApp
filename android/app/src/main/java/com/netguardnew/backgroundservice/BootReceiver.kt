package com.netguardnew.backgroundservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "NetGuardBootReceiver"
        private const val PREFS_NAME = "NetGuardServicePrefs"
        private const val KEY_SERVICE_WAS_RUNNING = "service_was_running"
        private const val KEY_URLS = "saved_urls"
        private const val KEY_CALLBACK_CONFIG = "saved_callback_config"
        private const val KEY_CHECK_INTERVAL = "saved_check_interval"

        // Static methods to save/restore service state
        fun saveServiceState(
            context: Context,
            isRunning: Boolean,
            urls: String? = null,
            callbackConfig: String? = null,
            checkInterval: Long = 60000L
        ) {
            try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                with(prefs.edit()) {
                    putBoolean(KEY_SERVICE_WAS_RUNNING, isRunning)
                    urls?.let { putString(KEY_URLS, it) }
                    callbackConfig?.let { putString(KEY_CALLBACK_CONFIG, it) }
                    putLong(KEY_CHECK_INTERVAL, checkInterval)
                    apply()
                }

                Log.d(TAG, "💾 Service state saved: isRunning=$isRunning")

            } catch (e: Exception) {
                Log.e(TAG, "❌ Error saving service state", e)
            }
        }

        fun clearServiceState(context: Context) {
            try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                with(prefs.edit()) {
                    putBoolean(KEY_SERVICE_WAS_RUNNING, false)
                    apply()
                }

                Log.d(TAG, "🗑️ Service state cleared")

            } catch (e: Exception) {
                Log.e(TAG, "❌ Error clearing service state", e)
            }
        }

        fun isServiceStateEnabled(context: Context): Boolean {
            return try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                prefs.getBoolean(KEY_SERVICE_WAS_RUNNING, false)
            } catch (e: Exception) {
                Log.e(TAG, "❌ Error checking service state", e)
                false
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "📱 Boot receiver triggered: ${intent.action}")

        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON" -> {
                Log.d(TAG, "🚀 Device boot completed - checking if service should restart")
                handleBootCompleted(context)
            }
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_PACKAGE_REPLACED -> {
                if (intent.dataString?.contains(context.packageName) == true) {
                    Log.d(TAG, "📦 App package replaced - checking if service should restart")
                    handlePackageReplaced(context)
                }
            }
            Intent.ACTION_PACKAGE_RESTARTED -> {
                if (intent.dataString?.contains(context.packageName) == true) {
                    Log.d(TAG, "🔄 App package restarted - checking if service should restart")
                    handlePackageRestarted(context)
                }
            }
        }
    }

    private fun handleBootCompleted(context: Context) {
        try {
            Log.d(TAG, "🔍 Checking if NetGuard service was running before reboot...")

            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val wasServiceRunning = prefs.getBoolean(KEY_SERVICE_WAS_RUNNING, false)

            if (wasServiceRunning) {
                Log.d(TAG, "✅ Service was running before reboot - attempting to restart")

                // Get saved configuration
                val savedUrls = prefs.getString(KEY_URLS, null)
                val savedCallbackConfig = prefs.getString(KEY_CALLBACK_CONFIG, null)
                val savedInterval = prefs.getLong(KEY_CHECK_INTERVAL, 60000L)

                if (!savedUrls.isNullOrEmpty()) {
                    // Create intent to restart service
                    val serviceIntent = Intent(context, NetGuardBackgroundService::class.java).apply {
                        putExtra(NetGuardBackgroundService.EXTRA_URLS, savedUrls)
                        putExtra(NetGuardBackgroundService.EXTRA_CALLBACK_CONFIG, savedCallbackConfig)
                        putExtra(NetGuardBackgroundService.EXTRA_CHECK_INTERVAL, savedInterval)
                        putExtra("AUTO_RESTART", true)
                    }

                    // Start service
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent)
                    } else {
                        context.startService(serviceIntent)
                    }

                    Log.d(TAG, "🚀 NetGuard service auto-restart initiated")
                } else {
                    Log.w(TAG, "⚠️ No saved URLs found - skipping auto-restart")
                }
            } else {
                Log.d(TAG, "ℹ️ Service was not running before reboot - no action needed")
            }

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in boot completed handler", e)
        }
    }

    private fun handlePackageReplaced(context: Context) {
        try {
            Log.d(TAG, "🔄 Handling package replacement...")

            // Similar logic to boot completed, but maybe with different behavior
            // For app updates, we might want to be more conservative
            handleBootCompleted(context)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in package replaced handler", e)
        }
    }

    private fun handlePackageRestarted(context: Context) {
        try {
            Log.d(TAG, "🔄 Handling package restart...")

            // Package was force-stopped and restarted
            // This is a good time to restart our service
            handleBootCompleted(context)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in package restarted handler", e)
        }
    }


}
