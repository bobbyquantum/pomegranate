---
sidebar_position: 10
title: Sync
slug: /sync
---

# Sync

PomegranateDB includes a built-in pull/push sync protocol that is compatible with the Watermelon-style backend shape while staying small enough to wire into a custom API.

## Overview

The sync cycle follows a **push-first** strategy:

1. **Push** local changes to the server
2. **Pull** remote changes from the server
3. **Apply** remote changes locally (in a transaction)
4. **Mark** pushed records as synced

Push-first minimizes conflicts — the server sees your changes before you pull theirs.

PomegranateDB also persists a `lastPulledAt` checkpoint in adapter metadata so each sync can request only incremental changes.

## Usage

```ts
import { performSync } from 'pomegranate-db';

await performSync(db, {
  pushChanges: async ({ changes, lastPulledAt }) => {
    await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes, lastPulledAt }),
    });
  },

  pullChanges: async ({ lastPulledAt, schemaVersion }) => {
    const response = await fetch('/api/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastPulledAt, schemaVersion }),
    });

    return response.json();
    // Expected: { changes: { posts: { created: [], updated: [], deleted: [] } }, timestamp }
  },

  onConflict: (local, remote) => ({
    ...remote,
    // Keep the locally edited title, but take the remote server fields.
    title: local.title,
  }),
});
```

## What `performSync()` Does

For each call, the sync engine:

1. Reads the last successful pull timestamp from metadata.
2. Collects local created, updated, and deleted records from the adapter.
3. Sends local changes to `pushChanges()` if there is anything to push.
4. Calls `pullChanges()` with the previous checkpoint.
5. Resolves update conflicts with `onConflict()` when provided.
6. Applies remote changes through the adapter.
7. Stores the new `timestamp` from the pull response as the next checkpoint.

If there are no local changes, the push step is skipped. If there are no remote changes, no remote apply work is done.

## API Shape

```ts
interface SyncPullResult {
  changes: {
    [tableName: string]: {
      created: RawRecord[];
      updated: RawRecord[];
      deleted: string[];
    };
  };
  timestamp: number;
}

interface SyncPushPayload {
  changes: {
    [tableName: string]: {
      created: RawRecord[];
      updated: RawRecord[];
      deleted: string[];
    };
  };
  lastPulledAt: number;
}

interface SyncConfig {
  pullChanges: (params: { lastPulledAt: number | null }) => Promise<SyncPullResult>;
  pushChanges: (params: SyncPushPayload) => Promise<void>;
  onConflict?: (local: RawRecord, remote: RawRecord) => RawRecord;
  tables?: string[];
}
```

### Important Details

- `pullChanges()` receives `lastPulledAt: number | null`. The first sync passes `null`.
- `pushChanges()` always receives a number. On the first sync, PomegranateDB sends `0` when no checkpoint exists yet.
- `tables` lets you limit which local tables participate in a sync. If your backend also supports partial sync, capture the same table list in your own `pullChanges()` and `pushChanges()` closures.
- Pushed records are sanitized before they are sent: `_status` is normalized to `synced` and `_changed` is cleared.

## Sync Columns

Every synced table has these columns (added automatically):

| Column | Purpose |
|--------|---------|
| `_status` | `synced`, `created`, `updated`, or `deleted` |
| `_changed` | Comma-separated list of locally changed columns |

When you create a record, `_status` is set to `created`. When you update it, `_status` becomes `updated` and `_changed` tracks which fields changed. After a successful sync push, `_status` returns to `synced`.

## Pull Response Format

Your backend should return:

```ts
interface SyncPullResult {
  changes: {
    [tableName: string]: {
      created: RawRecord[];
      updated: RawRecord[];
      deleted: string[];
    };
  };
  timestamp: number;
}
```

`timestamp` should be the server-side checkpoint that the client should send back on the next pull.

## Push Payload Format

PomegranateDB sends:

```ts
interface SyncPushPayload {
  changes: {
    [tableName: string]: {
      created: RawRecord[];
      updated: RawRecord[];
      deleted: string[];
    };
  };
  lastPulledAt: number;
}
```

This lets the server validate whether the client is pushing changes against an old snapshot and decide how strict it wants to be.

## Turbo Sync (first sync, native import)

A fresh install of a large app can have to pull tens of megabytes of reference data before it is usable. Going through `JSON.parse` and one adapter call per row makes the JS thread the bottleneck, and on Hermes that shows up as a frozen splash screen.

