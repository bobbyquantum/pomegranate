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

Resolved column metadata used by adapters and serializers.

***

### fields

> `readonly` **fields**: `F`

Original field map as declared by the model builder.

***

### relations

> `readonly` **relations**: [`ResolvedRelation`](ResolvedRelation.md)[]

Resolved relation metadata used for relation handles.

***

### table

> `readonly` **table**: `string`

Backing database table name.
