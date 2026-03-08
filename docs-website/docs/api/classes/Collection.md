[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / Collection

# Class: Collection\<M\>

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `M` *extends* [`Model`](Model.md) | [`Model`](Model.md) |

## Implements

- `ModelCollectionRef`

## Constructors

### Constructor

> **new Collection**\<`M`\>(`database`, `modelClass`): `Collection`\<`M`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `database` | `ModelDatabaseRef` & `object` |
| `modelClass` | [`ModelStatic`](../type-aliases/ModelStatic.md) |

#### Returns

`Collection`\<`M`\>

## Properties

### table

> `readonly` **table**: `string`

#### Implementation of

`ModelCollectionRef.table`

## Accessors

### changes$

#### Get Signature

> **get** **changes$**(): [`Observable`](../interfaces/Observable.md)\<[`CollectionChange`](../interfaces/CollectionChange.md)\>

Observe all changes to this collection.

##### Returns

[`Observable`](../interfaces/Observable.md)\<[`CollectionChange`](../interfaces/CollectionChange.md)\>

***

### schema

#### Get Signature

> **get** **schema**(): [`ModelSchema`](../interfaces/ModelSchema.md)

##### Returns

[`ModelSchema`](../interfaces/ModelSchema.md)

## Methods

### \_cacheRaw()

> **\_cacheRaw**(`raw`): `M`

Directly add a raw record to cache (used during sync)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `raw` | [`RawRecord`](../interfaces/RawRecord.md) |

#### Returns

`M`

***

### \_clearCache()

> **\_clearCache**(): `void`

Clear the cache — used during reset or sync

#### Returns

`void`

***

### \_delete()

> **\_delete**(`id`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`Promise`\<`void`\>

#### Implementation of

`ModelCollectionRef._delete`

***

### \_destroyPermanently()

> **\_destroyPermanently**(`id`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`Promise`\<`void`\>

#### Implementation of

`ModelCollectionRef._destroyPermanently`

***

### \_getDatabase()

> **\_getDatabase**(): `ModelDatabaseRef`

#### Returns

`ModelDatabaseRef`

#### Implementation of

`ModelCollectionRef._getDatabase`

***

### \_notifyChange()

> **\_notifyChange**(`type`, `record`): `void`

Notify external change (used by sync/batch)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `type` | [`CollectionChangeType`](../type-aliases/CollectionChangeType.md) |
| `record` | [`Model`](Model.md) |

#### Returns

`void`

***

### \_update()

> **\_update**(`id`, `rawUpdates`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `rawUpdates` | `Partial`\<[`RawRecord`](../interfaces/RawRecord.md)\> |

#### Returns

`Promise`\<`void`\>

#### Implementation of

`ModelCollectionRef._update`

***

### count()

> **count**(`queryOrBuilder?`): `Promise`\<`number`\>

Count records matching a query.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `queryOrBuilder?` | [`QueryDescriptor`](../interfaces/QueryDescriptor.md) \| [`QueryBuilder`](QueryBuilder.md) |

#### Returns

`Promise`\<`number`\>

***

### create()

> **create**(`patch`): `Promise`\<`M`\>

Create a new record.
Must be called inside `db.write()`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `patch` | `Record`\<`string`, `unknown`\> |

#### Returns

`Promise`\<`M`\>

***

### fetch()

> **fetch**(`queryOrBuilder`): `Promise`\<`M`[]\>

Execute a query and return model instances.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `queryOrBuilder` | [`QueryDescriptor`](../interfaces/QueryDescriptor.md) \| [`QueryBuilder`](QueryBuilder.md) |

#### Returns

`Promise`\<`M`[]\>

***

### findById()

> **findById**(`id`): `Promise`\<`M` \| `null`\>

Find a record by ID.
Returns the cached instance if available.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`Promise`\<`M` \| `null`\>

***

### findByIdOrFail()

> **findByIdOrFail**(`id`): `Promise`\<`M`\>

Find a record by ID or throw.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`Promise`\<`M`\>

***

### observeById()

> **observeById**(`id`): [`Observable`](../interfaces/Observable.md)\<`M` \| `null`\>

Observe a single record by ID.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Observable`](../interfaces/Observable.md)\<`M` \| `null`\>

***

### observeCount()

> **observeCount**(`queryOrBuilder?`): [`Observable`](../interfaces/Observable.md)\<`number`\>

Observe a count matching a query.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `queryOrBuilder?` | [`QueryDescriptor`](../interfaces/QueryDescriptor.md) \| [`QueryBuilder`](QueryBuilder.md) |

#### Returns

[`Observable`](../interfaces/Observable.md)\<`number`\>

***

### observeQuery()

> **observeQuery**(`queryOrBuilder`): [`Observable`](../interfaces/Observable.md)\<`M`[]\>

Create a live query that re-runs whenever the collection changes.
Returns an observable of record arrays.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `queryOrBuilder` | [`QueryDescriptor`](../interfaces/QueryDescriptor.md) \| [`QueryBuilder`](QueryBuilder.md) |

#### Returns

[`Observable`](../interfaces/Observable.md)\<`M`[]\>

***

### query()

#### Call Signature

> **query**(): [`QueryBuilder`](QueryBuilder.md)

Query records using the fluent QueryBuilder.

##### Returns

[`QueryBuilder`](QueryBuilder.md)

#### Call Signature

> **query**(`fn`): [`QueryBuilder`](QueryBuilder.md)

Query records using the fluent QueryBuilder.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `fn` | (`qb`) => `void` |

##### Returns

[`QueryBuilder`](QueryBuilder.md)

***

### search()

> **search**(`opts`): `Promise`\<\{ `records`: `M`[]; `total`: `number`; \}\>

Full-text search.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `extend?`: (`qb`) => `void`; `fields`: `string`[]; `limit?`: `number`; `offset?`: `number`; `orderBy?`: `Record`\<`string`, `"asc"` \| `"desc"`\>; `term`: `string`; \} |
| `opts.extend?` | (`qb`) => `void` |
| `opts.fields` | `string`[] |
| `opts.limit?` | `number` |
| `opts.offset?` | `number` |
| `opts.orderBy?` | `Record`\<`string`, `"asc"` \| `"desc"`\> |
| `opts.term` | `string` |

#### Returns

`Promise`\<\{ `records`: `M`[]; `total`: `number`; \}\>
