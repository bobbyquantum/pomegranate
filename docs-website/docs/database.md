---
sidebar_position: 5
title: Database
slug: /database
---

# Database

The `Database` class is the central entry point of PomegranateDB. It manages collections, coordinates reads and writes, and connects to your storage adapter.

## Creating a Database

```ts
import { Database, LokiAdapter } from 'pomegranate-db';

const db = new Database({
  adapter: new LokiAdapter({ databaseName: 'myapp' }),
  models: [Post, Comment, User],
  schemaVersion: 1,  // optional, defaults to 1
});
```

### Config Options

| Option | Type | Description |
|--------|------|-------------|
| `adapter` | `StorageAdapter` | The storage backend (LokiAdapter, SQLiteAdapter, etc.) |
| `models` | `ModelStatic[]` | Array of model classes to register |
| `schemaVersion` | `number` | Schema version for migrations (default: 1) |

## Initialization

Before using the database, call `initialize()`:

```ts
await db.initialize();
```

This creates tables for fresh installs and prepares the adapter. If the database already exists, this is a no-op unless you reset the database.

Schema upgrades are currently handled separately via the adapter-level migration API described in [Migrations](./advanced/migrations).

## Accessing Collections

Use `db.get(ModelClass)` to get a collection:

```ts
const postsCollection = db.get(Post);

// Create a record
const post = await postsCollection.create({
  title: 'Hello',
  body: 'World',
  status: 'draft',
});

// Find by ID
const post = await postsCollection.findById('some-uuid');

// Query
const drafts = await postsCollection
  .query()
  .where('status', 'draft')
  .fetch();
```

## Writers

All data mutations (create, update, delete) must happen inside a **writer**:

```ts
await db.write(async () => {
  const post = await db.get(Post).create({ title: 'Hello' });
  await post.update({ status: 'published' });
});
```

Writers are serialized — only one writer runs at a time. This prevents data races and ensures consistency.

You can nest operations inside a single writer:

```ts
await db.write(async () => {
  const post = await db.get(Post).create({ title: 'My Post' });
  await db.get(Comment).create({
    body: 'First comment!',
    post_id: post.id,
  });
});
```

## Events

Subscribe to database-level events:

```ts
const unsubscribe = db.events.subscribe((event) => {
  if (event.type === 'batch') {
    console.log('Records changed:', event.changes);
  } else if (event.type === 'reset') {
    console.log('Database was reset');
  }
});
```

## Reset

Completely wipe the database:

```ts
await db.reset();
```

This drops all data and re-creates the schema. Use with caution.

## Available Tables

```ts
db.tables  // string[] — list of all registered table names
```
