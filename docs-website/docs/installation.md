---
sidebar_position: 2
title: Installation
slug: /installation
---

# Installation

## npm / yarn

```bash
npm install pomegranate-db
# or
yarn add pomegranate-db
```

PomegranateDB has two runtime dependencies: `lokijs` (for the LokiJS adapter) and `uuid` (for ID generation).

## Peer Dependencies

Depending on your adapter choice, you may need additional packages:

| Adapter | Peer Dependency | Install Command |
|---------|----------------|-----------------|
| LokiJS (in-memory, optional persistence) | *none* | Built in |
| Expo SQLite | `expo-sqlite >=14` | `npx expo install expo-sqlite` |
| op-sqlite | `@op-engineering/op-sqlite` | `npm i @op-engineering/op-sqlite` |
| Native JSI | *none* | Requires native module setup |

## Platform Setup

### Expo (recommended for new projects)

PomegranateDB works out of the box with Expo. Just install the package and choose your adapter:

```bash
npm install pomegranate-db
npx expo install expo-sqlite  # if using Expo SQLite adapter
```

```ts
import { Database, SQLiteAdapter } from 'pomegranate-db';
import { createExpoSQLiteDriver } from 'pomegranate-db/expo';

const db = new Database({
  adapter: new SQLiteAdapter({
    databaseName: 'myapp',
    driver: createExpoSQLiteDriver(),
  }),
  models: [/* your models */],
});
```

### Bare React Native

For bare RN projects, you have multiple adapter options:

**LokiJS (in-memory, good for prototyping):**
```ts
import { Database, LokiAdapter } from 'pomegranate-db';

const db = new Database({
  adapter: new LokiAdapter({ databaseName: 'myapp' }),
  models: [/* your models */],
});
```

**op-sqlite (JSI, SQLCipher encryption):**
```bash
npm install @op-engineering/op-sqlite
```
```ts
import { Database, SQLiteAdapter } from 'pomegranate-db';
import { createOpSQLiteDriver } from 'pomegranate-db/src/adapters/op-sqlite';

const db = new Database({
  adapter: new SQLiteAdapter({
    databaseName: 'myapp',
    driver: createOpSQLiteDriver({ encryptionKey: 'optional-secret' }),
  }),
  models: [/* your models */],
});
```

**Native JSI (fastest, built-in C++ SQLite):**
See the [Native JSI Adapter](./adapters/native-jsi) guide for setup.

### Web / Node.js (testing)

For Jest tests or web environments, use the LokiJS adapter — it runs entirely in memory with no native dependencies.

```ts
const db = new Database({
  adapter: new LokiAdapter({ databaseName: 'test' }),
  models: [Post, Comment],
});
```

## TypeScript Configuration

PomegranateDB is written in TypeScript and ships with type declarations. Recommended `tsconfig.json` settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler",
    "target": "ES2020",
    "lib": ["ES2020"]
  }
}
```

## Next Steps

- [Schema & Models](./schema) — define your data model
- [Adapters Overview](./adapters/overview) — compare adapter options
