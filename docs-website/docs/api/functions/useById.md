[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / useById

# Function: useById()

> **useById**\<`M`\>(`collection`, `id`): `object`

Observe a single record by ID.
Returns null if not found, undefined while loading.

## Type Parameters

| Type Parameter |
| ------ |
| `M` *extends* [`Model`](../classes/Model.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\> |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `collection` | [`Collection`](../classes/Collection.md)\<`M`\> \| `null` \| `undefined` |
| `id` | `string` \| `null` \| `undefined` |

## Returns

`object`

| Name | Type |
| ------ | ------ |
| `isLoading` | `boolean` |
| `record` | `M` \| `null` \| `undefined` |
