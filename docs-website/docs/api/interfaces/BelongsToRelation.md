[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / BelongsToRelation

# Interface: BelongsToRelation\<S\>

Lazy belongs-to relation handle (many-to-one).

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `S` *extends* [`ModelSchema`](ModelSchema.md) | [`ModelSchema`](ModelSchema.md) |

## Properties

### id

> `readonly` **id**: `string` \| `null`

The foreign key value (the related record's ID)

## Methods

### fetch()

> **fetch**(): `Promise`\<[`ModelInstance`](ModelInstance.md)\<`S`\> \| `null`\>

Fetch the related record

#### Returns

`Promise`\<[`ModelInstance`](ModelInstance.md)\<`S`\> \| `null`\>

***

### observe()

> **observe**(): [`Observable`](Observable.md)\<[`ModelInstance`](ModelInstance.md)\<`S`\> \| `null`\>

Observe the related record reactively

#### Returns

[`Observable`](Observable.md)\<[`ModelInstance`](ModelInstance.md)\<`S`\> \| `null`\>
