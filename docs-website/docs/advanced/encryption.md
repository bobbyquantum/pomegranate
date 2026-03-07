---
sidebar_position: 1
title: Encryption
slug: /advanced/encryption
---

# Encryption

PomegranateDB supports encryption at rest through two mechanisms:

## Option 1: EncryptingAdapter (JavaScript-level)

Wraps any adapter with AES-GCM encryption. Records are encrypted/decrypted in JavaScript before being passed to the storage backend.

```ts
import { LokiAdapter, EncryptingAdapter } from 'pomegranate-db';

const adapter = new EncryptingAdapter({
  adapter: new LokiAdapter({ databaseName: 'myapp' }),
  password: 'user-secret',
});
```

**Pros:**
- Works with any adapter (Loki, SQLite, etc.)
- Pure JavaScript — no native dependencies

**Cons:**
- Performance overhead (encryption/decryption in JS)
- Cannot query encrypted columns directly in SQL
- Key management is your responsibility

## Option 2: SQLCipher (via op-sqlite)

Transparent full-database encryption at the SQLite level. The entire database file is encrypted.

```ts
import { SQLiteAdapter } from 'pomegranate-db';
import { createOpSQLiteDriver } from 'pomegranate-db/op-sqlite';

const adapter = new SQLiteAdapter({
  databaseName: 'myapp',
  driver: createOpSQLiteDriver({ encryptionKey: 'your-secret' }),
});
```

**Pros:**
- Transparent — normal SQL queries work on encrypted data
- Fast — encryption happens at the C level
- Industry standard (SQLCipher, AES-256)
- No query limitations

**Cons:**
- Requires `@op-engineering/op-sqlite` (bare RN only)
- Requires native build

## Recommendation

| Scenario | Recommendation |
|----------|---------------|
| Expo project | EncryptingAdapter (no native deps) |
| Bare RN, need encryption | op-sqlite + SQLCipher |
| Performance-critical, lots of queries | SQLCipher |
| Simple key-value encryption | EncryptingAdapter |
