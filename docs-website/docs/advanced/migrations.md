---
sidebar_position: 2
title: Migrations
slug: /advanced/migrations
---

# Migrations

When you change a shipped schema, you need migrations to preserve user data while evolving tables and columns.

Migrations are declared once, next to your models, and handed to `Database`. `initialize()` runs the ones an existing install still needs; the sync engine reads the same list to tell your server which tables and columns are new (see [Migration-aware pulls](../sync.md#migration-aware-pulls)).

## When You Need Migrations

Use migrations whenever an app version has already been released and you change persisted structure, for example:

- adding a new table
- adding new columns to an existing table
- backfilling existing rows after a schema change
- dropping an obsolete table you no longer need

If this is a brand-new app with no installed databases yet, you can just ship the latest schema. Fresh installs create the latest tables immediately and do not need upgrade steps.

## Workflow

1. Update your model schemas to the new structure.
2. Bump `schemaVersion` on `Database`.
3. Append a `Migration` from the previous version to the new one.
4. Pass `migrations` (and optionally `migrationEvents`) to `Database`.

```ts
import { Database, SQLiteAdapter, createExpoSQLiteDriver } from 'pomegranate-db';
import { migrations } from './migrations';

const db = new Database({
  adapter: new SQLiteAdapter({ databaseName: 'myapp', driver: createExpoSQLiteDriver() }),
  models: [Post, Comment, Tag],
  schemaVersion: 3,
  migrations,
  migrationEvents: {
    onStart: (from, to) => console.log(`migrating ${from} → ${to}`),
    onSuccess: (from, to) => console.log(`migrated ${from} → ${to}`),
    onError: (error, from, to) => reportError(error, { from, to }),
  },
});

await db.initialize();
```

What `initialize()` does:

- **Fresh install** (no stored version): creates every table at `schemaVersion`. No migration runs and no event fires.
- **Same version**: nothing to do.
- **Older version**: validates that `migrations` form an unbroken chain from the stored version to `schemaVersion`, fires `onStart`, runs the chain through `adapter.migrate()` in one transaction, then fires `onSuccess`. If a step fails, the transaction is rolled back, the stored version is unchanged, `onError` fires and the error is rethrown — the app can show a message or reset the database.
- **Newer version** (the database was written by a newer app): throws. Downgrades are not supported.

The chain is validated before anything runs. Every migration must advance exactly one version (`toVersion === fromVersion + 1`), no two may share a `toVersion`, and every version between the stored one and `schemaVersion` must be covered. Otherwise you get an error naming the gap:

```
Missing migrations between schema versions 1 and 4: 2 → 3, 3 → 4.
```

`adapter.migrate(migrations)` is still available if you want to drive migrations yourself; it applies the migrations whose `fromVersion` is at or above the stored version.

## Define Migrations

`Migration`, `MigrationStep` and `TableSchema` are exported from `pomegranate-db`, so you can keep a dedicated `migrations.ts` file next to your models:

```ts
import type { Migration, TableSchema } from 'pomegranate-db';

const TagsTable: TableSchema = {
  name: 'tags',
  columns: [
    { name: 'name', type: 'text', isOptional: false, isIndexed: false },
    { name: 'color', type: 'text', isOptional: false, isIndexed: true },
  ],
};

export const migrations: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    steps: [
      { type: 'createTable', schema: TagsTable },
      {
        type: 'addColumns',
        table: 'posts',
        columns: [
          { name: 'category', type: 'text', isOptional: true, isIndexed: false },
          { name: 'view_count', type: 'number', isOptional: false, isIndexed: false },
        ],
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
- `toVersion`: schema version after the steps finish — always `fromVersion + 1`
- `steps`: ordered operations applied inside that version jump

## Step Reference

| Step Type | Use It For | Required Fields |
|-----------|------------|-----------------|
| `createTable` | Adding a brand-new table | `schema` |
| `addColumns` | Adding one or more columns to an existing table | `table`, `columns` |
| `addColumn` | Legacy single-column form with a SQL type | `table`, `column`, `columnType` |
| `destroyTable` | Dropping an obsolete table | `table` |
| `sql` | Backfills or targeted one-off data fixes | `query` |

### `createTable`

Use `createTable` when you add a new model/table. The step expects a `TableSchema`, not a `ModelSchema`, so include the final persisted column names. The table is created exactly as on a fresh install: with the `_status` index and an index for every `isIndexed` column.

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

### `addColumns`

Columns use the same descriptors as a table schema and follow the same rules as `createTable`:

- **optional** columns are nullable and default to `NULL`
- **required** columns are `NOT NULL` with the type's default — `''` for `text`, `0` for `number`, `boolean` and `date`

Existing rows receive that default (SQLite through the column default, Loki by filling every document). Indexed columns get their index.

```ts
{
  type: 'addColumns',
  table: 'posts',
  columns: [
    { name: 'published_at', type: 'date', isOptional: true, isIndexed: false },
    { name: 'is_pinned', type: 'boolean', isOptional: false, isIndexed: true },
  ],
}
```

If you add a required field to your model, the safest production rollout is usually:

1. add the column as optional
2. backfill existing rows with `sql`
3. start treating it as required in app code only after old installs have migrated

### `addColumn` (legacy)

The single-column form names a SQL type (`TEXT`, `INTEGER`, `REAL`) instead of a schema type. Nullability and defaults follow the same rules as `addColumns`: optional → nullable, required → `NOT NULL` with `''` for text types and `0` for numeric ones. Prefer `addColumns`.

```ts
{ type: 'addColumn', table: 'posts', column: 'published_at', columnType: 'INTEGER', isOptional: true }
```

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

Prefer narrow, deterministic SQL statements. Treat this as the escape hatch, not the default path. The Loki adapter interprets a small subset (`UPDATE "table" SET "column" = literal [WHERE "column" IS NULL | IS NOT NULL | = literal | != literal]`).

## Migrations and Sync

If your backend implements WatermelonDB's migration-aware pull, set `migrationsEnabledAtVersion` in your sync config. After a schema upgrade the next pull receives a `migration` argument built from the same `migrations` list — the tables created and the columns added since the schema version the device last pulled with — so the server can send full snapshots of them. The rules are spelled out in the [sync documentation](../sync.md#migration-aware-pulls). A gap in the chain fails the sync with `Missing migrations between schema versions X and Y — cannot sync`, because the server would otherwise never learn about the new tables.

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

PomegranateDB's own coverage lives in `src/__tests__/database-migrations.test.ts` (Database-driven migrations, rollback, chain validation), `src/__tests__/migration-e2e.test.ts` and `src/__tests__/sqlite-adapter.test.ts`.

## Current Limitations

- Schema diff generation is not automated; you author `Migration[]` yourself.
- Column rename and column drop helpers are not implemented; use additive changes plus targeted SQL or table replacement strategies.
- Only one-step migrations are accepted (`fromVersion + 1 === toVersion`).
