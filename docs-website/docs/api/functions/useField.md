[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / useField

# Function: useField()

> **useField**\<`M`\>(`record`, `fieldName`): `object`

Observe a specific field on a record.
Only re-renders when that field changes.

## Type Parameters

| Type Parameter |
| ------ |
| `M` *extends* [`Model`](../classes/Model.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\> |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `record` | `M` \| `null` \| `undefined` |
| `fieldName` | `string` |

## Returns

`object`

| Name | Type |
| ------ | ------ |
| `isLoading` | `boolean` |
| `value` | `unknown` |
