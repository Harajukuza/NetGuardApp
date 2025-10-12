package com.netguardnew.backgroundservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class AutoStartReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "NetGuardAutoStartReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "🔄 AutoStart receiver triggered: ${intent.action}")

        when (intent.action) {
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Log.d(TAG, "📦 My package replaced - attempting service restart")
                handlePackageReplaced(context)
            }
            Intent.ACTION_PACKAGE_REPLACED -> {
                val packageName = intent.data?.schemeSpecificPart
                if (packageName == context.packageName) {
                    Log.d(TAG, "📦 Package replaced for $packageName - attempting service restart")
                    handlePackageReplaced(context)
                }
            }
        }
    }

    private fun handlePackageReplaced(context: Context) {
        try {
            // Check if service should be restarted
            if (BootReceiver.isServiceStateEnabled(context)) {
                Log.d(TAG, "🚀 Service was enabled - scheduling restart")

                // Use a slight delay to ensure system is ready
                val serviceIntent = Intent(context, NetGuardBackgroundService::class.java).apply {
                    putExtra("AUTO_RESTART_REASON", "PACKAGE_REPLACED")
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }

                Log.d(TAG, "✅ Auto-restart service initiated")
            } else {
                Log.d(TAG, "ℹ️ Service was not enabled - no restart needed")
            }

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in auto-start handler", e)
        }
    }
}
