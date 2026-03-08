[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / BehaviorSubject

# Class: BehaviorSubject\<T\>

A BehaviorSubject always has a current value and emits it to new subscribers.

## Extends

- [`Subject`](Subject.md)\<`T`\>

## Type Parameters

| Type Parameter |
| ------ |
| `T` |

## Constructors

### Constructor

> **new BehaviorSubject**\<`T`\>(`initialValue`): `BehaviorSubject`\<`T`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `initialValue` | `T` |

#### Returns

`BehaviorSubject`\<`T`\>

#### Overrides

[`Subject`](Subject.md).[`constructor`](Subject.md#constructor)

## Accessors

### hasValue

#### Get Signature

> **get** **hasValue**(): `boolean`

##### Returns

`boolean`

#### Inherited from

[`Subject`](Subject.md).[`hasValue`](Subject.md#hasvalue)

***

### lastValue

#### Get Signature

> **get** **lastValue**(): `T` \| `undefined`

##### Returns

`T` \| `undefined`

#### Inherited from

[`Subject`](Subject.md).[`lastValue`](Subject.md#lastvalue)

***

### subscriberCount

#### Get Signature

> **get** **subscriberCount**(): `number`

##### Returns

`number`

#### Inherited from

[`Subject`](Subject.md).[`subscriberCount`](Subject.md#subscribercount)

***

### value

#### Get Signature

> **get** **value**(): `T`

##### Returns

`T`

## Methods

### next()

> **next**(`value`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `T` |

#### Returns

`void`

#### Inherited from

[`Subject`](Subject.md).[`next`](Subject.md#next)

***

### subscribe()

> **subscribe**(`listener`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `listener` | [`Listener`](../type-aliases/Listener.md)\<`T`\> |

#### Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)

#### Inherited from

[`Subject`](Subject.md).[`subscribe`](Subject.md#subscribe)
