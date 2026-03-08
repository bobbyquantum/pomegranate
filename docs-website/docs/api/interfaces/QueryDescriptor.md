[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / QueryDescriptor

# Interface: QueryDescriptor

Fully-serializable query description produced by `QueryBuilder`.

## Properties

### conditions

> `readonly` **conditions**: readonly [`Condition`](../type-aliases/Condition.md)[]

Filter tree applied to the query.

***

### joins

> `readonly` **joins**: readonly `JoinClause`[]

Join clauses needed to satisfy relational filters.

***

### limit?

> `readonly` `optional` **limit**: `number`

Maximum number of records to return.

***

### offset?

> `readonly` `optional` **offset**: `number`

Number of matching rows to skip first.

***

### orderBy

> `readonly` **orderBy**: readonly [`OrderByClause`](OrderByClause.md)[]

Sort clauses applied in order.

***

### table

> `readonly` **table**: `string`

Base table to query.
