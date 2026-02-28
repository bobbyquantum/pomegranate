package com.pomegranate.jsi

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * React Native package that provides the PomegranateDB JSI module.
 * Add this to your MainApplication's getPackages() list.
 */
class PomegranateJSIPackage : ReactPackage {
    override fun createNativeModules(reactAppContext: ReactApplicationContext): List<NativeModule> =
        listOf(PomegranateJSIModule(reactAppContext))

    override fun createViewManagers(reactAppContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
