[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / useCount

# Function: useCount()

> **useCount**\<`M`\>(`collection`, `buildQuery?`, `deps?`): `object`

Observe the count of records matching a query.

## Type Parameters

| Type Parameter |
| ------ |
| `M` *extends* [`Model`](../classes/Model.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\> |

## Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `collection` | [`Collection`](../classes/Collection.md)\<`M`\> \| `null` \| `undefined` | `undefined` |
| `buildQuery?` | (`qb`) => `void` | `undefined` |
| `deps?` | `unknown`[] | `[]` |

## Returns

`object`

| Name | Type |
| ------ | ------ |
| `count` | `number` |
| `isLoading` | `boolean` |
