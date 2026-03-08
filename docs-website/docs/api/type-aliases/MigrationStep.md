[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / MigrationStep

# Type Alias: MigrationStep

> **MigrationStep** = \{ `schema`: [`TableSchema`](../interfaces/TableSchema.md); `type`: `"createTable"`; \} \| \{ `column`: `string`; `columnType`: `string`; `isOptional?`: `boolean`; `table`: `string`; `type`: `"addColumn"`; \} \| \{ `table`: `string`; `type`: `"destroyTable"`; \} \| \{ `query`: `string`; `type`: `"sql"`; \}
