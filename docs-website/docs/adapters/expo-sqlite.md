---
sidebar_position: 4
title: Expo SQLite Driver
slug: /adapters/expo-sqlite
---

# Expo SQLite Driver

The Expo SQLite driver wraps [`expo-sqlite`](https://docs.expo.dev/versions/latest/sdk/sqlite/) for use with PomegranateDB's `SQLiteAdapter`. Works on **iOS, Android, and web**.

## Installation

```bash
npx expo install expo-sqlite
```

## Usage

```ts
import { Database, SQLiteAdapter } from 'pomegranate-db';
import { createExpoSQLiteDriver } from 'pomegranate-db/expo';

const db = new Database({
  adapter: new SQLiteAdapter({
    databaseName: 'myapp',
    driver: createExpoSQLiteDriver(),
  }),
  models: [Post, Comment],
});

await db.initialize();
```

### With Suspense

Wrap your app in `<Suspense>` so the database initializes in the background while showing a fallback:

```tsx
import { Suspense } from 'react';
import { DatabaseSuspenseProvider, SQLiteAdapter } from 'pomegranate-db';
import { createExpoSQLiteDriver } from 'pomegranate-db/expo';

const adapter = new SQLiteAdapter({
  databaseName: 'myapp',
  driver: createExpoSQLiteDriver(),
});

export default function App() {
  return (
    <Suspense fallback={<Text>Preparing database…</Text>}>
      <DatabaseSuspenseProvider adapter={adapter} models={[Post, Comment]}>
        <MyApp />
      </DatabaseSuspenseProvider>
    </Suspense>
  );
}
```

## Features

- Uses `expo-sqlite`'s `openDatabaseAsync` API
- Enables WAL journal mode for better concurrent read performance
- Supports exclusive transactions via `withExclusiveTransactionAsync`
- Lazy-loads `expo-sqlite` so this module can be imported without it installed (e.g., in tests)
- **Web support** via wa-sqlite (WASM) — see below

## Configuration

```ts
interface ExpoSQLiteDriverConfig {
  openOptions?: {
    enableChangeListener?: boolean;
  };
}
```

```ts
const driver = createExpoSQLiteDriver({
  openOptions: { enableChangeListener: true },
});
```

## Web Support (WASM)

Since expo-sqlite v14, web is supported through [wa-sqlite](https://nicolo-ribaudo.github.io/nicolo-ribaudo/nicolo-ribaudo.github.io/wa-sqlite/), a WebAssembly build of SQLite. When running on web, `expo-sqlite` automatically uses wa-sqlite — no additional driver setup is needed.

### Expo Router / Metro Web

If you're using **Expo Router** or `npx expo start --web`, web support works out of the box. Expo's Metro web bundler handles the WASM assets automatically.

### Webpack (custom config)

If you're using a custom webpack config (e.g., via `@expo/webpack-config`), you may need to configure WASM file handling:

```js
// webpack.config.js
module.exports = {
  // ...
  experiments: {
    asyncWebAssembly: true,
  },
  module: {
    rules: [
      {
        test: /\.wasm$/,
        type: 'asset/resource',
      },
    ],
  },
};
```

### Storage on Web

On web, expo-sqlite uses the **Origin Private File System (OPFS)** when available (modern browsers), falling back to **IndexedDB** for persistence. Data survives page reloads but is origin-scoped.

## When to Use

- **Expo managed projects** — the natural choice
- **Expo dev builds** — works with EAS Build
- **Cross-platform** — iOS, Android, and web with a single driver
- **Expo web** — full SQLite on the web via WASM, no config needed

## Limitations

- Requires Expo SDK 52+ (expo-sqlite v14+). We recommend **SDK 54+** (expo-sqlite 16).
- No built-in encryption (use `pomegranate-db/encryption/react-native` for JS-level encryption)
- Slightly slower than JSI-based options on native due to async API overhead
- Web WASM is slower than native SQLite, but fine for typical app workloads

