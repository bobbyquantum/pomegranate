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

Stable record identifier.

## Methods

### getField()

> **getField**(`fieldName`): `unknown`

Read a field value from the model instance.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `string` |

#### Returns

`unknown`

***

### observe()

> **observe**(): [`Observable`](Observable.md)\<`ModelInstance`\<`S`\>\>

Observe the model for future changes.

#### Returns

[`Observable`](Observable.md)\<`ModelInstance`\<`S`\>\>
