[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / StorageAdapter

# Interface: StorageAdapter

Backend contract implemented by every storage engine.

## Methods

### applyRemoteChanges()

> **applyRemoteChanges**(`changes`): `Promise`\<`void`\>

Apply synced changes from remote (in a transaction).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `changes` | `Record`\<`string`, \{ `created`: [`RawRecord`](RawRecord.md)[]; `deleted`: `string`[]; `updated`: [`RawRecord`](RawRecord.md)[]; \}\> |

#### Returns

`Promise`\<`void`\>

***

### batch()

> **batch**(`operations`): `Promise`\<`void`\>

Execute a batch of operations atomically.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `operations` | [`BatchOperation`](BatchOperation.md)[] |

#### Returns

`Promise`\<`void`\>

***

### close()

> **close**(): `Promise`\<`void`\>

Close the database connection.

#### Returns

`Promise`\<`void`\>

***

### count()

> **count**(`query`): `Promise`\<`number`\>

Count records matching a query descriptor.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | [`QueryDescriptor`](QueryDescriptor.md) |

#### Returns

`Promise`\<`number`\>

***

### destroyPermanently()

> **destroyPermanently**(`table`, `id`): `Promise`\<`void`\>

Permanently remove a record from the database.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `id` | `string` |

#### Returns

`Promise`\<`void`\>

***

### find()

> **find**(`query`): `Promise`\<[`RawRecord`](RawRecord.md)[]\>

Find records matching a query descriptor.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | [`QueryDescriptor`](QueryDescriptor.md) |

#### Returns

`Promise`\<[`RawRecord`](RawRecord.md)[]\>

***

### findById()

> **findById**(`table`, `id`): `Promise`\<[`RawRecord`](RawRecord.md) \| `null`\>

Find a single record by ID.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `id` | `string` |

#### Returns

`Promise`\<[`RawRecord`](RawRecord.md) \| `null`\>

***

### getLocalChanges()

> **getLocalChanges**(`tables`): `Promise`\<`Record`\<`string`, \{ `created`: [`RawRecord`](RawRecord.md)[]; `deleted`: `string`[]; `updated`: [`RawRecord`](RawRecord.md)[]; \}\>\>

Return all records with _status != 'synced'

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tables` | `string`[] |

#### Returns

`Promise`\<`Record`\<`string`, \{ `created`: [`RawRecord`](RawRecord.md)[]; `deleted`: `string`[]; `updated`: [`RawRecord`](RawRecord.md)[]; \}\>\>

***

### getSchemaVersion()

> **getSchemaVersion**(): `Promise`\<`number`\>

Get the database schema version currently stored.

#### Returns

`Promise`\<`number`\>

***

### initialize()

> **initialize**(`schema`): `Promise`\<`void`\>

Initialize the adapter. Creates tables if needed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `schema` | [`DatabaseSchema`](DatabaseSchema.md) |

#### Returns

`Promise`\<`void`\>

***

### insert()

> **insert**(`table`, `raw`): `Promise`\<`void`\>

Insert a new raw record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `raw` | [`RawRecord`](RawRecord.md) |

#### Returns

`Promise`\<`void`\>

***

### markAsDeleted()

> **markAsDeleted**(`table`, `id`): `Promise`\<`void`\>

Mark a record as deleted (_status = 'deleted').

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `id` | `string` |

#### Returns

`Promise`\<`void`\>

***

### markAsSynced()

> **markAsSynced**(`table`, `ids`): `Promise`\<`void`\>

Mark synced records as _status = 'synced'.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `ids` | `string`[] |

#### Returns

`Promise`\<`void`\>

***

### migrate()

> **migrate**(`migrations`): `Promise`\<`void`\>

Run migrations.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `migrations` | [`Migration`](Migration.md)[] |

#### Returns

`Promise`\<`void`\>

***

### reset()

> **reset**(): `Promise`\<`void`\>

Completely reset the database.

#### Returns

`Promise`\<`void`\>

***

### search()

> **search**(`descriptor`): `Promise`\<\{ `records`: [`RawRecord`](RawRecord.md)[]; `total`: `number`; \}\>

Full-text search.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `descriptor` | [`SearchDescriptor`](SearchDescriptor.md) |

#### Returns

`Promise`\<\{ `records`: [`RawRecord`](RawRecord.md)[]; `total`: `number`; \}\>

***

### update()

> **update**(`table`, `raw`): `Promise`\<`void`\>

Update an existing raw record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `raw` | [`RawRecord`](RawRecord.md) |

#### Returns

`Promise`\<`void`\>

***

### writeTransaction()?

> `optional` **writeTransaction**(`fn`): `Promise`\<`void`\>

Optional: wrap a set of operations in a write transaction.
When provided, `db.write()` will call this so that all individual
inserts/updates/deletes within a single write() share ONE database
transaction (one fsync) instead of each being autocommit.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fn` | () => `Promise`\<`void`\> |

#### Returns

`Promise`\<`void`\>
