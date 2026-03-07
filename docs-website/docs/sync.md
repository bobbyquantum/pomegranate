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

  pullChanges: async ({ lastPulledAt }) => {
    const response = await fetch('/api/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastPulledAt }),
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
