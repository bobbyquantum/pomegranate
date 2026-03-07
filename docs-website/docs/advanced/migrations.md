---
sidebar_position: 2
title: Migrations
slug: /advanced/migrations
---

# Migrations

When you change a shipped schema, you need migrations to preserve user data while evolving tables and columns.

PomegranateDB currently supports manual migrations across Loki and SQLite adapters. The adapter-level migration API is available today, but automatic schema diffing and auto-run wiring are not implemented yet, so you author `Migration[]` yourself and call `adapter.migrate(migrations)` during startup.

## When You Need Migrations

Use migrations whenever an app version has already been released and you change persisted structure, for example:

- adding a new table
- adding a new column to an existing table
- backfilling existing rows after a schema change
- dropping an obsolete table you no longer need

If this is a brand-new app with no installed databases yet, you can just ship the latest schema. Fresh installs create the latest tables immediately and do not need upgrade steps.

## Current Workflow

The current migration workflow has four parts:

1. Update your model schemas to the new structure.
2. Bump `schemaVersion` on `Database`.
3. Add one or more `Migration` objects describing how older installs should move forward.
4. Call `adapter.migrate(migrations)` during initialization.

Fresh installs start at the latest schema version, so `migrate()` becomes a no-op. Existing installs keep their stored version until your migration steps run.

## Define Migrations

`Migration` and `TableSchema` are exported from `pomegranate-db`, so you can keep a dedicated `migrations.ts` file next to your models:

```ts
import type { Migration, TableSchema } from 'pomegranate-db';

const TagsTable: TableSchema = {
  name: 'tags',
  columns: [
    { name: 'name', type: 'text', isOptional: false, isIndexed: false },
    { name: 'color', type: 'text', isOptional: false, isIndexed: false },
  ],
};

export const migrations: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    steps: [
      { type: 'createTable', schema: TagsTable },
      {
        type: 'addColumn',
        table: 'posts',
        column: 'category',
        columnType: 'TEXT',
        isOptional: true,
      },
      {
        type: 'sql',
        query: 'UPDATE "posts" SET "category" = \'general\' WHERE "category" IS NULL',
      },
    ],
  },
  {
    fromVersion: 2,
    toVersion: 3,
    steps: [{ type: 'destroyTable', table: 'legacy_drafts' }],
  },
];
```

### Migration Object Shape

- `fromVersion`: schema version the migration starts from
- `toVersion`: schema version after the steps finish
- `steps`: ordered operations applied inside that version jump

Keep versions sequential and contiguous. A clean history like `1 -> 2 -> 3` is easier to reason about and test than large jumps.

## Run Migrations At Startup

Because migrations are manual today, hold onto the adapter instance you pass into `Database` and invoke `migrate()` after initialization:

```ts
import { Database, SQLiteAdapter, createExpoSQLiteDriver } from 'pomegranate-db';
import { migrations } from './migrations';

const adapter = new SQLiteAdapter({
  databaseName: 'myapp',
  driver: createExpoSQLiteDriver(),
});

const db = new Database({
  adapter,
  models: [Post, Comment, Tag],
  schemaVersion: 3,
});

await db.initialize();
await adapter.migrate(migrations);
```

This startup order works for both cases:

- Fresh install: `initialize()` creates the latest schema and stores the latest version, so `migrate()` has nothing to do.
- Upgrade install: `initialize()` opens the existing database, and `migrate()` applies the missing steps and updates the stored schema version.

## Step Reference

| Step Type | Use It For | Required Fields |
|-----------|------------|-----------------|
| `createTable` | Adding a brand-new table | `schema` |
| `addColumn` | Adding a new column to an existing table | `table`, `column`, `columnType` |
| `destroyTable` | Dropping an obsolete table | `table` |
| `sql` | Backfills or targeted one-off data fixes | `query` |

### `createTable`

Use `createTable` when you add a new model/table. The step expects a `TableSchema`, not a `ModelSchema`, so include the final persisted column names:

```ts
{
  type: 'createTable',
  schema: {
    name: 'comments',
    columns: [
      { name: 'body', type: 'text', isOptional: false, isIndexed: false },
      { name: 'post_id', type: 'text', isOptional: false, isIndexed: true },
      { name: 'created_at', type: 'date', isOptional: false, isIndexed: false },
    ],
  },
}
```

### `addColumn`

Use SQL column types for `columnType`, such as `TEXT`, `INTEGER`, or `REAL`:

```ts
{
  type: 'addColumn',
  table: 'posts',
  column: 'published_at',
  columnType: 'INTEGER',
  isOptional: true,
}
```

If you add a required field to your model, the safest production rollout is usually:

1. add the column as optional
2. backfill existing rows with `sql`
3. start treating it as required in app code only after old installs have migrated

### `destroyTable`

Use `destroyTable` when you are intentionally removing a table and its data:

```ts
{ type: 'destroyTable', table: 'old_cache_entries' }
```

This is destructive, so only use it when you are certain older data should not be preserved.

### `sql`

Use `sql` for data backfills or cleanup that cannot be expressed as a structural step:

```ts
{
  type: 'sql',
  query: 'UPDATE "posts" SET "slug" = lower(replace("title", " ", "-")) WHERE "slug" IS NULL',
}
```

Prefer narrow, deterministic SQL statements. Treat this as the escape hatch, not the default path.

## Example: Add A Column With Backfill

This is a common schema-evolution pattern:

```ts
export const migrations: Migration[] = [
  {
    fromVersion: 3,
    toVersion: 4,
    steps: [
      {
        type: 'addColumn',
        table: 'tasks',
        column: 'priority',
        columnType: 'INTEGER',
        isOptional: true,
      },
      {
        type: 'sql',
        query: 'UPDATE "tasks" SET "priority" = 0 WHERE "priority" IS NULL',
      },
    ],
  },
];
```

That lets existing records migrate safely while new code can start writing `priority` immediately.

## Best Practices

- Always bump `schemaVersion` when the persisted schema changes.
- Never edit old migrations after release; append a new one instead.
- Keep migration files in source control forever once shipped.
- Make `sql` statements idempotent when possible.
- Test upgrades from real old data, not only fresh installs.
- Prefer additive rollouts: add new structures first, remove old structures later.

## Testing Migrations

At minimum, validate both startup paths:

1. Fresh install path: start with no database and confirm the app initializes cleanly on the newest schema.
2. Upgrade path: create data on the old schema, upgrade the app, run migrations, and verify both data preservation and new structure.

PomegranateDB's own migration coverage includes adapter-level and end-to-end examples in `src/__tests__/migration-e2e.test.ts` and `src/__tests__/sqlite-adapter.test.ts`.

## Current Limitations

- Schema diff generation is not automated yet.
- Migrations are not currently supplied through adapter config or auto-run by `Database.initialize()`.
- Column rename and column drop helpers are not implemented; use additive changes plus targeted SQL or table replacement strategies.

Those limitations are exactly why keeping migrations explicit and well-tested is important today.
