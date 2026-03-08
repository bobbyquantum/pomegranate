[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SyncLog

# Interface: SyncLog

Lightweight sync run metadata exposed through `Database.observeSyncLog()`.

## Properties

### error?

> `optional` **error**: `string`

Error message when the run fails.

***

### finishedAt?

> `optional` **finishedAt**: `number`

Unix timestamp when the sync run finished.

***

### pullTimestamp?

> `optional` **pullTimestamp**: `number`

Server timestamp returned from the latest successful pull.

***

### pushedTables?

> `optional` **pushedTables**: `string`[]

Tables included in the push phase, when tracked.

***

### startedAt

> **startedAt**: `number`

Unix timestamp when the sync run started.

***

### state

> **state**: [`SyncState`](../type-aliases/SyncState.md)

Lifecycle state reached by the run.
