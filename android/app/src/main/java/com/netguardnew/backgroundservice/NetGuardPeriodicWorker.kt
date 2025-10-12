package com.netguardnew.backgroundservice

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.ForegroundInfo
import androidx.core.app.NotificationCompat
import android.app.NotificationManager
import android.os.Build

class NetGuardPeriodicWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "NetGuardPeriodicWorker"
        private const val WORKER_NOTIFICATION_ID = 12346
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "🔄 Periodic worker started")

        return try {
            // Set foreground to avoid being killed
            setForeground(createForegroundInfo())

            // Check if main service is running
            if (!NetGuardBackgroundService.isServiceRunning) {
                Log.w(TAG, "⚠️ Main service not running, attempting restart")
                restartBackgroundService()
            } else {
                Log.d(TAG, "✅ Main service is running normally")
            }

            // Always return success to keep periodic work running
            Result.success()

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in periodic worker", e)

            // Try to restart service on error
            try {
                restartBackgroundService()
            } catch (restartError: Exception) {
                Log.e(TAG, "❌ Failed to restart service", restartError)
            }

            // Return retry to attempt again later
            Result.retry()
        }
    }

    private fun restartBackgroundService() {
        try {
            Log.d(TAG, "🚀 Attempting to restart background service")

            val intent = Intent(applicationContext, NetGuardBackgroundService::class.java)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                applicationContext.startForegroundService(intent)
            } else {
                applicationContext.startService(intent)
            }

            Log.d(TAG, "✅ Background service restart initiated")

        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to restart background service", e)
            throw e
        }
    }

    private fun createForegroundInfo(): ForegroundInfo {
        val notification = NotificationCompat.Builder(applicationContext, "NETGUARD_BACKGROUND")
            .setContentTitle("🔧 NetGuard Maintenance")
            .setContentText("Checking service health...")
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        return ForegroundInfo(WORKER_NOTIFICATION_ID, notification)
    }
}
