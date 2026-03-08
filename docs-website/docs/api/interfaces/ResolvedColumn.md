[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / ResolvedColumn

# Interface: ResolvedColumn

Resolved, adapter-ready metadata for a declared column.

## Properties

### columnName

> `readonly` **columnName**: `string`

Physical database column name.

***

### defaultValue?

> `readonly` `optional` **defaultValue**: `unknown`

Default value applied during record creation when omitted.

***

### fieldName

> `readonly` **fieldName**: `string`

Model field name used in TypeScript.

***

### isIndexed

> `readonly` **isIndexed**: `boolean`

Whether adapters should create an index for this column.

***

### isOptional

> `readonly` **isOptional**: `boolean`

Whether `null` is allowed for this field.

***

### isReadonly

> `readonly` **isReadonly**: `boolean`

Whether the field can only be written by framework internals.

***

### type

> `readonly` **type**: [`ColumnType`](../type-aliases/ColumnType.md)

Primitive storage type used by the adapter.
