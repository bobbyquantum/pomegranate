[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / InferRecord

# Type Alias: InferRecord\<F\>

> **InferRecord**\<`F`\> = `object` & `{ readonly [K in keyof F]: InferField<F[K]> }`

Full record shape (all columns + relation wrappers)

## Type Declaration

| Name | Type |
| ------ | ------ |
| `id` | `string` |

## Type Parameters

| Type Parameter |
| ------ |
| `F` *extends* [`SchemaFields`](SchemaFields.md) |
