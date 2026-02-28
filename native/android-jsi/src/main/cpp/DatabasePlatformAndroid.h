/**
 * PomegranateDB — Android platform declarations.
 */

#pragma once

#include <jni.h>

namespace pomegranate {
namespace platform {

/** Must be called once from JNI before any database operations. */
void configureJNI(JNIEnv *env);

}  // namespace platform
}  // namespace pomegranate
