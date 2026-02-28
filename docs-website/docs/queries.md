---
sidebar_position: 7
title: Queries
slug: /queries
---

# Queries

PomegranateDB provides a fluent query builder for constructing type-safe database queries.

## Basic Queries

```ts
const posts = await db.get(Post)
  .query()
  .where('status', 'published')
  .fetch();
```

The two-argument form of `where` uses equality by default:
```ts
.where('status', 'published')
// equivalent to:
.where('status', 'eq', 'published')
```

## Comparison Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `eq` | Equal | `.where('status', 'eq', 'draft')` |
| `neq` | Not equal | `.where('status', 'neq', 'deleted')` |
| `gt` | Greater than | `.where('count', 'gt', 10)` |
| `gte` | Greater or equal | `.where('count', 'gte', 10)` |
| `lt` | Less than | `.where('count', 'lt', 100)` |
| `lte` | Less or equal | `.where('count', 'lte', 100)` |
| `in` | In array | `.where('status', 'in', ['draft', 'review'])` |
| `notIn` | Not in array | `.where('status', 'notIn', ['deleted'])` |
| `like` | SQL LIKE | `.where('title', 'like', '%react%')` |
| `notLike` | SQL NOT LIKE | `.where('title', 'notLike', '%test%')` |
| `between` | Between range | `.where('count', 'between', [10, 100])` |
| `isNull` | Is null | `.where('deletedAt', 'isNull', true)` |
| `isNotNull` | Is not null | `.where('title', 'isNotNull', true)` |

## Compound Conditions

### AND

```ts
const results = await db.get(Post)
  .query()
  .where('status', 'published')
  .where('viewCount', 'gt', 100)  // implicit AND
  .fetch();
```

For explicit grouping:

```ts
.and((q) => {
  q.where('status', 'published');
  q.where('viewCount', 'gt', 100);
})
```

### OR

```ts
const results = await db.get(Post)
  .query()
  .or((q) => {
    q.where('status', 'draft');
    q.where('status', 'review');
  })
  .fetch();
```

### Nesting

Combine `and` and `or` for complex conditions:

```ts
const results = await db.get(Post)
  .query()
  .where('isPublished', true)
  .or((q) => {
    q.where('viewCount', 'gt', 1000);
    q.and((inner) => {
      inner.where('status', 'featured');
      inner.where('createdAt', 'gt', lastWeek);
    });
  })
  .fetch();
```

## Sorting

```ts
.orderBy('created_at', 'desc')
.orderBy('title', 'asc')
```

Multiple `orderBy` calls chain — first by `created_at` descending, then by `title` ascending.

## Pagination

```ts
.limit(20)    // max 20 results
.offset(40)   // skip first 40 results
```

## Count

```ts
const count = await db.get(Post)
  .query()
  .where('status', 'published')
  .count();
```

## Observing Queries

Subscribe to live query results with `observe()`:

```ts
const observable = db.get(Post)
  .query()
  .where('status', 'published')
  .observe();

const unsubscribe = observable.subscribe((posts) => {
  console.log('Published posts:', posts.length);
});
```

The observable emits a new result set whenever the underlying data changes.

See [React Hooks](./react-hooks) for ergonomic React integration.

## Full-Text Search

```ts
const results = await db.get(Post).search({
  query: 'react native database',
  columns: ['title', 'body'],
  limit: 50,
});
```

Search uses SQL LIKE with `%term%` matching by default. Each search term must match at least one of the specified columns.
