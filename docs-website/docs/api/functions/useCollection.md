[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / useCollection

# Function: useCollection()

> **useCollection**\<`M`\>(`modelClass`): [`Collection`](../classes/Collection.md)\<`M`\>

Get a collection by model class from context.

## Type Parameters

| Type Parameter |
| ------ |
| `M` *extends* [`Model`](../classes/Model.md)\<[`ModelSchema`](../interfaces/ModelSchema.md)\<[`SchemaFields`](../type-aliases/SchemaFields.md)\>\> |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `modelClass` | \{ `schema`: \{ `table`: `string`; \}; \} |
| `modelClass.schema` | \{ `table`: `string`; \} |
| `modelClass.schema.table` | `string` |

## Returns

[`Collection`](../classes/Collection.md)\<`M`\>
