---
sidebar_position: 1
title: Adapters Overview
slug: /adapters/overview
---

# Storage Adapters

PomegranateDB uses a **pluggable adapter** architecture. The adapter handles all database I/O while the rest of PomegranateDB handles schemas, models, queries, sync, and observation.

## Available Adapters

| Adapter | Backend | Speed | Encryption | Use Case |
|---------|---------|-------|-----------|----------|
| **LokiAdapter** | LokiJS (in-memory, optional persistence) | Fast | AES-GCM (JS) | Testing, prototyping, web |
| **SQLiteAdapter** + Expo driver | expo-sqlite | Good | No | Expo projects |
| **SQLiteAdapter** + op-sqlite driver | op-sqlite (JSI) | Very fast | SQLCipher | Bare RN, encryption needed |
| **SQLiteAdapter** + Native JSI driver | C++ SQLite (JSI) | Fastest | No* | Bare RN, max performance |

*The Native JSI adapter uses our own embedded SQLite. Encryption support is planned.

## Architecture

```
┌─────────────────────────────────┐
│  Database / Collection / Model  │  ← Business logic
├─────────────────────────────────┤
│  StorageAdapter interface       │  ← 17 methods
├─────────────────────────────────┤
│  LokiAdapter  │  SQLiteAdapter  │
│               │  ┌────────────┐ │
│               │  │ SQLiteDriver│ │  ← 5 methods
│               │  └─────┬──────┘ │
│               │    ┌───┴───┐    │
│               │   Expo  op-  JSI│
│               │  SQLite sqlite  │
└─────────────────────────────────┘
```

The `SQLiteAdapter` is generic — it generates SQL and delegates execution to a **driver**. Each driver wraps a different SQLite library.

## StorageAdapter Interface

All adapters implement this interface (17 methods):

```ts
interface StorageAdapter {
  initialize(schema: DatabaseSchema): Promise<void>;
  find(table: string, query: QueryDescriptor): Promise<RawRecord[]>;
  count(table: string, query: QueryDescriptor): Promise<number>;
  findById(table: string, id: string): Promise<RawRecord | null>;
  insert(table: string, rawRecord: RawRecord): Promise<void>;
  update(table: string, rawRecord: RawRecord): Promise<void>;
  markAsDeleted(table: string, id: string): Promise<void>;
  destroyPermanently(table: string, id: string): Promise<void>;
  batch(operations: BatchOperation[]): Promise<void>;
  search(table: string, descriptor: SearchDescriptor): Promise<RawRecord[]>;
  getLocalChanges(tables: string[]): Promise<SyncTableChanges>;
  applyRemoteChanges(changes: SyncTableChanges): Promise<void>;
  markAsSynced(table: string, ids: string[]): Promise<void>;
  getSchemaVersion(): Promise<number>;
  migrate(migrations: Migration[]): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}
```

## SQLiteDriver Interface

SQLite drivers implement a simpler 5-method interface:

```ts
interface SQLiteDriver {
  open(name: string): Promise<void>;
  execute(sql: string, bindings?: unknown[]): Promise<void>;
  query(sql: string, bindings?: unknown[]): Promise<Record<string, unknown>[]>;
  executeInTransaction(fn: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
```

The `SQLiteAdapter` handles all SQL generation — drivers just execute raw SQL.

## Choosing an Adapter

- **Just starting out?** Use `LokiAdapter` — zero setup, works everywhere
- **Web app with persistence?** Use `LokiAdapter` with `LokiIndexedAdapter`
- **Expo project?** Use the Expo SQLite driver
- **Need encryption?** Use op-sqlite with SQLCipher
- **Maximum performance?** Use the Native JSI driver (bare RN only)
- **Jest tests?** Always use `LokiAdapter`
