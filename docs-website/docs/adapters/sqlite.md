---
sidebar_position: 3
title: SQLite Adapter
slug: /adapters/sqlite
---

# SQLite Adapter

The `SQLiteAdapter` is PomegranateDB's generic SQL adapter. It generates SQL from query descriptors and delegates execution to an injectable **driver**.

## Usage

```ts
import { Database, SQLiteAdapter } from 'pomegranate-db';
import { createExpoSQLiteDriver } from 'pomegranate-db/expo';

const db = new Database({
  adapter: new SQLiteAdapter({
    databaseName: 'myapp',
    driver: createExpoSQLiteDriver(),
  }),
  models: [Post, Comment],
});
```

## How It Works

The SQLiteAdapter:

1. **Generates SQL** from PomegranateDB query descriptors (WHERE, ORDER BY, LIMIT, etc.)
2. **Manages tables** — creates them on init, handles migrations
3. **Handles sync columns** — `_status`, `_changed` are managed automatically
4. **Delegates to the driver** — the driver just runs raw SQL strings

```
QueryDescriptor → SQLiteAdapter → SQL string → SQLiteDriver → Database
```

## Configuration

```ts
interface SQLiteAdapterConfig {
  databaseName: string;
  driver?: SQLiteDriver;       // Choose your SQLite library
  encryption?: EncryptionConfig; // Optional encryption
  schema?: DatabaseSchema;     // Usually auto-derived from models
}
```

## SQL Generation

The adapter generates standard SQLite-compatible SQL:

```sql
-- SELECT
SELECT * FROM posts WHERE status = ? AND view_count > ? ORDER BY created_at DESC LIMIT 20

-- INSERT
INSERT INTO posts (id, title, body, status, _status, _changed) VALUES (?, ?, ?, ?, ?, ?)

-- UPDATE
UPDATE posts SET title = ?, status = ?, _status = 'updated', _changed = ? WHERE id = ?

-- SEARCH
SELECT * FROM posts WHERE (title LIKE ? OR body LIKE ?) AND (title LIKE ? OR body LIKE ?)
```

## Available Drivers

- [Expo SQLite](./expo-sqlite) — for Expo projects
- [op-sqlite](./op-sqlite) — JSI-based, with SQLCipher
- [Native JSI](./native-jsi) — our own C++ SQLite bridge

## Writing a Custom Driver

If you want to use a different SQLite library, implement the `SQLiteDriver` interface:

```ts
interface SQLiteDriver {
  open(name: string): Promise<void>;
  execute(sql: string, bindings?: unknown[]): Promise<void>;
  query(sql: string, bindings?: unknown[]): Promise<Record<string, unknown>[]>;
  executeInTransaction(fn: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
```

Then pass it to `SQLiteAdapter`:

```ts
const adapter = new SQLiteAdapter({
  databaseName: 'myapp',
  driver: myCustomDriver,
});
```
