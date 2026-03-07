<p align="center">
  <img src="docs-website/static/img/logo.png" alt="PomegranateDB" width="200" />
</p>

<h2 align="center">PomegranateDB</h2>

<h4 align="center">
  Reactive offline-first database for React Native & Expo
</h4>

<p align="center">
  Build powerful React and React Native apps that scale from hundreds to tens of thousands of records and remain <em>fast</em> ⚡️
</p>

---

### ⚡️ Instant Launch
Lazy-loaded — only fetch data when you need it. Your app starts fast no matter how much data you have.

### 📈 Highly Scalable
Handle hundreds to tens of thousands of records with consistent performance.

### 🔄 Offline-First
Built-in sync protocol with push/pull reconciliation. Works offline, syncs when connected.

### ⚛️ Optimized for React
Reactive hooks keep your UI in sync automatically. Zero boilerplate subscriptions.

### 🔌 Pluggable Adapters
LokiJS, Expo SQLite, op-sqlite, or JSI C++. Swap storage backends without changing app code.

### 🔐 Encryption at Rest
Optional AES-GCM encryption or SQLCipher via op-sqlite. Protect user data on-device.

---

## Why PomegranateDB?

- **Schema-first**: Define your models declaratively with full type inference
- **Reactive queries**: UI updates automatically when data changes — via hooks or observables
- **Offline-first sync**: Built-in pull/push protocol that works offline and reconciles on reconnect
- **Pluggable adapters**: Choose the right storage backend for your app — LokiJS (in-memory), Expo SQLite, op-sqlite, or our own JSI C++ adapter
- **TypeScript-native**: The whole codebase is idiomatic TypeScript. Types flow from schema to model to query to component

## Quick Example

```ts
import { m, Model, Database, LokiAdapter } from 'pomegranate-db';

// 1. Define your schema
const PostSchema = m.model('posts', {
  title: m.text(),
  body: m.text(),
  status: m.text(),
  createdAt: m.date('created_at').readonly(),
});

// 2. Create a model class
class Post extends Model<typeof PostSchema> {
  static schema = PostSchema;
}

// 3. Initialize the database
const db = new Database({
  adapter: new LokiAdapter({ databaseName: 'myapp' }),
  models: [Post],
});

await db.initialize();

// 4. Write data
await db.write(async () => {
  await db.get(Post).create({
    title: 'Hello World',
    body: 'My first post',
    status: 'draft',
  });
});

// 5. Query data
const posts = await db.get(Post)
  .query()
  .where('status', 'draft')
  .fetch();
```

## React Integration

```tsx
import { DatabaseProvider, useLiveQuery } from 'pomegranate-db';

function App() {
  return (
    <DatabaseProvider value={db}>
      <PostList />
    </DatabaseProvider>
  );
}

function PostList() {
  const { results: posts, isLoading } = useLiveQuery(Post, (q) =>
    q.where('status', 'eq', 'published').orderBy('created_at', 'desc'),
  );

  if (isLoading) return <Text>Loading...</Text>;

  return posts.map((post) => (
    <Text key={post.id}>{post.title}</Text>
  ));
}
```

## Installation

```sh
npm install pomegranate-db
```

Install adapter-specific peers only when you use those entry points:

- `pomegranate-db` -> `react`
- `pomegranate-db/expo` -> `react`, `expo-sqlite`
- `pomegranate-db/encryption` -> no extra peers, uses Web Crypto
- `pomegranate-db/encryption/node` -> Node.js only
- `pomegranate-db/encryption/react-native` -> React Native / Expo Web Crypto runtime
- `pomegranate-db/op-sqlite` -> `@op-engineering/op-sqlite`
- `pomegranate-db/native-sqlite` -> React Native app with the bundled native module

## Entry Points

PomegranateDB ships a small set of explicit subpath exports for common setups:

```ts
import { Database, LokiAdapter } from 'pomegranate-db'
import { createExpoSQLiteDriver } from 'pomegranate-db/expo'
import { EncryptingAdapter } from 'pomegranate-db/encryption'
import { nodeCryptoProvider } from 'pomegranate-db/encryption/node'
import { createOpSQLiteDriver } from 'pomegranate-db/op-sqlite'
import { createNativeSQLiteDriver } from 'pomegranate-db/native-sqlite'
```

The root package intentionally excludes encryption exports so Expo Snack can install
`pomegranate-db` without resolving Node's `crypto` module. Import encryption through
the explicit `./encryption`, `./encryption/node`, or `./encryption/react-native`
subpaths instead.

## Migrations

Manual migrations are supported across Loki and SQLite adapters with these step types:

- `createTable`
- `addColumn`
- `destroyTable`
- `sql`

Use `sql` for targeted backfills such as setting a new column value on existing rows.
Schema diff generation is not automated yet, so migration steps are still authored manually.

## Next Steps

- [Installation](https://bobbyquantum.github.io/pomegranate/installation) — add PomegranateDB to your project
- [Schema & Models](https://bobbyquantum.github.io/pomegranate/schema) — define your data model
- [CRUD Operations](https://bobbyquantum.github.io/pomegranate/crud) — create, read, update, delete
- [React Hooks](https://bobbyquantum.github.io/pomegranate/react-hooks) — reactive UI integration

## License

MIT
