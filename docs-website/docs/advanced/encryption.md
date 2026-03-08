---
sidebar_position: 1
title: Encryption
slug: /advanced/encryption
---

# Encryption

PomegranateDB supports encryption at rest in two different ways:

1. `EncryptingAdapter` for application-level field encryption.
2. SQLCipher through `@op-engineering/op-sqlite` for full SQLite file encryption.

Both approaches are valid, but they optimize for different constraints.

## Option 1: `EncryptingAdapter`

`EncryptingAdapter` wraps any storage adapter and encrypts record values before they are written to disk.

```ts
import { LokiAdapter } from 'pomegranate-db';
import { EncryptingAdapter } from 'pomegranate-db/encryption/react-native';

const key = new TextEncoder().encode('0123456789abcdef0123456789abcdef');

const adapter = new EncryptingAdapter(
  new LokiAdapter({ databaseName: 'myapp' }),
  async () => key,
);
```

### How it works

- User columns are encrypted before `insert()`, `update()`, and `batch()` writes reach the underlying adapter.
- Records are decrypted after reads, so your models still work with plain values in application code.
- `id`, `_status`, and `_changed` remain plaintext because PomegranateDB needs them for identity and sync bookkeeping.

### What this means in practice

- It works with any adapter, including Loki and SQLite-backed adapters.
- Queries and full-text search only work on columns that remain plaintext.
- Sync payloads are decrypted before they leave the adapter, so your server still sees normal raw records unless you add your own transport encryption on top.

### Runtime-specific imports

- React Native / Expo: `pomegranate-db/encryption/react-native`
- Browser / Web Crypto runtime: `pomegranate-db/encryption`
- Node.js without `globalThis.crypto.subtle`: `pomegranate-db/encryption/node`

Node example:

```ts
import { LokiAdapter } from 'pomegranate-db';
import { EncryptingAdapter } from 'pomegranate-db/encryption/node';
import { nodeCryptoProvider } from 'pomegranate-db/encryption/node';

const key = Buffer.from('0123456789abcdef0123456789abcdef');

const adapter = new EncryptingAdapter(
  new LokiAdapter({ databaseName: 'server-cache' }),
  async () => new Uint8Array(key),
  nodeCryptoProvider,
);
```

### Key management checklist

- Use a 32-byte key for AES-256-GCM.
- Load the key from platform-secure storage such as Keychain, Keystore, or your own protected secret source.
- Do not hardcode production keys in source control.
- Treat a missing or invalid key as a startup failure, not as a signal to silently create a new database.
- Plan rotation up front. PomegranateDB does not yet ship a one-call re-key API for `EncryptingAdapter`.

### Limits and caveats

- You cannot reliably filter, sort, or search on encrypted user columns.
- The first open after reinstall or restore must use the same key, or decryption will fail.
- Large datasets pay a JavaScript-side encryption/decryption cost on every read and write.

## Option 2: SQLCipher via `op-sqlite`

If you are building a bare React Native app and want encrypted SQLite with normal query behavior, use SQLCipher through `@op-engineering/op-sqlite`.

```ts
import { SQLiteAdapter } from 'pomegranate-db';
import { createOpSQLiteDriver } from 'pomegranate-db/op-sqlite';

const adapter = new SQLiteAdapter({
  databaseName: 'myapp',
  driver: createOpSQLiteDriver({
    encryptionKey: 'your-secret',
  }),
});
```

### Why choose SQLCipher

- The whole SQLite file is encrypted at rest.
- Queries, ordering, joins, and indexes continue to work normally.
- Encryption happens in native code, so it is usually a better fit for larger datasets.

### Requirements

- `@op-engineering/op-sqlite` must be installed in the consuming app.
- Your native build needs SQLCipher-enabled `op-sqlite` support.
- This path is for bare React Native apps, not Expo Go.

## Choosing between them

| Scenario | Best fit |
| --- | --- |
| Expo app or adapter-agnostic library code | `EncryptingAdapter` |
| Bare React Native app with heavy query usage | `op-sqlite` + SQLCipher |
| Need one encryption approach across Loki and SQLite | `EncryptingAdapter` |
| Need indexed queries over protected local data | SQLCipher |

## Recommended decision rule

- Choose `EncryptingAdapter` when portability matters more than query flexibility.
- Choose SQLCipher when encrypted SQLite is a hard requirement and you control the native app build.

## Rotation and migration strategy

If you need key rotation today, treat it as a migration:

1. Open the database with the old key.
2. Read and export the records you need.
3. Recreate or rewrite the local database with the new key.
4. Verify reads before deleting the old data.

That sounds heavyweight, but it keeps rotation explicit and testable until a dedicated re-key API exists.

## Testing checklist

- Verify that opening with the expected key succeeds.
- Verify that opening with a wrong key fails loudly.
- Exercise the queries you rely on most, especially if you use `EncryptingAdapter`.
- Run at least one sync round-trip if the encrypted database participates in sync.
