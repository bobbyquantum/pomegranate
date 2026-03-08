[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / HasManyRelation

# Interface: HasManyRelation\<S\>

Lazy has-many relation handle (one-to-many).

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `S` *extends* [`ModelSchema`](ModelSchema.md) | [`ModelSchema`](ModelSchema.md) |

## Methods

### fetch()

> **fetch**(): `Promise`\<[`ModelInstance`](ModelInstance.md)\<`S`\>[]\>

Fetch all related records

#### Returns

`Promise`\<[`ModelInstance`](ModelInstance.md)\<`S`\>[]\>

***

### observe()

> **observe**(): [`Observable`](Observable.md)\<[`ModelInstance`](ModelInstance.md)\<`S`\>[]\>

Observe the related records reactively

#### Returns

[`Observable`](Observable.md)\<[`ModelInstance`](ModelInstance.md)\<`S`\>[]\>
