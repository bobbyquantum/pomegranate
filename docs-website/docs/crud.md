---
sidebar_position: 6
title: CRUD Operations
slug: /crud
---

# CRUD Operations

All data mutations in PomegranateDB happen inside a `db.write()` block. Reads can happen anywhere.

## Create

```ts
await db.write(async () => {
  const post = await db.get(Post).create({
    title: 'New Post',
    body: 'Content here...',
    status: 'draft',
  });
  console.log(post.id); // auto-generated UUID
});
```

Fields with defaults can be omitted:

```ts
// If status has default('draft'), you can skip it:
await db.get(Post).create({ title: 'Hello', body: 'World' });
```

## Read

### Find by ID

```ts
const post = await db.get(Post).findById('some-uuid');
// Returns the model instance, or null if not found
```

### Query

```ts
const posts = await db.get(Post)
  .query()
  .where('status', 'published')
  .orderBy('created_at', 'desc')
  .limit(20)
  .fetch();
```

### Count

```ts
const count = await db.get(Post)
  .query()
  .where('status', 'draft')
  .count();
```

### Full-Text Search

```ts
const results = await db.get(Post).search({
  query: 'react native',
  columns: ['title', 'body'],
  limit: 50,
});
```

## Update

```ts
await db.write(async () => {
  await post.update({
    title: 'Updated Title',
    status: 'published',
  });
});
```

Only the fields you include in the patch will change. If the model schema marks a field as `readonly()`, attempting to update it will throw an error.

## Delete

### Soft Delete (recommended for synced apps)

```ts
await db.write(async () => {
  await post.markAsDeleted();
});
```

The record's `_status` is set to `'deleted'`. It will be physically removed after the next successful sync push.

### Hard Delete

```ts
await db.write(async () => {
  await post.destroyPermanently();
});
```

Permanently removes the record from the database. Use this for local-only data that doesn't need sync.

## Batch Operations

For bulk writes, use batch operations for better performance:

```ts
await db.write(async () => {
  await db._adapter.batch([
    { type: 'create', table: 'posts', rawRecord: { id: '1', title: 'A', ... } },
    { type: 'create', table: 'posts', rawRecord: { id: '2', title: 'B', ... } },
    { type: 'update', table: 'posts', rawRecord: { id: '3', title: 'Updated', ... } },
    { type: 'markAsDeleted', table: 'posts', id: '4' },
  ]);
});
```

Batch operations run in a single database transaction for atomicity and performance.
