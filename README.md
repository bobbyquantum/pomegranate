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

## Next Steps

- [Installation](https://bobbyquantum.github.io/pomegranate/docs/installation) — add PomegranateDB to your project
- [Schema & Models](https://bobbyquantum.github.io/pomegranate/docs/schema) — define your data model
- [CRUD Operations](https://bobbyquantum.github.io/pomegranate/docs/crud) — create, read, update, delete
- [React Hooks](https://bobbyquantum.github.io/pomegranate/docs/react-hooks) — reactive UI integration

## License

MIT
