/**
 * PomegranateDB — JNI bridge.
 *
 * Called from Java to install the JSI binding into the JS runtime.
 */

#include <jni.h>
#include <jsi/jsi.h>
#include <cassert>

#include <string>

#include "Database.h"
#include "DatabasePlatformAndroid.h"
#include "SyncJsonStore.h"

using namespace facebook;

extern "C" JNIEXPORT void JNICALL Java_com_pomegranate_jsi_JSIInstaller_installBinding(JNIEnv *env, jobject thiz,
                                                                                       jlong runtimePtr) {
    jsi::Runtime *runtime = reinterpret_cast<jsi::Runtime *>(runtimePtr);
    assert(runtime != nullptr);

    pomegranate::platform::configureJNI(env);
    pomegranate::Database::install(*runtime);
}

extern "C" JNIEXPORT void JNICALL Java_com_pomegranate_jsi_JSIInstaller_destroy(JNIEnv *env, jclass clazz) {
    // Cleanup if needed in future
}

// ─── Turbo sync ──────────────────────────────────────────────────────────────

extern "C" JNIEXPORT void JNICALL Java_com_pomegranate_jsi_JSIInstaller_provideSyncJson(JNIEnv *env, jclass clazz,
                                                                                        jint syncJsonId,
                                                                                        jbyteArray json) {
    if (json == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"), "json must not be null");
        return;
    }
    jsize length = env->GetArrayLength(json);
    std::string bytes(static_cast<size_t>(length), '\0');
    env->GetByteArrayRegion(json, 0, length, reinterpret_cast<jbyte *>(bytes.data()));
    pomegranate::syncjson::provide(static_cast<int>(syncJsonId), std::move(bytes));
}

extern "C" JNIEXPORT jboolean JNICALL Java_com_pomegranate_jsi_JSIInstaller_discardSyncJson(JNIEnv *env, jclass clazz,
                                                                                            jint syncJsonId) {
    return pomegranate::syncjson::discard(static_cast<int>(syncJsonId)) ? JNI_TRUE : JNI_FALSE;
}
