[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / m

# Variable: m

> `const` **m**: `object`

Public schema builder API — the `m` object.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `belongsTo()` | (`relatedSchema`, `opts`) => [`BelongsToDescriptor`](../interfaces/BelongsToDescriptor.md)\<`S`\> | Belongs-to relation (many-to-one). Adds a foreign key column. |
| `boolean()` | (`columnName?`) => `ColumnBuilder`\<[`BooleanColumn`](../interfaces/BooleanColumn.md)\> | Boolean column |
| `date()` | (`columnName?`) => `ColumnBuilder`\<[`DateColumn`](../interfaces/DateColumn.md)\> | Date column (stored as epoch ms in the database) |
| `hasMany()` | (`relatedSchema`, `opts`) => [`HasManyDescriptor`](../interfaces/HasManyDescriptor.md)\<`S`\> | Has-many relation (one-to-many). Query-only, no stored column. |
| `model()` | (`table`, `fields`) => [`ModelSchema`](../interfaces/ModelSchema.md)\<\{ \[K in string \| number \| symbol\]: F\[K\] extends ColumnBuilder\<D\> ? D : F\[K\] extends FieldDescriptor ? any\[any\] : never \}\> | Define a model schema for the given table. Resolves all columns and relations, and returns a frozen ModelSchema that carries full type information. |
| `number()` | (`columnName?`) => `ColumnBuilder`\<[`NumberColumn`](../interfaces/NumberColumn.md)\> | Numeric column |
| `text()` | (`columnName?`) => `ColumnBuilder`\<[`TextColumn`](../interfaces/TextColumn.md)\> | Text (string) column |
