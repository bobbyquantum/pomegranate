[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / Migration

# Interface: Migration

One schema migration between two concrete versions.

## Properties

### fromVersion

> `readonly` **fromVersion**: `number`

Schema version the migration starts from.

***

### steps

> `readonly` **steps**: [`MigrationStep`](../type-aliases/MigrationStep.md)[]

Ordered migration steps to execute.

***

### toVersion

> `readonly` **toVersion**: `number`

Schema version after the migration completes.
