---
sidebar_position: 10
title: Sync
slug: /sync
---

# Sync

PomegranateDB includes a built-in pull/push sync protocol compatible with any backend that implements the expected API.

## Overview

The sync cycle follows a **push-first** strategy:

1. **Push** local changes to the server
2. **Pull** remote changes from the server
3. **Apply** remote changes locally (in a transaction)
4. **Mark** pushed records as synced

Push-first minimizes conflicts — the server sees your changes before you pull theirs.

## Usage

```ts
import { performSync } from 'pomegranate-db';

await performSync(db, {
  pull: async ({ lastPulledAt, tables }) => {
    const response = await fetch('/api/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ lastPulledAt, tables }),
    });
    return response.json();
    // Expected: { changes: { posts: { created: [], updated: [], deleted: [] } }, timestamp }
  },

  push: async ({ changes }) => {
    await fetch('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ changes }),
    });
  },
});
```

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
      deleted: string[];  // array of IDs
    };
  };
  timestamp: number;  // server timestamp for next pull
}
```

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
}
```

## Conflict Resolution

When a record is modified both locally and remotely:

- **Remote wins** by default — the remote version overwrites local changes
- Locally modified fields are preserved in `_changed` so the next push sends them
- You can implement custom conflict resolution in your `pull` handler

## Configuration

```ts
interface SyncConfig {
  /** Fetch remote changes */
  pull: (params: { lastPulledAt: number | null; tables: string[] }) => Promise<SyncPullResult>;
  /** Push local changes */
  push: (params: { changes: SyncPushPayload }) => Promise<void>;
  /** Optional: which tables to sync (default: all) */
  tables?: string[];
  /** Optional: callback for sync progress */
  onProgress?: (state: SyncState) => void;
}
```

## Sync States

```ts
type SyncState =
  | 'idle'
  | 'pushing'
  | 'pulling'
  | 'applying'
  | 'complete'
  | 'error';
```

## Tips

- **Debounce syncs** — don't call `performSync` on every write
- **Handle network errors** — wrap in try/catch, retry with exponential backoff
- **Sync on app foreground** — use `AppState` to trigger sync when the app returns
- **Partial sync** — pass `tables` to sync only specific tables
