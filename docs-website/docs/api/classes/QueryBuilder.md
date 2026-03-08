[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / QueryBuilder

# Class: QueryBuilder

## Constructors

### Constructor

> **new QueryBuilder**(`table`): `QueryBuilder`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |

#### Returns

`QueryBuilder`

## Methods

### and()

> **and**(`builder`): `this`

Combine conditions with AND

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `builder` | (`qb`) => `void` |

#### Returns

`this`

***

### build()

> **build**(): [`QueryDescriptor`](../interfaces/QueryDescriptor.md)

Build the final query descriptor

#### Returns

[`QueryDescriptor`](../interfaces/QueryDescriptor.md)

***

### clone()

> **clone**(): `QueryBuilder`

Clone this builder for forking

#### Returns

`QueryBuilder`

***

### join()

> **join**(`table`, `leftColumn`, `rightColumn`): `this`

Add a JOIN clause

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | `string` |
| `leftColumn` | `string` |
| `rightColumn` | `string` |

#### Returns

`this`

***

### limit()

> **limit**(`n`): `this`

Set LIMIT

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `n` | `number` |

#### Returns

`this`

***

### offset()

> **offset**(`n`): `this`

Set OFFSET

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `n` | `number` |

#### Returns

`this`

***

### or()

> **or**(`builder`): `this`

Combine conditions with OR

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `builder` | (`qb`) => `void` |

#### Returns

`this`

***

### orderBy()

> **orderBy**(`column`, `order?`): `this`

Add ORDER BY

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `column` | `string` | `undefined` |
| `order` | [`SortOrder`](../type-aliases/SortOrder.md) | `'asc'` |

#### Returns

`this`

***

### where()

#### Call Signature

> **where**(`column`, `value`): `this`

Add a WHERE condition

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | `string` |
| `value` | `unknown` |

##### Returns

`this`

#### Call Signature

> **where**(`column`, `operator`, `value`): `this`

Add a WHERE condition

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | `string` |
| `operator` | [`ComparisonOperator`](../type-aliases/ComparisonOperator.md) |
| `value` | `unknown` |

##### Returns

`this`

***

### whereBetween()

> **whereBetween**(`column`, `low`, `high`): `this`

WHERE column BETWEEN low AND high

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | `string` |
| `low` | `unknown` |
| `high` | `unknown` |

#### Returns

`this`

***

### whereIn()

> **whereIn**(`column`, `values`): `this`

WHERE column IN (...values)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | `string` |
| `values` | `unknown`[] |

#### Returns

`this`

***

### whereLike()

> **whereLike**(`column`, `pattern`): `this`

WHERE column LIKE pattern

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | `string` |
| `pattern` | `string` |

#### Returns

`this`

***

### whereNotNull()

> **whereNotNull**(`column`): `this`

WHERE column IS NOT NULL

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | `string` |

#### Returns

`this`

***

### whereNull()

> **whereNull**(`column`): `this`

WHERE column IS NULL

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | `string` |

#### Returns

`this`
