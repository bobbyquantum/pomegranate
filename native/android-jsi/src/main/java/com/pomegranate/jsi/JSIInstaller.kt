package com.pomegranate.jsi

import android.content.Context

/**
 * JNI bridge between Kotlin and C++ JSI binding.
 * Loads the native library and installs the JSI global function.
 */
internal object JSIInstaller {
    private var context: Context? = null

    init {
        System.loadLibrary("pomegranate-jsi")
    }

    fun install(
        context: Context,
        javaScriptContextHolder: Long,
    ) {
        this.context = context
        installBinding(javaScriptContextHolder)
        // Call _resolveDatabasePath to prevent ProGuard/R8 from stripping it
        _resolveDatabasePath("")
    }

    /**
     * Called from C++ to resolve a database name to an absolute path.
     */
    @Suppress("FunctionName") // JNI naming convention
    @JvmStatic
    fun _resolveDatabasePath(dbName: String): String {
        // On some systems there is a lock on /databases folder
        return context!!
            .getDatabasePath("$dbName.db")
            .path
            .replace("/databases", "")
    }

    private external fun installBinding(javaScriptContextHolder: Long)

    @JvmStatic
    external fun destroy()
}
