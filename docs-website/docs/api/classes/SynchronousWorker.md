[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SynchronousWorker

# Class: SynchronousWorker

Interface matching what Worker and SynchronousWorker both implement

## Implements

- [`WorkerInterface`](../interfaces/WorkerInterface.md)

## Constructors

### Constructor

> **new SynchronousWorker**(): `SynchronousWorker`

#### Returns

`SynchronousWorker`

## Properties

### onmessage

> **onmessage**: (`event`) => `void` \| `null` = `null`

#### Implementation of

[`WorkerInterface`](../interfaces/WorkerInterface.md).[`onmessage`](../interfaces/WorkerInterface.md#onmessage)

## Methods

### postMessage()

> **postMessage**(`data`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `data` | `unknown` |

#### Returns

`void`

#### Implementation of

[`WorkerInterface`](../interfaces/WorkerInterface.md).[`postMessage`](../interfaces/WorkerInterface.md#postmessage)

***

### terminate()

> **terminate**(): `void`

#### Returns

`void`

#### Implementation of

[`WorkerInterface`](../interfaces/WorkerInterface.md).[`terminate`](../interfaces/WorkerInterface.md#terminate)
