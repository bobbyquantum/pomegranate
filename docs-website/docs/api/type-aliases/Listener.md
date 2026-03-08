[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / Listener

# Type Alias: Listener()\<T\>

> **Listener**\<`T`\> = (`value`) => `void`

Lightweight observable primitives.

We avoid pulling in RxJS by implementing a minimal Subject/Observable
that covers the use-cases we need: change notification for records,
collections, and live queries.

## Type Parameters

| Type Parameter |
| ------ |
| `T` |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `T` |

## Returns

`void`
