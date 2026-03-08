[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / Database

# Class: Database

## Implements

- `ModelDatabaseRef`

## Constructors

### Constructor

> **new Database**(`config`): `Database`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `config` | [`DatabaseConfig`](../interfaces/DatabaseConfig.md) |

#### Returns

`Database`

## Properties

### \_adapter

> `readonly` **\_adapter**: [`StorageAdapter`](../interfaces/StorageAdapter.md)

## Accessors

### collections

#### Get Signature

> **get** **collections**(): [`Collection`](Collection.md)\<[`Model`](Model.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\>\>[]

All registered collections.

##### Returns

[`Collection`](Collection.md)\<[`Model`](Model.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\>\>[]

***

### events$

#### Get Signature

> **get** **events$**(): [`Observable`](../interfaces/Observable.md)\<[`DatabaseEvent`](../type-aliases/DatabaseEvent.md)\>

##### Returns

[`Observable`](../interfaces/Observable.md)\<[`DatabaseEvent`](../type-aliases/DatabaseEvent.md)\>

***

### syncLog$

#### Get Signature

> **get** **syncLog$**(): [`Observable`](../interfaces/Observable.md)\<[`SyncLog`](../interfaces/SyncLog.md) \| `null`\>

##### Returns

[`Observable`](../interfaces/Observable.md)\<[`SyncLog`](../interfaces/SyncLog.md) \| `null`\>

***

### syncState$

#### Get Signature

> **get** **syncState$**(): [`Observable`](../interfaces/Observable.md)\<[`SyncState`](../type-aliases/SyncState.md)\>

##### Returns

[`Observable`](../interfaces/Observable.md)\<[`SyncState`](../type-aliases/SyncState.md)\>

***

### tables

#### Get Signature

> **get** **tables**(): `string`[]

The tables this database manages.

##### Returns

`string`[]

## Methods

### batch()

> **batch**(`operations`): `Promise`\<`void`\>

Execute a batch of operations atomically.
Must be called inside `db.write()`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `operations` | [`BatchOperation`](../interfaces/BatchOperation.md)[] |

#### Returns

`Promise`\<`void`\>

***

### close()

> **close**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### collection()

> **collection**(`table`): [`Collection`](Collection.md)

Get a collection by table name.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |

#### Returns

[`Collection`](Collection.md)

***

### get()

> **get**\<`M`\>(`modelClass`): [`Collection`](Collection.md)\<`M`\>

Get the collection for a model class.

#### Type Parameters

| Type Parameter |
| ------ |
| `M` *extends* [`Model`](Model.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\> |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `modelClass` | [`ModelStatic`](../type-aliases/ModelStatic.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\> |

#### Returns

[`Collection`](Collection.md)\<`M`\>

***

### initialize()

> **initialize**(): `Promise`\<`void`\>

Initialize the database. Must be called before any operations.
Creates tables if they don't exist.

#### Returns

`Promise`\<`void`\>

***

### observeSyncLog()

> **observeSyncLog**(): [`Observable`](../interfaces/Observable.md)\<[`SyncLog`](../interfaces/SyncLog.md) \| `null`\>

#### Returns

[`Observable`](../interfaces/Observable.md)\<[`SyncLog`](../interfaces/SyncLog.md) \| `null`\>

***

### observeSyncState()

> **observeSyncState**(): [`Observable`](../interfaces/Observable.md)\<[`SyncState`](../type-aliases/SyncState.md)\>

#### Returns

[`Observable`](../interfaces/Observable.md)\<[`SyncState`](../type-aliases/SyncState.md)\>

***

### reset()

> **reset**(): `Promise`\<`void`\>

Completely reset the database — drops all data.

#### Returns

`Promise`\<`void`\>

***

### sync()

> **sync**(`opts`): `Promise`\<`void`\>

Run a sync cycle.
See sync/index.ts for the full implementation.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`SyncConfig`](../interfaces/SyncConfig.md) |

#### Returns

`Promise`\<`void`\>

***

### write()

> **write**\<`T`\>(`fn`): `Promise`\<`T`\>

Execute a write transaction.

All mutations (create, update, delete) must happen inside a write() call.
Write calls are serialized — only one runs at a time.

#### Type Parameters

| Type Parameter |
| ------ |
| `T` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fn` | () => `Promise`\<`T`\> |

#### Returns

`Promise`\<`T`\>
