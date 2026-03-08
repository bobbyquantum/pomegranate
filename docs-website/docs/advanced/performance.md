---
sidebar_position: 3
title: Performance
slug: /advanced/performance
---

# Performance Tips

PomegranateDB is designed for performance out of the box, but here are tips to get the most out of it.

## Start with the right adapter

Different adapters optimize for different environments:

1. **LokiAdapter** - simplest setup, great for smaller datasets and tests
2. **Expo SQLite** - best default for Expo apps, with statement caching in sync mode
3. **op-sqlite** - strong performance for bare React Native apps, JSI-based
4. **Native JSI** - best fit when you want the bundled native SQLite path

If you expect thousands of records, frequent sorting/filtering, or complex query shapes, prefer a SQLite-backed adapter over Loki.

## Keep writes inside one writer

The biggest performance win is usually reducing transaction overhead.

```ts
// Less efficient: each write creates separate adapter work
for (const item of items) {
  await db.write(async () => {
    await db.get(Post).create(item);
  });
}

// Better: one writer, one transaction boundary
await db.write(async () => {
  for (const item of items) {
    await db.get(Post).create(item);
  }
});
```

`db.write()` serializes mutations and, when supported by the adapter, wraps them in a single transaction. That is almost always the right starting point.

For advanced import tools that already operate on raw records, `db.batch()` is available inside `db.write()` to send a prepared list of create/update/delete operations atomically. Avoid reaching into the private `db._adapter` API.

## Index columns you actually filter on

If a column appears in `where()` clauses or `orderBy()` regularly, index it in the schema:

```ts
const PostSchema = m.model('posts', {
  status: m.text().indexed(),
  createdAt: m.date('created_at').indexed(),
});
```

Without an index, SQLite has to scan more rows. That cost grows quickly as your local dataset grows.

## Limit result sets

```ts
// Less efficient: fetches every row
const all = await collection.query().fetch();

// Better: only fetch the page you need
const page = await collection.query()
  .where('status', 'published')
  .orderBy('created_at', 'desc')
  .limit(20)
  .fetch();
```

## Use `count()` when you only need totals

Fetching full records just to compute a total creates unnecessary work.

```ts
// Less efficient
const records = await collection.query().fetch();
const count = records.length;

// Better
const count = await collection.query().count();
```

## Debounce search-driven queries

If your query parameters change rapidly (e.g., search input), debounce:

```ts
const { results } = useSearch(Post, {
  query: searchText,
  columns: ['title', 'body'],
  debounceMs: 300,
});
```

## Keep reactive query graphs small

Each `useLiveQuery()` or observable subscription can trigger re-fetch work. If many components independently observe overlapping query shapes, move the observation boundary higher.

Good patterns:

- Lifting the query to a parent component and passing results as props
- Using `useById` for single records instead of a query
- Using `useField` to observe a single field instead of the whole record

## Keep writer callbacks short

All writes are serialized through a single queue. Minimize time spent inside `db.write()`:

```ts
// Avoid this: network work blocks the writer queue
await db.write(async () => {
  const data = await fetch('/api/data');
  await db.get(Post).create(data);
});

// Prefer this: do slow work first, then write
const data = await fetch('/api/data');
await db.write(async () => {
  await db.get(Post).create(data);
});
```

## Adapter-specific notes

- Expo SQLite uses statement caching in sync mode, so repeated writes with the same SQL shape benefit from reuse.
- SQLite adapters enable WAL-oriented settings and cache tuning internally; you usually get better results from schema/query changes than from hand-tuning PRAGMAs.
- `preferSync: true` for `op-sqlite` favors lower overhead and higher throughput, but long-running work can still block the JS thread. Measure on real devices if you are near the limit.

## When to profile

Profile before refactoring if you notice any of these:

- long list screens re-rendering after unrelated writes
- search inputs feeling laggy on every keystroke
- import flows doing thousands of tiny writes
- heavy work inside `db.write()` callbacks

In practice, query shape, indexing, and writer design matter more than micro-optimizing model code.
