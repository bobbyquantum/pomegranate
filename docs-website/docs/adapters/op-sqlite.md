---
sidebar_position: 5
title: op-sqlite Driver
slug: /adapters/op-sqlite
---

# op-sqlite Driver

The op-sqlite driver wraps [`@op-engineering/op-sqlite`](https://github.com/nicoBorgiolli/op-sqlite) for use with PomegranateDB. It provides JSI-based synchronous SQLite access with optional SQLCipher encryption.

## Installation

```bash
npm install @op-engineering/op-sqlite
```

On iOS, run `npx pod-install` after installation.

## Usage

```ts
import { Database, SQLiteAdapter } from 'pomegranate-db';
import { createOpSQLiteDriver } from 'pomegranate-db/op-sqlite';

const db = new Database({
  adapter: new SQLiteAdapter({
    databaseName: 'myapp',
    driver: createOpSQLiteDriver(),
  }),
  models: [Post, Comment],
});
```

## With Encryption (SQLCipher)

op-sqlite supports SQLCipher for transparent database encryption:

```ts
const driver = createOpSQLiteDriver({
  encryptionKey: 'your-secret-key',
});
```

This encrypts the entire database file — not just individual records. The key must be provided every time the database is opened.

## Configuration

```ts
interface OpSQLiteDriverConfig {
  /** SQLCipher encryption key */
  encryptionKey?: string;
  /** Custom database file location */
  location?: string;
  /** Callback when a table changes (for reactive queries) */
  onTableChanged?: (params: { table: string; operation: string }) => void;
}
```

## Features

- **JSI synchronous execution** — no bridge overhead, direct JS ↔ C++ calls
- **SQLCipher encryption** — AES-256 full-database encryption
- **WAL mode** — enabled by default for concurrent reads
- **Busy timeout** — 5-second default to handle concurrent access
- **Update hooks** — get notified when tables change
- **Lazy loading** — `@op-engineering/op-sqlite` is not required at import time

## When to Use

- **Need encryption** — SQLCipher is the gold standard for mobile SQLite encryption
- **Bare React Native** — works on bare RN projects (iOS + Android)
- **Performance-sensitive** — JSI calls are significantly faster than bridge calls
- **Reactive features** — update hooks enable efficient change notifications

## Limitations

- Requires a bare React Native project (not Expo managed without dev client)
- Peer dependency on `@op-engineering/op-sqlite` must be installed by the consumer
- iOS requires CocoaPods (`npx pod-install`)
