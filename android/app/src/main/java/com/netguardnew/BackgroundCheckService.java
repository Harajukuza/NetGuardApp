package com.netguardnew;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;

import javax.annotation.Nullable;

/**
 * HeadlessJS Task Service for background communication with React Native
 * Handles background check results and updates React Native state
 */
public class BackgroundCheckService extends HeadlessJsTaskService {

    private static final String TAG = "NetGuard:BackgroundCheckService";
    public static final String TASK_NAME = "BackgroundURLCheckTask";

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
        super.onHeadlessJsTaskStart(taskId);
    }

    @Override
    public void onHeadlessJsTaskFinish(int taskId) {
        Log.d(TAG, "HeadlessJS task finished with ID: " + taskId);
        super.onHeadlessJsTaskFinish(taskId);
    }
}
