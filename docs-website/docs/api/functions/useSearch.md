[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / useSearch

# Function: useSearch()

> **useSearch**\<`M`\>(`collection`, `options`, `deps?`): [`UseSearchResult`](../interfaces/UseSearchResult.md)\<`M`\>

Full-text search with pagination and live results.

## Type Parameters

| Type Parameter |
| ------ |
| `M` *extends* [`Model`](../classes/Model.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\> |

## Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `collection` | [`Collection`](../classes/Collection.md)\<`M`\> \| `null` \| `undefined` | `undefined` |
| `options` | [`UseSearchOptions`](../interfaces/UseSearchOptions.md) | `undefined` |
| `deps` | `unknown`[] | `[]` |

## Returns

[`UseSearchResult`](../interfaces/UseSearchResult.md)\<`M`\>
