PROJECT(pomegranate-jsi C CXX)
cmake_minimum_required(VERSION 3.13)

# ─── Path resolution ──────────────────────────────────────────────────────────
# This CMakeLists.txt lives at:
#   native/android-jsi/src/main/cpp/CMakeLists.txt          (dev / source repo)
#   node_modules/pomegranate-db/native/android-jsi/src/main/cpp/  (installed)
#
# In dev:       5 levels up  → repo root  → node_modules/react-native
# In installed: 7 levels up  → consumer app root → node_modules/react-native

set(SHARED_PATH ../../../../shared/)
set(SQLITE_PATH ../../../../shared/sqlite3/)

# Auto-detect react-native location (dev vs installed-in-node_modules)
foreach(candidate
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules/react-native"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../../node_modules/react-native"
)
  if(EXISTS "${candidate}/ReactCommon/jsi/jsi/jsi.h")
    set(REACT_NATIVE_ROOT "${candidate}")
    break()
  endif()
endforeach()

if(NOT REACT_NATIVE_ROOT)
  message(FATAL_ERROR
    "pomegranate-jsi: Cannot find react-native.\n"
    "Looked at 5 and 7 parent directories from ${CMAKE_CURRENT_SOURCE_DIR}.\n"
    "Ensure react-native is installed in your project's node_modules.")
endif()

message(STATUS "pomegranate-jsi: react-native found at ${REACT_NATIVE_ROOT}")

# ─── Header search paths ─────────────────────────────────────────────────────

include_directories(
        ${SHARED_PATH}
        ${SQLITE_PATH}
        ${REACT_NATIVE_ROOT}/React
        ${REACT_NATIVE_ROOT}/React/Base
        ${REACT_NATIVE_ROOT}/ReactCommon
        ${REACT_NATIVE_ROOT}/ReactCommon/jsi
)

# ─── Build configuration ─────────────────────────────────────────────────────

set(CMAKE_CXX_FLAGS_DEBUG "-O2")
set(CMAKE_CXX_FLAGS_RELEASE "-O2")

# ─── Source files ─────────────────────────────────────────────────────────────

file(GLOB ANDROID_JSI_SRC_FILES ./*.cpp)
file(GLOB SHARED_SRC_FILES ${SHARED_PATH}/*.cpp)

add_library(pomegranate-jsi SHARED
        # SQLite amalgamation
        ${SQLITE_PATH}/sqlite3.c
        # Our shared C++ sources
        ${SHARED_SRC_FILES}
        # Android-specific JNI sources
        ${ANDROID_JSI_SRC_FILES}
        # JSI implementation (needed for linking)
        ${REACT_NATIVE_ROOT}/ReactCommon/jsi/jsi/jsi.cpp
)

# Enable Android 16kb native library alignment (required for modern Android)
target_link_options(pomegranate-jsi PRIVATE "-Wl,-z,max-page-size=16384")

target_link_libraries(pomegranate-jsi
        android
        log
)
