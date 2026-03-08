[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / ModelInstance

# Interface: ModelInstance\<S\>

A model instance typed by its schema.
Forward-declared as a minimal interface to avoid circular imports.
Full Model class satisfies this at runtime.

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `S` *extends* [`ModelSchema`](ModelSchema.md) | [`ModelSchema`](ModelSchema.md) |

## Properties

### id

> `readonly` **id**: `string`

## Methods

### getField()

> **getField**(`fieldName`): `unknown`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `string` |

#### Returns

`unknown`

***

### observe()

> **observe**(): [`Observable`](Observable.md)\<`ModelInstance`\<`S`\>\>

#### Returns

[`Observable`](Observable.md)\<`ModelInstance`\<`S`\>\>
