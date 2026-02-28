---
sidebar_position: 2
title: Migrations
slug: /advanced/migrations
---

# Migrations

When you change your schema (add tables, add columns), you need migrations to update existing databases without losing data.

## Schema Versioning

Set the schema version when creating the database:

```ts
const db = new Database({
  adapter: new SQLiteAdapter({ databaseName: 'myapp', driver }),
  models: [Post, Comment],
  schemaVersion: 2,  // increment when schema changes
});
```

## Migration Steps

Define migrations as an array of steps:

```ts
const migrations: Migration[] = [
  {
    from: 1,
    to: 2,
    steps: [
      { type: 'addTable', table: 'comments', columns: [...] },
      { type: 'addColumn', table: 'posts', column: { name: 'category', type: 'text' } },
    ],
  },
  {
    from: 2,
    to: 3,
    steps: [
      { type: 'addColumn', table: 'posts', column: { name: 'tags', type: 'text' } },
    ],
  },
];
```

## Migration Types

| Step Type | Description |
|-----------|-------------|
| `addTable` | Create a new table |
| `addColumn` | Add a column to an existing table |

:::note
SQLite only supports adding columns — you cannot rename or delete columns. If you need to restructure a table, create a new one and migrate data manually.
:::

## Running Migrations

Pass migrations to the adapter config. They run automatically during `db.initialize()`:

```ts
const adapter = new SQLiteAdapter({
  databaseName: 'myapp',
  driver: createExpoSQLiteDriver(),
  migrations,
});
```

The adapter checks the stored schema version, finds the migration path from the current version to the target version, and runs each step in order within a transaction.

## Tips

- **Always increment** `schemaVersion` when changing the schema
- **Never modify** existing migration steps — they may have already run on users' devices
- **Test migrations** by running them against a database with production-like data
- **Back up** before running migrations in production
