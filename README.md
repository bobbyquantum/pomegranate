# PomegranateDB

Reactive offline-first database with sync support. TypeScript-native, schema-first, no decorators.

## Features

- **Schema-first** model definition with full type inference
- **Reactive queries** with first-class React hooks
- **Offline-first** with sync protocol support
- **Pluggable storage**: SQLite and LokiJS adapters
- **Optional encryption** at rest (AES-GCM)
- **TypeScript-native** — no Babel decorators

## Quick Start

```ts
import { m, Model, Database, SQLiteAdapter } from 'pomegranate-db';

// Define schema
const PostSchema = m.model('posts', {
  title: m.text(),
  body: m.text(),
  status: m.text(),
  createdAt: m.date('created_at').readonly(),
});

class Post extends Model<typeof PostSchema> {
  static schema = PostSchema;
}

// Create database
const db = new Database({
  adapter: new SQLiteAdapter({ databaseName: 'app.db' }),
  models: [Post],
});

// Write data
await db.write(async () => {
  await db.get(Post).create({ title: 'Hello', body: 'World', status: 'draft' });
});
```

## License

MIT
