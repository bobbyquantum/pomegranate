[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / InferCreatePatch

# Type Alias: InferCreatePatch\<F\>

> **InferCreatePatch**\<`F`\> = `{ [K in keyof F as F[K] extends ColumnDescriptor ? F[K]["isReadonly"] extends true ? never : K : F[K] extends BelongsToDescriptor ? K : never]: F[K] extends ColumnDescriptor ? MaybeOptional<F[K], InferColumnType<F[K]>> : F[K] extends BelongsToDescriptor ? string : never }`

The record shape inferred from schema fields (writable columns only)

## Type Parameters

| Type Parameter |
| ------ |
| `F` *extends* [`SchemaFields`](SchemaFields.md) |
