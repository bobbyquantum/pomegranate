[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / Subject

# Class: Subject\<T\>

A Subject is an Observable that you can push values into.

NOTE: We use ES `#private` fields (not TypeScript `private`) so that the
internal `Set<Listener<T>>` is invisible to the structural type checker.
Without this, `Subject<Post>` is not assignable to `Subject<Model>` because
`Set` is invariant — a classic generic-variance pitfall.

## Extended by

- [`BehaviorSubject`](BehaviorSubject.md)

## Type Parameters

| Type Parameter |
| ------ |
| `T` |

## Implements

- [`Observable`](../interfaces/Observable.md)\<`T`\>

## Constructors

### Constructor

> **new Subject**\<`T`\>(`initialValue?`): `Subject`\<`T`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `initialValue?` | `T` |

#### Returns

`Subject`\<`T`\>

## Accessors

### hasValue

#### Get Signature

> **get** **hasValue**(): `boolean`

##### Returns

`boolean`

***

### lastValue

#### Get Signature

> **get** **lastValue**(): `T` \| `undefined`

##### Returns

`T` \| `undefined`

***

### subscriberCount

#### Get Signature

> **get** **subscriberCount**(): `number`

##### Returns

`number`

## Methods

### next()

> **next**(`value`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `T` |

#### Returns

`void`

***

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
