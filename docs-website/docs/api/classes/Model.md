[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / Model

# Class: Model\<S\>

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `S` *extends* [`ModelSchema`](../interfaces/ModelSchema.md) | [`ModelSchema`](../interfaces/ModelSchema.md) |

## Constructors

### Constructor

> **new Model**\<`S`\>(`collection`, `raw`): `Model`\<`S`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `collection` | `ModelCollectionRef` |
| `raw` | [`RawRecord`](../interfaces/RawRecord.md) |

#### Returns

`Model`\<`S`\>

## Properties

### collection

> `readonly` **collection**: `ModelCollectionRef`

Reference back to the owning collection

***

### id

> `readonly` **id**: `string`

The record id

***

### schema

> `static` **schema**: [`ModelSchema`](../interfaces/ModelSchema.md)

## Accessors

### \_rawRecord

#### Get Signature

> **get** **\_rawRecord**(): [`RawRecord`](../interfaces/RawRecord.md)

Get the current raw record

##### Returns

[`RawRecord`](../interfaces/RawRecord.md)

***

### changedFields

#### Get Signature

> **get** **changedFields**(): `string`

Changed fields (comma-separated)

##### Returns

`string`

***

### syncStatus

#### Get Signature

> **get** **syncStatus**(): [`SyncStatus`](../type-aliases/SyncStatus.md)

Sync status of this record

##### Returns

[`SyncStatus`](../type-aliases/SyncStatus.md)

## Methods

### \_setRaw()

> **\_setRaw**(`updates`): `void`

Set field value(s) on the raw record (does NOT persist — internal use).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `updates` | `Partial`\<[`RawRecord`](../interfaces/RawRecord.md)\> |

#### Returns

`void`

***

### belongsTo()

> **belongsTo**\<`K`\>(`fieldName`): `S`\[`"fields"`\]\[`K`\] *extends* [`BelongsToDescriptor`](../interfaces/BelongsToDescriptor.md)\<`RS`\> ? [`BelongsToRelation`](../interfaces/BelongsToRelation.md)\<`RS`\> : [`BelongsToRelation`](../interfaces/BelongsToRelation.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\>

Get a typed belongs-to relation handle.

The return type is inferred from the schema: if the field is a
`BelongsToDescriptor<UserSchema>`, the return is `BelongsToRelation<UserSchema>`.

Usage in subclass:

```ts
get author() {
  return this.belongsTo('author');
}

// TS infers: BelongsToRelation<typeof UserSchema>
```

#### Type Parameters

| Type Parameter |
| ------ |
| `K` *extends* `string` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `K` |

#### Returns

`S`\[`"fields"`\]\[`K`\] *extends* [`BelongsToDescriptor`](../interfaces/BelongsToDescriptor.md)\<`RS`\> ? [`BelongsToRelation`](../interfaces/BelongsToRelation.md)\<`RS`\> : [`BelongsToRelation`](../interfaces/BelongsToRelation.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\>

***

### destroyPermanently()

> **destroyPermanently**(): `Promise`\<`void`\>

Permanently destroy this record.
Must be called inside `db.write()`.

#### Returns

`Promise`\<`void`\>

***

### getField()

> **getField**(`fieldName`): `unknown`

Get a field value, converting from raw storage form.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `string` |

#### Returns

`unknown`

***

### hasMany()

> **hasMany**\<`K`\>(`fieldName`): `S`\[`"fields"`\]\[`K`\] *extends* [`HasManyDescriptor`](../interfaces/HasManyDescriptor.md)\<`RS`\> ? [`HasManyRelation`](../interfaces/HasManyRelation.md)\<`RS`\> : [`HasManyRelation`](../interfaces/HasManyRelation.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\>

Get a typed has-many relation handle.

The return type is inferred from the schema: if the field is a
`HasManyDescriptor<CommentSchema>`, the return is `HasManyRelation<CommentSchema>`.

Usage in subclass:

```ts
get comments() {
  return this.hasMany('comments');
}

// TS infers: HasManyRelation<typeof CommentSchema>
```

#### Type Parameters

| Type Parameter |
| ------ |
| `K` *extends* `string` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `K` |

#### Returns

`S`\[`"fields"`\]\[`K`\] *extends* [`HasManyDescriptor`](../interfaces/HasManyDescriptor.md)\<`RS`\> ? [`HasManyRelation`](../interfaces/HasManyRelation.md)\<`RS`\> : [`HasManyRelation`](../interfaces/HasManyRelation.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\>

***

### markAsDeleted()

> **markAsDeleted**(): `Promise`\<`void`\>

Mark this record as deleted (soft delete for sync).
Must be called inside `db.write()`.

#### Returns

`Promise`\<`void`\>

***

### observe()

> **observe**(): [`Observable`](../interfaces/Observable.md)\<`Model`\<`S`\>\>

Observe changes to this record

#### Returns

[`Observable`](../interfaces/Observable.md)\<`Model`\<`S`\>\>

***

### observeField()

> **observeField**(`fieldName`): [`Observable`](../interfaces/Observable.md)\<`unknown`\>

Observe a specific field

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `string` |

#### Returns

[`Observable`](../interfaces/Observable.md)\<`unknown`\>

***

### toPushPayload()

> **toPushPayload**(): `Record`\<`string`, `unknown`\>

Return raw values suitable for the sync push payload.

#### Returns

`Record`\<`string`, `unknown`\>

***

### update()

> **update**(`patch`): `Promise`\<`void`\>

Update this record with a patch of field values.
Must be called inside `db.write()`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `patch` | `Record`\<`string`, `unknown`\> |

#### Returns

`Promise`\<`void`\>

***

### writer()

> **writer**\<`Args`, `R`\>(`fn`): (...`args`) => `Promise`\<`R`\>

Create a bound writer method.
The returned function, when called, will run inside the current write transaction.

#### Type Parameters

| Type Parameter |
| ------ |
| `Args` *extends* `unknown`[] |
| `R` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fn` | (...`args`) => `Promise`\<`R`\> |

#### Returns

> (...`args`): `Promise`\<`R`\>

##### Parameters

| Parameter | Type |
| ------ | ------ |
| ...`args` | `Args` |

##### Returns

`Promise`\<`R`\>
