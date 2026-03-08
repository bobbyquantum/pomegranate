---
sidebar_position: 3
title: Schema
slug: /schema
---

# Schema

PomegranateDB uses a **schema-first** approach. You define your data model using the `m` builder, and TypeScript infers all the types automatically.

## The `m` Builder

The `m` object provides methods for defining columns, relations, and complete model schemas.

### Column Types

```ts
import { m } from 'pomegranate-db';

m.text()          // string column
m.number()        // numeric column
m.boolean()       // boolean column (stored as 0/1 in SQLite)
m.date()          // date column (stored as epoch milliseconds)
```

### Column Options

Columns can be customized with chained modifiers:

```ts
m.text('column_name')        // explicit SQL column name (default: camelCase → snake_case)
m.text().default('draft')    // default value
m.text().readonly()          // cannot be changed after creation
m.text().indexed()           // create a database index
m.boolean().default(false)   // boolean with default
m.date('created_at').readonly()  // immutable timestamp
```

### Defining a Model Schema

Use `m.model(tableName, fields)` to create a complete schema:

```ts
const PostSchema = m.model('posts', {
  title: m.text(),
  body: m.text(),
  status: m.text().default('draft'),
  viewCount: m.number('view_count').default(0),
  isPublished: m.boolean('is_published').default(false),
  createdAt: m.date('created_at').readonly(),
  updatedAt: m.date('updated_at'),
});
```

The first argument is the **table name** in the database. Field names in JavaScript can differ from column names in SQL — pass the SQL column name as the first argument to any column builder, or let PomegranateDB infer it.

If you have already shipped your app, treat schema changes as an upgrade path problem, not just a type change. See [Migrations](./advanced/migrations) for the manual schema-evolution workflow.

### Relations

Relations use **thunks** (arrow functions returning a schema) so that TypeScript can infer the related model type — and forward references work even when schemas are defined in any order.

```ts
const UserSchema = m.model('users', {
  name: m.text(),
  email: m.text().indexed(),
});

const CommentSchema = m.model('comments', {
  body: m.text(),
  // Many-to-one: a comment belongs to a post
  post: m.belongsTo(() => PostSchema, { key: 'post_id' }),
  // A comment belongs to an author
  author: m.belongsTo(() => UserSchema, { key: 'author_id' }),
});

const PostSchema = m.model('posts', {
  title: m.text(),
  body: m.text(),
  // Many-to-one: a post belongs to an author
  author: m.belongsTo(() => UserSchema, { key: 'author_id' }),
  // One-to-many: a post has many comments (query-only, no stored column)
  comments: m.hasMany(() => CommentSchema, { foreignKey: 'post_id' }),
});
```

- `m.belongsTo(() => Schema, { key })` — adds a foreign key column to this table
- `m.hasMany(() => Schema, { foreignKey })` — declares a query-time relation (no column stored)

## Built-In Sync Columns

Every table automatically gets these columns for sync support:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | text | Primary key (UUID, auto-generated) |
| `_status` | text | Sync status: `synced`, `created`, `updated`, `deleted` |
| `_changed` | text | Comma-separated list of changed column names |

You don't need to declare these — they're added automatically.

## Type Inference

The schema carries full type information. When you extend `Model<typeof YourSchema>`, all field types are inferred:

```ts
class Post extends Model<typeof PostSchema> {
  static schema = PostSchema;

  // Define typed relation getters
  get author() { return this.belongsTo('author'); }
  get comments() { return this.hasMany('comments'); }
}

// TypeScript knows:
// post.title      → string
// post.viewCount  → number
// post.isPublished → boolean
// post.createdAt  → Date

// Relation handles — fully typed from the schema:
// post.author     → BelongsToRelation<typeof UserSchema>
// post.comments   → HasManyRelation<typeof CommentSchema>

// Usage:
const author = await post.author.fetch();   // ModelInstance<typeof UserSchema> | null
const comments = await post.comments.fetch(); // ModelInstance<typeof CommentSchema>[]
post.author.observe();   // Observable<ModelInstance<typeof UserSchema> | null>
post.comments.observe(); // Observable<ModelInstance<typeof CommentSchema>[]>
```

See [Models](./models) for how to use schemas with model classes.
