[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SQLiteAdapterConfig

# Interface: SQLiteAdapterConfig

## Extends

- `AdapterConfig`

## Properties

### databaseName

> `readonly` **databaseName**: `string`

#### Inherited from

`AdapterConfig.databaseName`

***

### driver?

> `optional` **driver**: [`SQLiteDriver`](SQLiteDriver.md)

The SQLite driver to use. If not provided, a default will be selected.

***

### encryption?

> `optional` **encryption**: [`EncryptionConfig`](EncryptionConfig.md)

Optional encryption config

***

### schemaVersion?

> `readonly` `optional` **schemaVersion**: `number`

Optional schema version override; normally derived from DatabaseSchema.

#### Inherited from

`AdapterConfig.schemaVersion`
