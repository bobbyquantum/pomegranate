/**
 * PomegranateDB — JNI bridge.
 *
 * Called from Java to install the JSI binding into the JS runtime.
 */

#include <jni.h>
#include <jsi/jsi.h>
#include <cassert>

#include "Database.h"
#include "DatabasePlatformAndroid.h"

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
