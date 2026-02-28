package com.pomegranate.jsi

import android.util.Log
import com.facebook.react.bridge.JavaScriptContextHolder
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * React Native module that installs the PomegranateDB JSI binding.
 *
 * JS should call PomegranateJSIBridge.install() early in the app lifecycle
 * (before using any native SQLite adapter). This is a synchronous blocking
 * method that registers the global nativePomegranateCreateAdapter function.
 */
@ReactModule(name = PomegranateJSIModule.NAME)
class PomegranateJSIModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = NAME

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun install(): Boolean =
        try {
            val jsContext: JavaScriptContextHolder =
                reactApplicationContext.javaScriptContextHolder!!
            JSIInstaller.install(reactApplicationContext, jsContext.get())
            Log.i(NAME, "Successfully installed PomegranateDB JSI Bindings!")
            true
        } catch (exception: Exception) {
            Log.e(NAME, "Failed to install PomegranateDB JSI Bindings!", exception)
            false
        }

    companion object {
        const val NAME = "PomegranateJSIBridge"
    }
}
