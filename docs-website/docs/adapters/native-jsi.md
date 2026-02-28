---
sidebar_position: 6
title: Native JSI Adapter
slug: /adapters/native-jsi
---

# Native JSI Adapter

PomegranateDB includes its own C++ SQLite adapter that communicates with JavaScript through React Native's JSI (JavaScript Interface). This is the **fastest** adapter option — zero bridge overhead, zero serialization, direct synchronous calls from JS to C++.

## Architecture

```
JavaScript (NativeSQLiteDriver)
    ↓ JSI (synchronous)
C++ Database Bridge (Database.cpp)
    ↓
C++ SQLite Wrapper (Sqlite.cpp)
    ↓
SQLite Amalgamation (sqlite3.c)
```

All calls are synchronous — no promises at the native level, no async queues. The TypeScript driver wraps them in `Promise` for the `SQLiteDriver` interface.

## Setup (Android)

### 1. Add the native module

The `android-jsi` module is included in the PomegranateDB package. Add it to your project:

**settings.gradle:**
```groovy
include ':pomegranate-jsi'
project(':pomegranate-jsi').projectDir = 
  new File(rootDir, '../node_modules/pomegranate-db/native/android-jsi')
```

**app/build.gradle:**
```groovy
dependencies {
    implementation project(':pomegranate-jsi')
}
```

### 2. Register the package

In your `MainApplication.kt` (or `.java`):

```kotlin
import com.pomegranate.jsi.PomegranateJSIPackage

// In getPackages():
override fun getPackages(): List<ReactPackage> =
    listOf(MainReactPackage(), PomegranateJSIPackage())
```

### 3. Use the driver

```ts
import { Database, SQLiteAdapter } from 'pomegranate-db';
import { createNativeSQLiteDriver } from 'pomegranate-db/native-sqlite';

const db = new Database({
  adapter: new SQLiteAdapter({
    databaseName: 'myapp',
    driver: createNativeSQLiteDriver(),
  }),
  models: [Post, Comment],
});
```

The driver automatically calls `NativeModules.PomegranateJSIBridge.install()` to load the native library and register the JSI binding.

## How it Works

1. **On app startup**, the React Native module `PomegranateJSIBridge.install()` is called
2. This loads `libpomegranate-jsi.so` and calls into JNI
3. The C++ code registers a global function `nativePomegranateCreateAdapter` on the JS runtime
4. When the TypeScript driver calls `open(dbName)`:
   - It calls `global.nativePomegranateCreateAdapter(dbName)`
   - C++ resolves the database path via JNI → `context.getDatabasePath()`
   - Opens the SQLite database with WAL mode, busy timeout, and 8MB cache
   - Returns a JSI object with `execute`, `query`, `executeBatch`, and `close` methods
5. All subsequent calls go directly through JSI — no bridge, no JSON

## Performance

The native JSI adapter is the fastest option because:
- **Synchronous JSI** — no async overhead, no bridge serialization
- **Prepared statement cache** — SQL is compiled once and reused
- **Single-lock threading** — operations are serialized with a mutex for safety
- **SQLite amalgamation** — we bundle SQLite 3.49.1 directly, with optimal compile-time configuration

## SQLite Configuration

The embedded SQLite is configured with these pragmas:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -8000;  -- 8 MB
```

## Limitations

- **Android only** (iOS support planned)
- **No encryption** yet (planned: compile-time SQLCipher option)
- **Bare React Native only** — requires native module registration
- **New Architecture recommended** — optimized for Hermes + JSI
