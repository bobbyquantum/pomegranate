---
sidebar_position: 3
title: Performance
slug: /advanced/performance
---

# Performance Tips

PomegranateDB is designed for performance out of the box, but here are tips to get the most out of it.

## Choose the Right Adapter

Performance (fast → fastest):

1. **LokiAdapter** — fast for small datasets, all in memory
2. **Expo SQLite** — good general performance
3. **op-sqlite** — very fast, JSI-based
4. **Native JSI** — fastest, direct C++ SQLite, prepared statement cache

For apps with >1000 records or complex queries, use a SQLite-based adapter.

## Batch Operations

Instead of individual writes:

```ts
// ❌ Slow — N separate database transactions
for (const item of items) {
  await db.get(Post).create(item);
}

// ✅ Fast — single transaction
await db._adapter.batch(
  items.map((item) => ({
    type: 'create',
    table: 'posts',
    rawRecord: item,
  })),
);
```

Batch operations run in a single SQLite transaction, which is orders of magnitude faster.

## Index Frequently Queried Columns

```ts
const PostSchema = m.model('posts', {
  status: m.text().indexed(),        // ← index for WHERE status = ?
  createdAt: m.date('created_at').indexed(), // ← index for ORDER BY
});
```

Without an index, SQLite performs a full table scan.

## Limit Query Results

```ts
// ❌ Fetches all records
const all = await collection.query().fetch();

// ✅ Fetches only what you need
const page = await collection.query()
  .where('status', 'published')
  .orderBy('created_at', 'desc')
  .limit(20)
  .fetch();
```

## Use Count Instead of Fetch

If you only need the count, don't fetch all records:

```ts
// ❌ Fetches all records just to count them
const records = await collection.query().fetch();
const count = records.length;

// ✅ SQL COUNT — fast, no data transfer
const count = await collection.query().count();
```

## Debounce Reactive Queries

If your query parameters change rapidly (e.g., search input), debounce:

```ts
const { results } = useSearch(Post, {
  query: searchText,
  columns: ['title', 'body'],
  debounceMs: 300,  // ← wait 300ms after last keystroke
});
```

## Minimize Observed Queries

Each `useLiveQuery` hook creates a subscription. If you have many components each observing different queries, consider:

- Lifting the query to a parent component and passing results as props
- Using `useById` for single records instead of a query
- Using `useField` to observe a single field instead of the whole record

## Writer Queue

All writes are serialized through a single queue. Minimize time spent inside `db.write()`:

```ts
// ❌ Network call inside writer blocks all other writes
await db.write(async () => {
  const data = await fetch('/api/data'); // DON'T do this
  await db.get(Post).create(data);
});

// ✅ Fetch first, then write
const data = await fetch('/api/data');
await db.write(async () => {
  await db.get(Post).create(data);
});
```
