[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / TextColumn

# Interface: TextColumn

Text column descriptor.

## Extends

- [`ColumnDescriptor`](ColumnDescriptor.md)

## Properties

### columnName

> `readonly` **columnName**: `string` \| `null`

Explicit database column name, or `null` to reuse the field name.

#### Inherited from

[`ColumnDescriptor`](ColumnDescriptor.md).[`columnName`](ColumnDescriptor.md#columnname)

***

### defaultValue?

> `readonly` `optional` **defaultValue**: `unknown`

Default value applied when a record is created without this field.

#### Inherited from

[`ColumnDescriptor`](ColumnDescriptor.md).[`defaultValue`](ColumnDescriptor.md#defaultvalue)

***

### isIndexed

> `readonly` **isIndexed**: `boolean`

Whether adapters should create an index for this column.

#### Inherited from

[`ColumnDescriptor`](ColumnDescriptor.md).[`isIndexed`](ColumnDescriptor.md#isindexed)

***

### isOptional

> `readonly` **isOptional**: `boolean`

Whether `null` is allowed at the model level.

#### Inherited from

[`ColumnDescriptor`](ColumnDescriptor.md).[`isOptional`](ColumnDescriptor.md#isoptional)

***

### isReadonly

> `readonly` **isReadonly**: `boolean`

Whether the field can only be written by the framework.

#### Inherited from

[`ColumnDescriptor`](ColumnDescriptor.md).[`isReadonly`](ColumnDescriptor.md#isreadonly)

***

### type

> `readonly` **type**: `"text"`

Primitive storage type used by the adapter.

#### Overrides

[`ColumnDescriptor`](ColumnDescriptor.md).[`type`](ColumnDescriptor.md#type)
