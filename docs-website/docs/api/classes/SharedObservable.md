[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SharedObservable

# Class: SharedObservable\<T\>

SharedObservable caches the latest result and replays to new subscribers.
Runs a producer function when the first subscriber appears,
and tears down when the last subscriber leaves.

## Type Parameters

| Type Parameter |
| ------ |
| `T` |

## Implements

- [`Observable`](../interfaces/Observable.md)\<`T`\>

## Constructors

### Constructor

> **new SharedObservable**\<`T`\>(`producer`): `SharedObservable`\<`T`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `producer` | (`emit`) => `TeardownFn` |

#### Returns

`SharedObservable`\<`T`\>

## Methods

### subscribe()

> **subscribe**(`listener`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `listener` | [`Listener`](../type-aliases/Listener.md)\<`T`\> |

#### Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)

#### Implementation of

[`Observable`](../interfaces/Observable.md).[`subscribe`](../interfaces/Observable.md#subscribe)
