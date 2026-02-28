/**
 * PomegranateDB — Android platform implementation.
 *
 * Provides platform::resolveDatabasePath via JNI callback to Java,
 * and platform::consoleLog/consoleError via Android log.
 */

#include <android/log.h>
#include <cassert>
#include <mutex>
#include <sqlite3.h>

#include "Database.h"
#include "DatabasePlatformAndroid.h"

#define LOG_TAG "pomegranate.jsi"

namespace pomegranate {
namespace platform {

// ─── Logging ─────────────────────────────────────────────────────────────────

void consoleLog(const std::string &message) {
    __android_log_print(ANDROID_LOG_INFO, LOG_TAG, "%s\n", message.c_str());
}

void consoleError(const std::string &message) {
    __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, "%s\n", message.c_str());
}

// ─── SQLite initialization ───────────────────────────────────────────────────

static void sqliteLogCallback(void *, int err, const char *message) {
    int errType = err & 255;
    if (errType == SQLITE_WARNING) {
        __android_log_print(ANDROID_LOG_WARN, LOG_TAG, "sqlite (%d) %s\n", err, message);
    } else if (errType == 0 || errType == SQLITE_CONSTRAINT || errType == SQLITE_SCHEMA || errType == SQLITE_NOTICE) {
        // verbose, skip
    } else {
        __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, "sqlite (%d) %s\n", err, message);
    }
}

std::once_flag sqliteInitFlag;

static void initializeSqlite() {
    std::call_once(sqliteInitFlag, []() {
        sqlite3_config(SQLITE_CONFIG_LOG, &sqliteLogCallback, nullptr);
        sqlite3_soft_heap_limit(8 * 1024 * 1024);
        sqlite3_initialize();
    });
}

// ─── JNI path resolution ────────────────────────────────────────────────────

static JavaVM *jvm = nullptr;

void configureJNI(JNIEnv *env) {
    assert(env);
    if (env->GetJavaVM(&jvm) != JNI_OK) {
        consoleError("PomegranateDB: cannot get JavaVM");
        std::abort();
    }
    assert(jvm);
    initializeSqlite();
}

std::string resolveDatabasePath(const std::string &dbName) {
    JNIEnv *env;
    assert(jvm);
    if (jvm->AttachCurrentThread(&env, nullptr) != JNI_OK) {
        throw std::runtime_error("PomegranateDB: JVM thread attach failed");
    }
    assert(env);

    jclass clazz = env->FindClass("com/pomegranate/jsi/JSIInstaller");
    if (clazz == nullptr) {
        throw std::runtime_error("PomegranateDB: missing JSIInstaller class");
    }

    jmethodID mid = env->GetStaticMethodID(clazz, "_resolveDatabasePath", "(Ljava/lang/String;)Ljava/lang/String;");
    if (mid == nullptr) {
        throw std::runtime_error("PomegranateDB: missing _resolveDatabasePath method");
    }

    jobject jniPath = env->NewStringUTF(dbName.c_str());
    if (jniPath == nullptr) {
        throw std::runtime_error("PomegranateDB: could not construct Java string");
    }

    jstring jniResolvedPath = (jstring)env->CallStaticObjectMethod(clazz, mid, jniPath);
    if (env->ExceptionCheck()) {
        throw std::runtime_error("PomegranateDB: exception resolving database path");
    }

    const char *cResolvedPath = env->GetStringUTFChars(jniResolvedPath, 0);
    if (cResolvedPath == nullptr) {
        throw std::runtime_error("PomegranateDB: failed to get resolved path string");
    }

    std::string resolvedPath(cResolvedPath);
    env->ReleaseStringUTFChars(jniResolvedPath, cResolvedPath);
    return resolvedPath;
}

}  // namespace platform
}  // namespace pomegranate
