---
sidebar_position: 12
title: Architecture
slug: /architecture
---

# Architecture

An overview of PomegranateDB's internal architecture.

## Layer Diagram

```
┌──────────────────────────────────────────────┐
│                React Hooks                    │
│  useLiveQuery · useById · useSearch · useCount│
├──────────────────────────────────────────────┤
│              Database                         │
│  Writer queue · Model registry · Events       │
├──────────────────────────────────────────────┤
│           Collection                          │
│  create · findById · query · search · observe │
├──────────────────────────────────────────────┤
│         QueryBuilder                          │
│  where · orderBy · limit · and/or/not         │
├──────────────────────────────────────────────┤
│        StorageAdapter (17 methods)            │
│  initialize · find · count · batch · sync...  │
├─────────────────────┬────────────────────────┤
│    LokiAdapter      │    SQLiteAdapter       │
│    (in-memory)      │    (SQL generation)    │
│                     │    ┌──────────────┐    │
│                     │    │ SQLiteDriver  │    │
│                     │    └──────┬───────┘    │
│                     │  Expo ─ op-sqlite ─ JSI│
├─────────────────────┴────────────────────────┤
│         Observable System                     │
│  Subject · BehaviorSubject · SharedObservable │
├──────────────────────────────────────────────┤
│            Schema / Model                     │
│  m.model · m.text · m.belongsTo · Model<S>   │
├──────────────────────────────────────────────┤
│           Sync Engine                         │
│  performSync · push-first · conflict resolve  │
└──────────────────────────────────────────────┘
```

## Key Design Decisions

### Schema-First, No Decorators

Unlike WatermelonDB which uses decorators (`@field`, `@text`, `@relation`), PomegranateDB uses a builder pattern:

```ts
// PomegranateDB — schema-first
const PostSchema = m.model('posts', {
  title: m.text(),
  author: m.belongsTo('users', { key: 'author_id' }),
});

class Post extends Model<typeof PostSchema> {
  static schema = PostSchema;
}
```

This means:
- No Babel decorator transform needed
- Types flow naturally from schema to model
- The schema is a plain frozen object — serializable and inspectable

### Injectable SQLite Drivers

The SQLiteAdapter doesn't depend on any specific SQLite library. Instead, it takes a **driver** that implements 5 methods:

```ts
interface SQLiteDriver {
  open(name: string): Promise<void>;
  execute(sql: string, bindings?: unknown[]): Promise<void>;
  query(sql: string, bindings?: unknown[]): Promise<Record<string, unknown>[]>;
  executeInTransaction(fn: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
```

This allows wrapping any SQLite library (expo-sqlite, op-sqlite, better-sqlite3, sql.js, etc.) with a thin adapter.

### Synchronous JSI Bridge

The Native JSI adapter (`native/shared/Database.cpp`) installs a global function via JSI:

```
global.nativePomegranateCreateAdapter(dbName) → { execute, query, executeBatch, close }
```

All methods on the returned object are synchronous C++ calls. The TypeScript driver wraps them in Promises for the SQLiteDriver interface, but there is zero async overhead at the native level.

### Observable-Based Reactivity

PomegranateDB uses its own lightweight observable system rather than RxJS:

- `Subject<T>` — emit values to multiple subscribers
- `BehaviorSubject<T>` — remembers and replays the latest value
- `SharedObservable<T>` — shared subscription with automatic cleanup

This keeps the bundle small and avoids the RxJS dependency.

### Writer Queue

All mutations go through `db.write()`, which serializes them through a single queue:

```ts
await db.write(async () => {
  // Only one writer can be active at a time
});
```

This prevents data races and ensures database consistency without manual locking.

## C++ Architecture (Native JSI)

```
native/shared/
  Sqlite.h / .cpp      — RAII SQLite wrapper (SqliteDb, SqliteStatement)
  Database.h / .cpp     — JSI bridge (statement cache, arg binding, row conversion)

native/android-jsi/
  src/main/java/        — Java: PomegranateJSIModule, JSIInstaller, PomegranateJSIPackage
  src/main/cpp/         — JNI bridge, Android platform (path resolution, logging)
                          CMakeLists.txt (builds libpomegranate-jsi.so)
```

The C++ code:
1. Opens SQLite with optimal pragmas (WAL, NORMAL sync, 8MB cache)
2. Caches prepared statements for repeated queries
3. Binds JSI values to SQLite parameters (null, bool, int64, double, text)
4. Converts SQLite result rows to JSI objects
5. Runs batch operations in a single transaction with ROLLBACK on failure