Turbo sync hands the whole payload to the adapter instead. On `pomegranate-db/native-sqlite` the payload is parsed in C++ with [simdjson](https://simdjson.org) and written into SQLite inside one transaction — the JS runtime never sees a single record.

```ts
import { performSync } from 'pomegranate-db';

await performSync(db, {
  unsafeTurbo: true,
  pullChanges: async ({ schemaVersion }) => {
    const response = await fetch(`/api/sync/bundle?schema_version=${schemaVersion}`);
    // The payload is the normal pull response, just kept as text.
    return { syncJson: await response.text() };
  },
  pushChanges: async () => {},
});
```

### Skipping JS entirely

For the fastest path, download and decompress the bundle in a native module and hand the bytes to PomegranateDB directly. Then `pullChanges` only returns the id you chose:

```swift
// iOS — Swift, via the app's bridging header
// #import <PomegranateDB/PomegranateSyncJson.h>
var error: NSError?
pomegranateProvideSyncJson(syncJsonId, jsonData, &error)
```

```kotlin
// Android — Kotlin
import com.pomegranate.jsi.PomegranateSyncJson
PomegranateSyncJson.provide(syncJsonId, jsonBytes)
```

```ts
await performSync(db, {
  unsafeTurbo: true,
  pullChanges: async () => ({ syncJsonId }),
  pushChanges: async () => {},
});
```

From JS the same store is reachable with `provideSyncJson(id, text)` from `pomegranate-db/native-sqlite`, which is handy in tests.

### Rules

- **First sync only.** Turbo replaces local state, it does not merge. `performSync` throws if `lastPulledAt` is already set or if there are unsynced local changes. Call `db.reset()` before re-running it.
- **`pushChanges` is not called.**
- **Same payload shape** as a regular pull: `{ changes: { table: { created, updated, deleted } }, timestamp }`. `created` and `updated` are both written with `INSERT OR REPLACE`; `deleted` ids are removed.
- **Schema filtering.** Tables the database does not know are ignored and columns the schema does not declare are dropped. Both are counted in `SyncLog.turbo` (`skippedTables`, `skippedColumns`) and logged as a warning.
- **Nested values** (objects/arrays in a column) are stored as their JSON text.
- **Other adapters** (`LokiAdapter`, expo-sqlite, op-sqlite) accept `{ syncJson }` and fall back to `JSON.parse` + `applyRemoteChanges`, so the same app code works everywhere; only `{ syncJsonId }` needs the native driver.

The import statistics are available on the sync log:

```ts
db.syncLog$.subscribe((log) => {
  if (log?.turbo) console.log(`imported ${log.turbo.inserted} rows into ${log.turbo.tables} tables`);
});
```

### Benchmark

`npm run bench:turbo` builds a host binary (`native/bench/turbo_bench`) that imports a payload into SQLite with the same C++ used on device, and `native/bench/gen-bundle.mjs` generates a synthetic payload shaped like any WatermelonDB-style `schema.ts`. On an Apple Silicon Mac, a 97-table, 150,000-row, 53 MB payload imports in about 0.7 s; the current JS adapter path takes about 1.7 s in Node, and Hermes is considerably slower than V8 at both parsing and per-call overhead.

## Conflict Resolution

When a record is updated both locally and remotely during the same sync window, you can provide `onConflict(local, remote)` to merge them.

```ts
await performSync(db, {
  pushChanges,
  pullChanges,
  onConflict: (local, remote) => {
    return {
      ...remote,
      title: local.title,
      notes: `${remote.notes ?? ''}\n${local.notes ?? ''}`.trim(),
    };
  },
});
```

### Conflict Semantics

- Without `onConflict`, the remote updated record wins.
- With `onConflict`, PomegranateDB passes the locally modified record snapshot and the incoming remote record to your handler.
- Your handler must return the raw record that should be written locally.
- The resolved record is stored as synced after the merge.
- Conflict handling currently applies to remote `updated` records. Remote deletes are applied as-is.

### Recommended Strategies

- Keep server-authoritative fields from `remote` such as moderation state or version counters.
- Keep user-authored text fields from `local` when the device should win for drafts.
- Merge field-by-field instead of choosing a whole-record winner when possible.
- Make conflict handlers deterministic so retries do not produce different results.

## Configuration

```ts
interface SyncConfig {
  pullChanges: (params: { lastPulledAt: number | null }) => Promise<SyncPullResult>;
  pushChanges: (params: SyncPushPayload) => Promise<void>;
  onConflict?: (local: RawRecord, remote: RawRecord) => RawRecord;
  tables?: string[];
}
```

## Backend Checklist

- If you support partial sync, use the same table list your client passes into `performSync({ tables })` when building the request in your callback.
- Ensure `timestamp` is monotonic for a given dataset.
- Treat `deleted` as tombstone IDs, not full records.
- Make `pushChanges()` idempotent or safely retryable when possible.
- Validate incoming records before applying them to the server.

## Client Tips

- Debounce sync calls instead of syncing after every write.
- Trigger sync when the app returns to the foreground or when connectivity changes.
- Log the last successful `timestamp` on your backend for debugging incremental sync bugs.
- Test `onConflict()` with real records, not just happy-path mocks.

## Tips

- **Debounce syncs** — don't call `performSync()` on every write.
- **Handle network errors** — retry with backoff around your transport layer.
- **Test empty pulls** — make sure your backend still returns a valid `timestamp` even when there are no changes.
- **Keep payloads stable** — match table names and raw record shapes exactly between client and server.
