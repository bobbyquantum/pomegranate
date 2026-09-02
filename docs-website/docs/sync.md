---
sidebar_position: 10
title: Sync
slug: /sync
---

# Sync

PomegranateDB includes a built-in pull/push sync engine compatible with the WatermelonDB backend protocol, while staying small enough to wire into a custom API.

## Overview

A sync cycle pulls changes from the server and pushes local changes to it. Two orderings are available:

**Pull-first** (`pullFirst: true`) — WatermelonDB's order, and what a server implementing its protocol expects:

1. **Pull** remote changes from the server
2. **Apply** them locally in one transaction, merging with pending local edits — locally changed columns win, everything else comes from the server
3. **Persist** the new `lastPulledAt` checkpoint
4. **Push** the local changes (now carrying the merged server values) with `lastPulledAt` set to the new checkpoint
5. **Mark** the pushed records as synced — only those that were not edited again while the push was in flight

**Push-first** (the default, kept for backwards compatibility):

1. **Push** local changes to the server and mark them synced
2. **Pull** remote changes
3. **Apply** them locally
4. **Persist** `lastPulledAt`

The trade-offs: pull-first lets the merge see your edits before they are pushed, so the `_changed`-aware resolution below actually runs; the cost is that a push which fails after a successful pull leaves the pulled data applied and the checkpoint advanced — the local changes simply stay unsynced and go out on the next cycle. Push-first shows the server your changes before you take theirs, but every locally edited record has already been marked synced when remote changes are applied, so a remote update to the same record overwrites it.

PomegranateDB persists `lastPulledAt` (and the schema version it pulled with) in adapter metadata so each sync requests only incremental changes.

## Usage

```ts
import { performSync } from 'pomegranate-db';

await performSync(db, {
  pullFirst: true,
  migrationsEnabledAtVersion: 1,

  pullChanges: async ({ lastPulledAt, schemaVersion, migration }) => {
    const params = new URLSearchParams({
      last_pulled_at: String(lastPulledAt ?? 0),
      schema_version: String(schemaVersion),
      migration: migration ? JSON.stringify(migration) : '',
    });
    const response = await fetch(`/sync?${params}`);
    return response.json();
    // Expected: { changes: { posts: { created: [], updated: [], deleted: [] } }, timestamp }
  },

  pushChanges: async ({ changes, lastPulledAt }) => {
    const response = await fetch('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes, lastPulledAt }),
    });
    if (!response.ok) throw new Error(`push failed: ${response.status}`);
  },
});
```

`db.sync(config)` does the same and additionally feeds `db.syncState$` / `db.syncLog$` and the `sync_*` database events.

## Configuration

```ts
interface SyncConfig {
  pullChanges: (params: SyncPullParams) => Promise<SyncPullResult | TurboSyncSource>;
  pushChanges: (params: SyncPushPayload) => Promise<void | SyncPushResult>;
  pullFirst?: boolean;                 // WatermelonDB order; default false
  migrationsEnabledAtVersion?: number; // enables the `migration` pull argument
  sendCreatedAsUpdated?: boolean;      // push created records in `updated`
  onConflict?: (local: RawRecord, merged: RawRecord) => RawRecord;
  tables?: string[];                   // limit which local tables take part
  log?: Partial<SyncLog>;              // mutated in place with progress
  unsafeTurbo?: boolean;               // first-sync native import, see below
}

interface SyncPullParams {
  lastPulledAt: number | null;  // null on the first sync
  schemaVersion: number;
  migration: { from: number; tables: string[]; columns: { table: string; columns: string[] }[] } | null;
}

interface SyncPullResult {
  changes: { [table: string]: { created: RawRecord[]; updated: RawRecord[]; deleted: string[] } };
  timestamp: number;
}

interface SyncPushPayload {
  changes: { [table: string]: { created: RawRecord[]; updated: RawRecord[]; deleted: string[] } };
  lastPulledAt: number;
}

interface SyncPushResult {
  rejectedIds?: Record<string, string[]>;             // { table: [id, …] }
  experimentalRejectedIds?: Record<string, string[]>; // WatermelonDB alias
}
```

### Important Details

