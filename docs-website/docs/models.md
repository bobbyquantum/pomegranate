---
sidebar_position: 4
title: Models
slug: /models
---

# Models

Models are TypeScript classes that represent rows in your database tables. They combine a schema definition with instance methods for reading and writing data.

## Defining a Model

```ts
import { m, Model } from 'pomegranate-db';

const PostSchema = m.model('posts', {
  title: m.text(),
  body: m.text(),
  status: m.text().default('draft'),
  createdAt: m.date('created_at').readonly(),
});

class Post extends Model<typeof PostSchema> {
  static schema = PostSchema;

  // Custom getters
  get isPublished(): boolean {
    return this.status === 'published';
  }

  // Custom methods
  get preview(): string {
    return this.body.slice(0, 100) + '...';
  }
}
```

## Reading Fields

Model fields are accessed as regular properties. The types are inferred from the schema:

```ts
post.id         // string (auto-generated UUID)
post.title      // string
post.body       // string
post.status     // string
post.createdAt  // Date
```

## Updating Records

Updates must happen inside a `db.write()` block:

```ts
await db.write(async () => {
  await post.update({ status: 'published' });
});
```

Only the fields you pass will be changed. Readonly fields (like `createdAt`) cannot be updated.

## Deleting Records

PomegranateDB uses **soft deletes** by default (for sync compatibility). Records are marked as deleted but not physically removed until sync:

```ts
await db.write(async () => {
  await post.markAsDeleted();
});
```

To physically delete (for local-only data):

```ts
await db.write(async () => {
  await post.destroyPermanently();
});
```

## Observing Changes

You can subscribe to changes on a single record:

```ts
const unsubscribe = post.observe().subscribe((updatedPost) => {
  console.log('Post changed:', updatedPost.title);
});

// Later:
unsubscribe();
```

Or observe a specific field:

```ts
post.observeField('status').subscribe((status) => {
  console.log('Status is now:', status);
});
```

## Registering Models

Models are registered when creating the database:

```ts
const db = new Database({
  adapter: new LokiAdapter({ databaseName: 'myapp' }),
  models: [Post, Comment, User],
});
```

Each model class must have a unique `static schema` with a unique table name.
