[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / WhereClause

# Interface: WhereClause

A basic column comparison such as `title = 'hello'` or `age >= 18`.

## Properties

### column

> `readonly` **column**: `string`

Column name on the current table.

***

### operator

> `readonly` **operator**: [`ComparisonOperator`](../type-aliases/ComparisonOperator.md)

Comparison to apply to the column value.

***

### type

> `readonly` **type**: `"where"`

Discriminator used by query translators.

***

### value

> `readonly` **value**: `unknown`

Right-hand value for the comparison.
