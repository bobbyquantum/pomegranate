[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / MigrationStep

# Type Alias: MigrationStep

> **MigrationStep** = \{ `schema`: [`TableSchema`](../interfaces/TableSchema.md); `type`: `"createTable"`; \} \| \{ `column`: `string`; `columnType`: `string`; `isOptional?`: `boolean`; `table`: `string`; `type`: `"addColumn"`; \} \| \{ `table`: `string`; `type`: `"destroyTable"`; \} \| \{ `query`: `string`; `type`: `"sql"`; \}

Atomic migration step understood by the built-in adapters.

## Type Declaration

\{ `schema`: [`TableSchema`](../interfaces/TableSchema.md); `type`: `"createTable"`; \}

| Name | Type |
| ------ | ------ |
| `schema` | [`TableSchema`](../interfaces/TableSchema.md) |
| `type` | `"createTable"` |

Create a new table with the provided schema.

\{ `column`: `string`; `columnType`: `string`; `isOptional?`: `boolean`; `table`: `string`; `type`: `"addColumn"`; \}

| Name | Type |
| ------ | ------ |
| `column` | `string` |
| `columnType` | `string` |
| `isOptional?` | `boolean` |
| `table` | `string` |
| `type` | `"addColumn"` |

Add a column to an existing table.

\{ `table`: `string`; `type`: `"destroyTable"`; \}

| Name | Type |
| ------ | ------ |
| `table` | `string` |
| `type` | `"destroyTable"` |

Drop an existing table entirely.

\{ `query`: `string`; `type`: `"sql"`; \}

| Name | Type |
| ------ | ------ |
| `query` | `string` |
| `type` | `"sql"` |

Execute arbitrary SQL as part of the migration.
