[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / HasManyDescriptor

# Interface: HasManyDescriptor\<S\>

Has-many (one-to-many) relation descriptor.
Generic over the related ModelSchema so TypeScript can infer the related type.

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `S` *extends* [`ModelSchema`](ModelSchema.md) | [`ModelSchema`](ModelSchema.md) |

## Properties

### foreignKey

> `readonly` **foreignKey**: `string`

***

### kind

> `readonly` **kind**: `"has_many"`
