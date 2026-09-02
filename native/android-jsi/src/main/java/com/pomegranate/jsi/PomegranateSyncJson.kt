package com.pomegranate.jsi

/**
 * Public entry point for the turbo sync store.
 *
 * Native code that already holds a sync payload as bytes (for example a module
 * that downloaded and decompressed a bundle) hands it to PomegranateDB here.
 * JS then calls `adapter.applySyncJson(syncJsonId)` and the rows are written
 * straight into SQLite without the payload ever crossing into the JS runtime.
 *
 * Referencing this object loads the `pomegranate-jsi` native library.
 */
object PomegranateSyncJson {
    /** Store `json` under `syncJsonId`, replacing any existing payload. */
    @JvmStatic
    fun provide(
        syncJsonId: Int,
        json: ByteArray,
    ) = JSIInstaller.provideSyncJson(syncJsonId, json)

    /** Drop a stored payload. Returns true if one was stored under `syncJsonId`. */
    @JvmStatic
    fun discard(syncJsonId: Int): Boolean = JSIInstaller.discardSyncJson(syncJsonId)
}
