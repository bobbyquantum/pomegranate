[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / RawRecord

# Interface: RawRecord

Raw row as stored in the adapter (values are primitives)

## Extends

- `SyncColumns`

## Indexable

\[`column`: `string`\]: `unknown`

Arbitrary persisted columns by column name.

## Properties

### \_changed

> `readonly` **\_changed**: `string`

Comma-separated list of locally changed field names.

#### Inherited from

`SyncColumns._changed`

***

### \_status

> `readonly` **\_status**: [`SyncStatus`](../type-aliases/SyncStatus.md)

Current local sync status for the row.

#### Inherited from

`SyncColumns._status`

***

### id

> `readonly` **id**: `string`

Stable record identifier.
