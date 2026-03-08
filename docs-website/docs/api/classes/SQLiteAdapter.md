[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SQLiteAdapter

# Class: SQLiteAdapter

## Implements

- [`StorageAdapter`](../interfaces/StorageAdapter.md)

## Constructors

### Constructor

> **new SQLiteAdapter**(`config`): `SQLiteAdapter`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `config` | [`SQLiteAdapterConfig`](../interfaces/SQLiteAdapterConfig.md) |

#### Returns

`SQLiteAdapter`

## Methods

### applyRemoteChanges()

> **applyRemoteChanges**(`changes`): `Promise`\<`void`\>

Apply synced changes from remote (in a transaction).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `changes` | `Record`\<`string`, \{ `created`: [`RawRecord`](../interfaces/RawRecord.md)[]; `deleted`: `string`[]; `updated`: [`RawRecord`](../interfaces/RawRecord.md)[]; \}\> |

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`applyRemoteChanges`](../interfaces/StorageAdapter.md#applyremotechanges)

***

### batch()

> **batch**(`operations`): `Promise`\<`void`\>

Execute a batch of operations atomically.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `operations` | [`BatchOperation`](../interfaces/BatchOperation.md)[] |

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`batch`](../interfaces/StorageAdapter.md#batch)

***

### close()

> **close**(): `Promise`\<`void`\>

Close the database connection.

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`close`](../interfaces/StorageAdapter.md#close)

***

### count()

> **count**(`query`): `Promise`\<`number`\>

Count records matching a query descriptor.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | [`QueryDescriptor`](../interfaces/QueryDescriptor.md) |

#### Returns

`Promise`\<`number`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`count`](../interfaces/StorageAdapter.md#count)

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

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`destroyPermanently`](../interfaces/StorageAdapter.md#destroypermanently)

***

### find()

> **find**(`query`): `Promise`\<[`RawRecord`](../interfaces/RawRecord.md)[]\>

Find records matching a query descriptor.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | [`QueryDescriptor`](../interfaces/QueryDescriptor.md) |

#### Returns

`Promise`\<[`RawRecord`](../interfaces/RawRecord.md)[]\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`find`](../interfaces/StorageAdapter.md#find)

***

### findById()

> **findById**(`table`, `id`): `Promise`\<[`RawRecord`](../interfaces/RawRecord.md) \| `null`\>

Find a single record by ID.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `id` | `string` |

#### Returns

`Promise`\<[`RawRecord`](../interfaces/RawRecord.md) \| `null`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`findById`](../interfaces/StorageAdapter.md#findbyid)

***

### getLocalChanges()

> **getLocalChanges**(`tables`): `Promise`\<`Record`\<`string`, \{ `created`: [`RawRecord`](../interfaces/RawRecord.md)[]; `deleted`: `string`[]; `updated`: [`RawRecord`](../interfaces/RawRecord.md)[]; \}\>\>

Return all records with _status != 'synced'

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tables` | `string`[] |

#### Returns

`Promise`\<`Record`\<`string`, \{ `created`: [`RawRecord`](../interfaces/RawRecord.md)[]; `deleted`: `string`[]; `updated`: [`RawRecord`](../interfaces/RawRecord.md)[]; \}\>\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`getLocalChanges`](../interfaces/StorageAdapter.md#getlocalchanges)

***

### getSchemaVersion()

> **getSchemaVersion**(): `Promise`\<`number`\>

Get the database schema version currently stored.

#### Returns

`Promise`\<`number`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`getSchemaVersion`](../interfaces/StorageAdapter.md#getschemaversion)

***

### initialize()

> **initialize**(`schema`): `Promise`\<`void`\>

Initialize the adapter. Creates tables if needed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `schema` | [`DatabaseSchema`](../interfaces/DatabaseSchema.md) |

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`initialize`](../interfaces/StorageAdapter.md#initialize)

***

### insert()

> **insert**(`table`, `raw`): `Promise`\<`void`\>

Insert a new raw record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `raw` | [`RawRecord`](../interfaces/RawRecord.md) |

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`insert`](../interfaces/StorageAdapter.md#insert)

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

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`markAsDeleted`](../interfaces/StorageAdapter.md#markasdeleted)

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

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`markAsSynced`](../interfaces/StorageAdapter.md#markassynced)

***

### migrate()

> **migrate**(`migrations`): `Promise`\<`void`\>

Run migrations.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `migrations` | [`Migration`](../interfaces/Migration.md)[] |

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`migrate`](../interfaces/StorageAdapter.md#migrate)

***

### reset()

> **reset**(): `Promise`\<`void`\>

Completely reset the database.

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`reset`](../interfaces/StorageAdapter.md#reset)

***

### search()

> **search**(`descriptor`): `Promise`\<\{ `records`: [`RawRecord`](../interfaces/RawRecord.md)[]; `total`: `number`; \}\>

Full-text search.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `descriptor` | [`SearchDescriptor`](../interfaces/SearchDescriptor.md) |

#### Returns

`Promise`\<\{ `records`: [`RawRecord`](../interfaces/RawRecord.md)[]; `total`: `number`; \}\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`search`](../interfaces/StorageAdapter.md#search)

***

### update()

> **update**(`table`, `raw`): `Promise`\<`void`\>

Update an existing raw record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `raw` | [`RawRecord`](../interfaces/RawRecord.md) |

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`update`](../interfaces/StorageAdapter.md#update)

***

### writeTransaction()

> **writeTransaction**(`fn`): `Promise`\<`void`\>

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

#### Implementation of

[`StorageAdapter`](../interfaces/StorageAdapter.md).[`writeTransaction`](../interfaces/StorageAdapter.md#writetransaction)
