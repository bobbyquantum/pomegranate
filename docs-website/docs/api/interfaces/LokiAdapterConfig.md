[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / LokiAdapterConfig

# Interface: LokiAdapterConfig

## Extends

- `AdapterConfig`

## Properties

### autosaveInterval?

> `optional` **autosaveInterval**: `number`

Autosave interval in ms when `saveStrategy: 'auto'`. Default: 500.

***

### databaseName

> `readonly` **databaseName**: `string`

#### Inherited from

`AdapterConfig.databaseName`

***

### lokiInstance?

> `optional` **lokiInstance**: `unknown`

Optional: provide your own Loki instance (direct mode only, not serializable).

***

### persistenceAdapter?

> `optional` **persistenceAdapter**: `unknown`

Optional: LokiJS persistence adapter (e.g., IncrementalIndexedDBAdapter). Direct mode only.

***

### saveStrategy?

> `optional` **saveStrategy**: `"immediate"` \| `"auto"`

When to persist data to storage. Only applies when `persistenceAdapter` is set
(direct mode) or when running in a worker (which auto-creates IndexedDB persistence).

- `'immediate'` — save after every mutation. Safest; data survives instant refresh.
  Slightly slower for rapid writes. **(default)**
- `'auto'` — use LokiJS autosave timer (`autosaveInterval` ms). Faster for bulk
  writes but data written in the last interval may be lost on hard refresh.

***

### schemaVersion?

> `readonly` `optional` **schemaVersion**: `number`

Optional schema version override; normally derived from DatabaseSchema.

#### Inherited from

`AdapterConfig.schemaVersion`

***

### worker?

> `optional` **worker**: [`WorkerInterface`](WorkerInterface.md) \| `Worker`

Web Worker instance for off-main-thread LokiJS execution.
When provided, all database operations dispatch to this worker via postMessage.
The worker auto-creates IncrementalIDBAdapter for IndexedDB persistence.

#### Examples

```ts
// Real Web Worker (bundler must support worker URLs):
import { LokiAdapter } from 'pomegranate-db';
const worker = new Worker(
  new URL('pomegranate-db/dist/adapters/loki/worker/loki.worker.js', import.meta.url),
);
const adapter = new LokiAdapter({ databaseName: 'app', worker });
```

```ts
// Synchronous fallback (for testing the worker protocol):
import { LokiAdapter, SynchronousWorker } from 'pomegranate-db';
const adapter = new LokiAdapter({ databaseName: 'test', worker: new SynchronousWorker() });
```
