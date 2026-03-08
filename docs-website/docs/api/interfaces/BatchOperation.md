[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / BatchOperation

# Interface: BatchOperation

A single mutation in an adapter batch payload.

## Properties

### id?

> `readonly` `optional` **id**: `string`

Target record id for delete-style operations.

***

### rawRecord?

> `readonly` `optional` **rawRecord**: `Record`\<`string`, `unknown`\>

Raw record payload for create or update operations.

***

### table

> `readonly` **table**: `string`

Target table for the operation.

***

### type

> `readonly` **type**: `BatchOperationType`

Operation kind to perform.
