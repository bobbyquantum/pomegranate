PROJECT(pomegranate-jsi C CXX)
cmake_minimum_required(VERSION 3.13)

# ─── Path resolution ──────────────────────────────────────────────────────────
# node_modules is at the workspace root from this CMakeLists.txt
# This CMakeLists.txt is at: native/android-jsi/src/main/cpp/CMakeLists.txt
# Workspace root is 5 levels up:
#   cpp -> main -> src -> android-jsi -> native -> pomegranate

set(WORKSPACE_ROOT ../../../../..)
set(NODE_MODULES_PATH ${WORKSPACE_ROOT}/node_modules)
set(SHARED_PATH ../../../../shared/)
set(SQLITE_PATH ../../../../shared/sqlite3/)

# ─── Header search paths ─────────────────────────────────────────────────────

include_directories(
        ${SHARED_PATH}
        ${SQLITE_PATH}
        ${NODE_MODULES_PATH}/react-native/React
        ${NODE_MODULES_PATH}/react-native/React/Base
        ${NODE_MODULES_PATH}/react-native/ReactCommon
        ${NODE_MODULES_PATH}/react-native/ReactCommon/jsi
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
        ${NODE_MODULES_PATH}/react-native/ReactCommon/jsi/jsi/jsi.cpp
)

# Enable Android 16kb native library alignment (required for modern Android)
target_link_options(pomegranate-jsi PRIVATE "-Wl,-z,max-page-size=16384")

target_link_libraries(pomegranate-jsi
        android
        log
)