- `pullChanges()` receives `lastPulledAt: number | null`. The first sync passes `null`.
- `pushChanges()` always receives a number. In pull-first mode it is the checkpoint the pull just returned; in push-first mode it is the previous checkpoint, or `0` on the first sync.
- `pushChanges()` may return `{ rejectedIds }` (or WatermelonDB's `experimentalRejectedIds`). Rejected records stay unsynced and are pushed again next time.
- `tables` limits which local tables are pushed and checked for changes. Remote changes are applied to every table the database knows; if your backend supports partial sync, capture the same table list in your own `pullChanges()` closure.
- Pushed records are sanitized before they are sent: `_status` is normalized to `synced` and `_changed` is cleared. With `sendCreatedAsUpdated`, records created locally are sent in `updated` instead of `created`.
- Pull payloads are **filtered to the schema** before they are applied: tables the database does not know are ignored, columns the schema does not declare are dropped, booleans are stored as `0`/`1` and nested objects as JSON text. Counts are logged as a warning and `SyncLog.remoteChangeCount` reflects what was kept.

## Sync Columns

Every synced table has these columns (added automatically):

| Column | Purpose |
|--------|---------|
| `_status` | `synced`, `created`, `updated`, or `deleted` |
| `_changed` | Comma-separated list of locally changed columns |

When you create a record, `_status` is set to `created`. When you update it, `_status` becomes `updated` and `_changed` tracks which columns changed. After a successful sync push, `_status` returns to `synced`.

## Merge Semantics

Remote changes are applied by the adapter in one transaction, resolving each record against the local row the way WatermelonDB does:

| Local row | Remote `created` / `updated` | Remote `deleted` |
|-----------|------------------------------|------------------|
| does not exist | inserted as `synced` | ignored |
| `synced` | overwritten as `synced` | removed |
| `updated` | **merged**: server values for every column except those in `_changed`; `_status` and `_changed` are kept so the edit is still pushed | removed |
| `created` (id collision) | merged like `updated`; a warning is logged | removed |
| `deleted` | ignored — the local delete is pushed | removed |

The lookup of local state happens once per table in chunks of at most 500 ids, so large payloads do not turn into one query per row.

Under push-first ordering the local edits have already been pushed and marked synced when the pull is applied, so in practice remote records overwrite. Use `pullFirst: true` to get the merge.

### `onConflict`

`onConflict(local, merged)` is an optional override on top of the built-in merge. It is called for every record that is edited locally **and** present in the pull, with the local record as it was before the pull and the record the merge would otherwise write. Return the record to store; its `_status`/`_changed` are managed for you.

```ts
await performSync(db, {
  pullFirst: true,
  pullChanges,
  pushChanges,
  onConflict: (local, merged) => ({
    ...merged,
    notes: `${merged.notes ?? ''}\n${local.notes ?? ''}`.trim(),
  }),
});
```

- In pull-first mode the result keeps the local `_status`/`_changed`, is pushed in the same cycle and marked synced afterwards.
- In push-first mode the local edit has already been pushed, so `merged` is simply the remote record and the result is stored as `synced`.
- Records the server deleted are removed without consulting `onConflict`.
- Make handlers deterministic so retries do not produce different results.

## Migration-aware Pulls

After a schema upgrade the device has new tables (empty) and new columns (at their defaults). WatermelonDB's protocol solves this with a `migration` argument on the pull: the server sends full snapshots of the listed tables and columns regardless of `lastPulledAt`. PomegranateDB builds it from `DatabaseConfig.migrations` when `migrationsEnabledAtVersion` is set:

- `migrationsEnabledAtVersion` unset → `migration: null`, always.
- First sync (`lastPulledAt === null`) → `migration: null`; the server sends everything anyway.
- Otherwise `from` is the schema version recorded by the last successful pull (`pomegranate_last_pulled_schema_version` in adapter metadata, written after every regular and turbo pull). If nothing was recorded — the install synced before you enabled this — `from` is assumed to be `migrationsEnabledAtVersion`.
- `from === schemaVersion` → `migration: null`.
- `from < schemaVersion` → `{ from, tables, columns }` where `tables` are the tables created by the migrations between the two versions and `columns` the columns added to pre-existing tables (columns of newly created tables are covered by the table snapshot and omitted). Any gap in that migration chain fails the sync with `Missing migrations between schema versions X and Y — cannot sync`.
- `from > schemaVersion` → the sync fails; downgrades are not supported.

`migrationSyncInfo(migrations, from, to)` and `resolveMigrationChain(migrations, from, to)` are exported if you want to compute or validate this yourself.

## Helpers

```ts
import { hasUnsyncedChanges, getLastPulledAt, getLastPulledSchemaVersion } from 'pomegranate-db';

if (await hasUnsyncedChanges(db)) { /* warn before logging out */ }
await hasUnsyncedChanges(db, ['tasks']);  // limit to some tables
```

## Sync Log

`db.syncLog$` (and the `log` option) expose a `SyncLog`:

```ts
interface SyncLog {
  startedAt: number;
  finishedAt?: number;
  state: 'idle' | 'pulling' | 'pushing' | 'applying' | 'complete' | 'error';
  phase?: string;                    // human-readable: 'pulling remote changes', 'done', 'failed: …'
  lastPulledAt?: number | null;      // checkpoint the cycle started from
  newLastPulledAt?: number;          // checkpoint returned by this pull (also `pullTimestamp`)
  lastPulledSchemaVersion?: number;
  migration?: SyncMigrationInfo | null;
  remoteChangeCount?: number;
  localChangeCount?: number;
  pushedTables?: string[];
  rejectedIds?: Record<string, string[]>;
  resolvedConflicts?: number;        // onConflict invocations
  turbo?: TurboSyncResult;           // turbo import statistics
  error?: string;
}
```

Pass `log: {}` in the config to have the same object mutated in place as the cycle progresses — handy for attaching to error reports:

```ts
const log: Partial<SyncLog> = {};
try {
  await performSync(db, { log, pullFirst: true, pullChanges, pushChanges });
} catch (error) {
  reportError(error, { sync: log });
}
```

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
- **Schema filtering.** Tables the database does not know are ignored and columns the schema does not declare are dropped — the same filter the regular path applies. Both are counted in `SyncLog.turbo` (`skippedTables`, `skippedColumns`) and logged as a warning.
- **Nested values** (objects/arrays in a column) are stored as their JSON text.
- **Other adapters** (`LokiAdapter`, expo-sqlite, op-sqlite) accept `{ syncJson }` and fall back to `JSON.parse` + `applyRemoteChanges`, so the same app code works everywhere; only `{ syncJsonId }` needs the native driver.
- The pull's `migration` argument is always `null` (it is a first sync), and `lastPulledSchemaVersion` is recorded afterwards like any other pull.

The import statistics are available on the sync log:

```ts
db.syncLog$.subscribe((log) => {
  if (log?.turbo) console.log(`imported ${log.turbo.inserted} rows into ${log.turbo.tables} tables`);
});
```

### Benchmark

`npm run bench:turbo` builds a host binary (`native/bench/turbo_bench`) that imports a payload into SQLite with the same C++ used on device, and `native/bench/gen-bundle.mjs` generates a synthetic payload shaped like any WatermelonDB-style `schema.ts`. On an Apple Silicon Mac, a 97-table, 150,000-row, 53 MB payload imports in about 0.7 s; the current JS adapter path takes about 1.7 s in Node, and Hermes is considerably slower than V8 at both parsing and per-call overhead.

## Backend Checklist

- Implement WatermelonDB's endpoints: `GET /sync?last_pulled_at=&schema_version=&migration=` returning `{ changes, timestamp }`, and `POST /sync` taking `{ changes, lastPulledAt }`. Use `pullFirst: true` with such a server.
- If you support partial sync, use the same table list your client passes into `performSync({ tables })` when building the request in your callback.
- Ensure `timestamp` is monotonic for a given dataset.
- Treat `deleted` as tombstone IDs, not full records.
- Honour `migration` by returning full snapshots of the listed tables and columns.
- Make `pushChanges()` idempotent or safely retryable when possible, and report records you refuse via `rejectedIds`.
- Validate incoming records before applying them to the server.

## Client Tips

- Debounce sync calls instead of syncing after every write.
- Trigger sync when the app returns to the foreground or when connectivity changes.
- Keep a `log` object per cycle and attach it to error reports.
- Test `onConflict()` and the built-in merge with real records, not just happy-path mocks.
- Make sure your backend still returns a valid `timestamp` even when there are no changes.
- Keep payloads stable — match table names and raw record shapes exactly between client and server.
