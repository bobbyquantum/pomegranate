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

## Querying Across Relations: `on()`

`on(table, ...)` adds an `EXISTS` sub-query against a related table — the equivalent of WatermelonDB's `Q.on`. It matches records for which at least one related (non-deleted) record satisfies the inner conditions.

```ts
// comments whose task is done
db.get(Comment).query((q) => q.on('tasks', 'done', true));

// projects with at least one closed task that has an approved comment
db.get(Project).query((q) =>
  q.on('tasks', (t) => t.where('status', 'closed').on('comments', 'approved', true)),
);
```

The join columns are resolved from the association between the two tables, looked up in this order:

1. Schema relations — `m.belongsTo()` / `m.hasMany()` fields.
2. `static associations` on the model class, keyed by the related **table name** (useful when the foreign key is declared as an ordinary column):

```ts
class Task extends Model<typeof TaskSchema> {
  static schema = TaskSchema;
  static associations: ModelAssociations = {
    projects: { type: 'belongs_to', key: 'project_id' },
    comments: { type: 'has_many', foreignKey: 'task_id' },
  };
}
```

`belongs_to` joins `outer.<key> = inner.id`; `has_many` joins `outer.id = inner.<foreignKey>`. If neither source knows the table, `on()` throws. To join without association metadata, give the columns explicitly:

```ts
q.onColumns('projects', 'project_id', 'id', (p) => p.where('archived', false));
```

Inner builders accept every operator, `and`/`or`, and further `on()` calls. On SQLite this compiles to a correlated `EXISTS (SELECT 1 FROM ...)` with every column qualified by its table; the Loki adapter evaluates the inner query first and rewrites the clause to an `IN` list.

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

The observable emits once on subscribe, then whenever the **set or order of matching records** changes (WatermelonDB `observe()`). Updates that cannot affect the result — an update to a column the query does not reference, on a record outside the result set — do not even re-run the query.

To also re-emit when specific columns change on a matched record (WatermelonDB `observeWithColumns()`), pass the column names:

```ts
db.get(Post).observeQuery(query, { columns: ['title', 'updated_at'] });
// or
db.get(Post).observeQueryWithColumns(query, ['title', 'updated_at']);
```

`observeCount(query)` follows the same rules and emits only when the count changes. Queries using `on()` also re-run when the related table changes.

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
