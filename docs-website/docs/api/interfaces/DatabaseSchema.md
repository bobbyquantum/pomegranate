[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / DatabaseSchema

# Interface: DatabaseSchema

Top-level schema object passed into adapters during initialization.

## Properties

### tables

> `readonly` **tables**: [`TableSchema`](TableSchema.md)[]

All tables managed by this database.

***

### version

> `readonly` **version**: `number`

Monotonically increasing schema version.
