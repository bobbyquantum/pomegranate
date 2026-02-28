---
sidebar_position: 2
title: LokiJS Adapter
slug: /adapters/loki
---

# LokiJS Adapter

The `LokiAdapter` is backed by the real [LokiJS](https://github.com/techfort/LokiJS) library — a fast, in-memory document database with optional persistence. It's the simplest adapter — no native dependencies, works in Node.js, browsers, and React Native.

## Usage

```ts
import { Database, LokiAdapter } from 'pomegranate-db';

const db = new Database({
  adapter: new LokiAdapter({ databaseName: 'myapp' }),
  models: [Post, Comment],
});
```

## When to Use

- **Jest tests** — fast, deterministic, no native setup
- **Prototyping** — get started immediately
- **Web applications** — with or without persistence
- **Development** — quick iteration without native builds

## Persistence

By default, `LokiAdapter` runs in-memory and data is lost when the process exits. You can enable persistence by passing a LokiJS persistence adapter:

**Browser (IndexedDB):**
```ts
import LokiIndexedAdapter from 'lokijs/src/loki-indexed-adapter';

const adapter = new LokiAdapter({
  databaseName: 'myapp',
  persistenceAdapter: new LokiIndexedAdapter(),
  autoSave: true,
  autoSaveInterval: 5000, // ms
});
```

**Node.js (filesystem):**
```ts
const LokiFsAdapter = require('lokijs/src/loki-fs-structured-adapter');

const adapter = new LokiAdapter({
  databaseName: 'myapp',
  persistenceAdapter: new LokiFsAdapter(),
  autoSave: true,
});
```

## Limitations

- **Not suitable for very large datasets** — everything lives in memory (persistence adapters save/load the full DB)
- **No encryption** — use the `EncryptingAdapter` wrapper for at-rest encryption

## With Encryption

Wrap `LokiAdapter` with `EncryptingAdapter` for AES-GCM encryption:

```ts
import { LokiAdapter, EncryptingAdapter } from 'pomegranate-db';

const adapter = new EncryptingAdapter({
  adapter: new LokiAdapter({ databaseName: 'myapp' }),
  password: 'user-secret',
});
```

## Configuration

```ts
interface LokiAdapterConfig {
  /** Name of the database (used as filename when persistence is enabled) */
  databaseName: string;
  /** Optional: provide your own Loki instance */
  lokiInstance?: LokiInstance;
  /** Optional: LokiJS persistence adapter (e.g. LokiIndexedAdapter, LokiFsAdapter) */
  persistenceAdapter?: unknown;
  /** Enable auto-save. Default: false */
  autoSave?: boolean;
  /** Auto-save interval in ms. Default: 5000 */
  autoSaveInterval?: number;
}
```
