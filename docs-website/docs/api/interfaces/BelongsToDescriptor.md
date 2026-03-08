[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / BelongsToDescriptor

# Interface: BelongsToDescriptor\<S\>

Belongs-to (many-to-one) relation descriptor.
Generic over the related ModelSchema so TypeScript can infer the related type.
The thunk `_relatedSchemaThunk` is resolved lazily to support forward references.

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `S` *extends* [`ModelSchema`](ModelSchema.md) | [`ModelSchema`](ModelSchema.md) |

## Properties

### foreignKey

> `readonly` **foreignKey**: `string`

***

### kind

> `readonly` **kind**: `"belongs_to"`
