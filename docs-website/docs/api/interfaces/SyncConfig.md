[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SyncConfig

# Interface: SyncConfig

Runtime callbacks and options needed to perform a sync cycle.

## Properties

### onConflict()?

> `optional` **onConflict**: (`local`, `remote`) => [`RawRecord`](RawRecord.md)

Optional: called when sync encounters a conflict

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `local` | [`RawRecord`](RawRecord.md) |
| `remote` | [`RawRecord`](RawRecord.md) |

#### Returns

[`RawRecord`](RawRecord.md)

***

### pullChanges()

> **pullChanges**: (`params`) => `Promise`\<[`SyncPullResult`](SyncPullResult.md)\>

Pull remote changes newer than the provided checkpoint.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `params` | \{ `lastPulledAt`: `number` \| `null`; \} |
| `params.lastPulledAt` | `number` \| `null` |

#### Returns

`Promise`\<[`SyncPullResult`](SyncPullResult.md)\>

***

### pushChanges()

> **pushChanges**: (`params`) => `Promise`\<`void`\>

Push local changes to the remote backend.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `params` | [`SyncPushPayload`](SyncPushPayload.md) |

#### Returns

`Promise`\<`void`\>

***

### tables?

> `optional` **tables**: `string`[]

Optional: tables to sync. If not specified, all tables are synced.
