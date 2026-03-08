[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / ModelSchema

# Interface: ModelSchema\<F\>

Compiled model schema with table name and resolved columns

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `F` *extends* [`SchemaFields`](../type-aliases/SchemaFields.md) | [`SchemaFields`](../type-aliases/SchemaFields.md) |

## Properties

### columns

> `readonly` **columns**: [`ResolvedColumn`](ResolvedColumn.md)[]

***

### fields

> `readonly` **fields**: `F`

***

### relations

> `readonly` **relations**: [`ResolvedRelation`](ResolvedRelation.md)[]

***

### table

> `readonly` **table**: `string`
