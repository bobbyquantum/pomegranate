[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / useLiveQuery

# Function: useLiveQuery()

> **useLiveQuery**\<`M`\>(`collection`, `buildQuery?`, `deps?`): `object`

Execute a query and subscribe to live updates.
Re-runs the query whenever the collection changes.

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
| `isLoading` | `boolean` |
| `results` | `M`[] |
