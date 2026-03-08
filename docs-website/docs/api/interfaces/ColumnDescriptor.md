[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / ColumnDescriptor

# Interface: ColumnDescriptor

Shared metadata for any persisted column declared in a model schema.

## Extended by

- [`TextColumn`](TextColumn.md)
- [`NumberColumn`](NumberColumn.md)
- [`BooleanColumn`](BooleanColumn.md)
- [`DateColumn`](DateColumn.md)

## Properties

### columnName

> `readonly` **columnName**: `string` \| `null`

Explicit database column name, or `null` to reuse the field name.

***

### defaultValue?

> `readonly` `optional` **defaultValue**: `unknown`

Default value applied when a record is created without this field.

***

### isIndexed

> `readonly` **isIndexed**: `boolean`

Whether adapters should create an index for this column.

***

### isOptional

> `readonly` **isOptional**: `boolean`

Whether `null` is allowed at the model level.

***

### isReadonly

> `readonly` **isReadonly**: `boolean`

Whether the field can only be written by the framework.

***

### type

> `readonly` **type**: [`ColumnType`](../type-aliases/ColumnType.md)

Primitive storage type used by the adapter.
