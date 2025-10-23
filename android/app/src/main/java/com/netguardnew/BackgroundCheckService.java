package com.netguardnew;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import javax.annotation.Nullable;

/**
 * HeadlessJS Task Service for background communication with React Native
 * Handles background check results and updates React Native state
 */
public class BackgroundCheckService extends HeadlessJsTaskService {

    private static final String TAG = "NetGuard:BackgroundCheckService";
    public static final String TASK_NAME = "BackgroundURLCheckTask";
    private static final String CHANNEL_ID = "netguard_bg_channel";
    private static final int NOTIFICATION_ID = 4242;

    @Override
    protected @Nullable HeadlessJsTaskConfig getTaskConfig(Intent intent) {
        Bundle extras = intent.getExtras();

        if (extras != null) {
            Log.d(TAG, "Starting HeadlessJS task with data");

            WritableMap data = Arguments.createMap();

            // Extract result data from intent
            Bundle resultData = extras.getBundle("resultData");
            if (resultData != null) {
                data.putString("source", resultData.getString("source", "unknown"));
                data.putString("timestamp", resultData.getString("timestamp", ""));
                data.putInt("totalChecked", resultData.getInt("totalChecked", 0));
                data.putInt("activeCount", resultData.getInt("activeCount", 0));
                data.putInt("inactiveCount", resultData.getInt("inactiveCount", 0));
            }

                // If the receiver attached a service_config JSON, pass it to JS
                String serviceConfig = extras.getString("service_config");
                if (serviceConfig != null) {
                    data.putString("serviceConfig", serviceConfig);
                }

            data.putBoolean("isBackground", true);
            data.putString("taskName", TASK_NAME);

            return new HeadlessJsTaskConfig(
                TASK_NAME,
                data,
                30000, // 30 seconds timeout
                true   // allow task to run in foreground
            );
        }

        Log.w(TAG, "No extras provided to HeadlessJS task");
        return null;
    }

    @Override
    public void onHeadlessJsTaskStart(int taskId) {
        Log.d(TAG, "HeadlessJS task started with ID: " + taskId);
        try {
            // Create notification channel for Android O+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) {
                    NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "NetGuard Background",
                        NotificationManager.IMPORTANCE_LOW
                    );
                    channel.setDescription("Background checks and callbacks for NetGuard");
                    nm.createNotificationChannel(channel);
                }
            }

            // Build a minimal ongoing notification so the service can run in foreground
            Intent notifyIntent = new Intent(this, getClass());
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                notifyIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("NetGuard: Background Checks")
                .setContentText("Performing scheduled background URL checks")
                .setSmallIcon(getApplicationInfo().icon)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true);

            startForeground(NOTIFICATION_ID, builder.build());
        } catch (Exception e) {
            Log.w(TAG, "Failed to start foreground notification", e);
        }
        super.onHeadlessJsTaskStart(taskId);
    }

    @Override
    public void onHeadlessJsTaskFinish(int taskId) {
        Log.d(TAG, "HeadlessJS task finished with ID: " + taskId);
        try {
            stopForeground(true);
            // Optionally cancel notification using NotificationManager
            NotificationManagerCompat.from(this).cancel(NOTIFICATION_ID);
        } catch (Exception e) {
            Log.w(TAG, "Failed to stop foreground notification", e);
        }
        super.onHeadlessJsTaskFinish(taskId);
    }
}
