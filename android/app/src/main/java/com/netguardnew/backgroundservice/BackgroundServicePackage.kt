package com.netguardnew.backgroundservice

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import android.util.Log

class BackgroundServicePackage : ReactPackage {

    companion object {
        private const val TAG = "BackgroundServicePackage"
    }

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        Log.d(TAG, "🟢 Creating native modules for BackgroundService")

        return listOf(
            BackgroundServiceModule(reactContext)
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        // No view managers needed for this package
        return emptyList()
    }
}
