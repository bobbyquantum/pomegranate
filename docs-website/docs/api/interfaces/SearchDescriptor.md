[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SearchDescriptor

# Interface: SearchDescriptor

Descriptor for adapter-level full-text search.

## Properties

### conditions

> `readonly` **conditions**: readonly [`Condition`](../type-aliases/Condition.md)[]

Additional non-text filters to apply.

***

### fields

> `readonly` **fields**: readonly `string`[]

Columns that should participate in the text search.

***

### limit

> `readonly` **limit**: `number`

Maximum number of records to return.

***

### offset

> `readonly` **offset**: `number`

Number of results to skip before returning rows.

***

### orderBy

> `readonly` **orderBy**: readonly [`OrderByClause`](OrderByClause.md)[]

Sort clauses for the final result set.

***

### table

> `readonly` **table**: `string`

Table to search within.

***

### term

> `readonly` **term**: `string`

Search term to match.
