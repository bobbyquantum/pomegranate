---
sidebar_position: 11
title: WatermelonDB compatibility
slug: /watermelon-compat
---

# WatermelonDB compatibility

`pomegranate-db/watermelon` lets an app written against [WatermelonDB](https://watermelondb.dev) switch its imports to PomegranateDB and keep compiling and behaving the same. It wraps the core engine in WatermelonDB's API shapes: `Database`, `Model`, `Q`, `Query`, `Relation`, `appSchema` / `tableSchema` / `schemaMigrations`, `SQLiteAdapter` / `LokiJSAdapter`, `synchronize` / `hasUnsyncedChanges` / `SyncLogger` and `DatabaseProvider` / `useDatabase`.

```ts
import { Database, Model, Q, SQLiteAdapter, synchronize } from 'pomegranate-db/watermelon';
```

`pomegranate-db/watermelon/impl` is the same module under a second name, so a project that aliases `pomegranate-db/watermelon` to a mock in tests can still reach the real implementation.

The module has no rxjs dependency and adds nothing to the core: everything it does goes through the public core API you can also call directly via `database.pomegranate`.

## Defining models

Models are declared with the core `m` schema builder (re-exported here) plus WatermelonDB-style getters and setters over `getField` / `setField`. Foreign keys are ordinary columns; associations live only in `static associations`, keyed by the **related table name** like in WatermelonDB.

```ts
import { m, Model } from 'pomegranate-db/watermelon';
import type { Associations, Query, Relation } from 'pomegranate-db/watermelon';
import type WorkflowProfile from './WorkflowProfile';
import type WorkTaskTicket from './WorkTaskTicket';

export const WorkTaskSchema = m.model('work_tasks', {
  taskType: m.text('task_type').optional().indexed(),
  count: m.number('count'),
  dueAt: m.date('due_at').optional(),                 // getter typed Date | null
  tags: m.json('tags', (raw) => (Array.isArray(raw) ? raw : [])),
  workflowProfileId: m.text('workflow_profile_id').optional().indexed(),
});

export default class WorkTask extends Model<typeof WorkTaskSchema> {
  static schema = WorkTaskSchema;
  static table = 'work_tasks';
  static associations: Associations = {
    workflow_profiles: { type: 'belongs_to', key: 'workflow_profile_id' },
    work_task_tickets: { type: 'has_many', foreignKey: 'work_task_id' },
  };

  get taskType(): string | null { return this.getField('taskType') as string | null; }
  set taskType(value: string | null) { this.setField('taskType', value); }

  get workflowProfile(): Relation<WorkflowProfile> {
    return this.relation<WorkflowProfile>('workflow_profiles', 'workflow_profile_id');
  }
  get workTaskTickets(): Query<WorkTaskTicket> {
    return this.children<WorkTaskTicket>('work_task_tickets');
  }
}
```

| WatermelonDB | pomegranate-db/watermelon |
|---|---|
| `@field('col')`, `@text`, `@date`, `@json` decorators | columns in `m.model()` + getter/setter pairs over `getField` / `setField` |
| `@relation('table', 'col')` / `@immutableRelation` | `this.relation<T>('table', 'col')` |
| `@children('table')` | `this.children<T>('table')` (needs a `has_many` entry in `static associations`) |
| `@readonly @date('created_at')` | `m.date('created_at').readonly()` |
| `static associations` | unchanged |

`setField()` is only allowed inside an `update()` / `create()` mutator and throws `Cannot modify a record outside of update()/create()` otherwise, so getter/setter models keep WatermelonDB's write discipline.

## Schema and migrations

`appSchema`, `tableSchema`, `schemaMigrations`, `createTable`, `addColumns` and `unsafeExecuteSql` take and return WatermelonDB's shapes (column types `'string' | 'number' | 'boolean'`, `tables` / `columns` keyed by name). They are converted for the core as follows:

| WatermelonDB | Core |
|---|---|
| `{ toVersion, steps }` | `{ fromVersion: toVersion - 1, toVersion, steps }` |
| `createTable({ name, columns })` | `{ type: 'createTable', schema }` |
| `addColumns({ table, columns })` | `{ type: 'addColumns', table, columns }` |
| `unsafeExecuteSql(sql)` | `{ type: 'sql', query }` |
| column type `string` / `number` / `boolean` | `text` / `number` / `boolean` |

`schemaMigrations()` sorts the list and rejects duplicates, gaps and versions below 2. The chain is applied by the compat `Database` when it opens an existing database at an older version; a gap fails initialisation (`ready` rejects, `onSetUpError` is called).

:::note Models are authoritative on a fresh install
A fresh database creates its tables from the **model classes**, not from `appSchema`; migrations drive upgrades of existing databases. Keep both generated from the same source, as WatermelonDB already requires. `m.date()` columns are `number` in the app schema, `m.json()` columns are `string`.
:::

## Adapters and database

```ts
export const adapter = new SQLiteAdapter({
  schema: mySchema,
  migrations,
  dbName: 'attend',
  driver: createNativeSQLiteDriver(),   // default when omitted (loaded lazily)
  migrationEvents: { onStart() {}, onSuccess() {}, onError(error) {} },
  jsi: true,                            // ignored
});

export const adapter = new LokiJSAdapter({
  schema: mySchema,
  migrations,
  dbName: 'attend',
  useWebWorker: false,                  // true warns once and runs on the main thread
  useIncrementalIndexedDB: true,        // Loki's incremental IndexedDB adapter when `indexedDB` exists
});

export const database = new Database({ adapter, modelClasses: models });
```

The compat adapters are configuration objects carrying the core adapter (`adapter.pomegranate`), `schemaVersion`, converted `migrations` and `migrationEvents`. `Database` builds the core `Database` and starts `initialize()` immediately; every method awaits `database.ready`, and observables subscribe once it resolves, so the database can be constructed at module load and used at once.

| Property / method | Notes |
|---|---|
| `collections.get<T>(table)`, `get<T>(table)` | synchronous; throws for unknown tables |
| `write(fn)`, `read(fn)` | `fn` receives `{ callWriter, callReader }`; nested `write()` joins the transaction |
| `unsafeResetDatabase()` | inside `write()`; drops and recreates every table, clears sync metadata |
| `withChangesForTables(tables)` | emits `null`, then `[{ record, type }]` per change (`type` is `created` / `updated` / `destroyed`) |
| `adapter` | the **core** storage adapter (`getMetadata`, `findById`, …) |
| `compatAdapter` | the `SQLiteAdapter` / `LokiJSAdapter` object passed in |
| `schema` | the `appSchema` (`schema.version`) |
| `pomegranate` | the core `Database` |
| `ready` | resolves after open + migrate |

Not provided: `database.batch()` / `prepareCreate()` / `prepareUpdate()`, `database.localStorage`, `experimentalSubscribe`. Write several records inside one `write()` instead — the core wraps it in a single transaction.

## Queries

`Q` supports `where`, `eq`, `notEq`, `gt`, `gte`, `lt`, `lte`, `oneOf`, `notIn`, `between`, `like`, `notLike`, `and`, `or`, `on`, `sortBy` (`Q.asc` / `Q.desc`), `take`, `skip`, `sanitizeLikeString`, and the no-ops `experimentalJoinTables` / `experimentalNestedJoin`. `Query` provides `fetch`, `fetchCount`, `fetchIds`, `observe`, `observeWithColumns(columns)`, `observeCount(isThrottled?)`, `extend(...clauses)`, `collection`, `clauses` and `description` (the core descriptor).

```ts
database.get<WorkTask>('work_tasks')
  .query(
    Q.on('workflow_profiles', Q.where('id', activeProfileId)),   // belongs_to, via static associations
    Q.on('work_task_tickets', Q.on('survey_responses', 'closed', true)), // nested has_many
    Q.where('task_type', Q.notEq(null)),
    Q.sortBy('display_text', Q.asc),
    Q.take(5),
  )
  .observeWithColumns(['task_type', 'mobile_script']);
```

Translation notes:

- `Q.on` becomes a core `on()` EXISTS sub-query; the join columns come from the model classes' `static associations`. All WatermelonDB forms work: `Q.on(table, column, value)`, `Q.on(table, clause)`, `Q.on(table, [clauses])`, nested `Q.on`, and `Q.on(table, Q.or(...))`. No `experimentalJoinTables` declaration is needed.
- `Q.where(col, null)` and `Q.eq(null)` are `IS NULL`; `Q.notEq(null)` is `IS NOT NULL`. `Q.notEq(value)` also matches `NULL`, as WatermelonDB's `IS NOT` does.
- Boolean values are compared as `0` / `1`, matching how they are stored.
- Deleted records (`_status = 'deleted'`) are always excluded, as in WatermelonDB.
- `Q.unsafeSqlExpr`, `Q.unsafeLokiExpr`, `Q.unsafeSqlQuery`, `Q.column` and `Q.includes` are not provided.

## Records

- `collection.find(id)` rejects with `Record <id> not found in <table>` when missing; `findAndObserve(id)` errors on a missing record and completes if it is later deleted.
- `collection.create(record => { … })` runs the mutator on a draft whose getters reflect the values you set; the record's `id` inside the mutator is the final one. **`id` cannot be chosen** — a raw `_raw.id` assignment in the mutator is not supported.
- `record.update(record => { … })` supports async mutators and reads pending values; `record.update({ field: value })` (core-style patch) also works.
- `markAsDeleted()`, `destroyPermanently()`, `syncStatus`, `_raw` (the stored row — pending mutator values are not reflected), `observe()`, `table`, `database`, `collections`, `asModel` are available.
- `relation.fetch()` returns `null` for a null key and rejects for a dangling one; `relation.observe()` follows changes to the foreign key and to the related record; `relation.set(record | null)` and `relation.id = …` stage the foreign key inside a mutator.
- `children(table)` requires a `has_many` entry for `table` in the model's `static associations`.
- A record loaded before a sync reflects `syncStatus: 'synced'` after its push, as in WatermelonDB.

## Observables

Every observable returned by this module is a `WatermelonObservable<T>`:

- `subscribe(next)` or `subscribe({ next, error, complete })` returns a subscription with `unsubscribe()` and `closed`. The subscription is also callable, so it doubles as a core `Unsubscribe` (the core React hooks accept it).
- `[Symbol.observable]()` and `'@@observable'()` return the observable, so `rxjs.from(observable)` works and the object satisfies rxjs's `Subscribable<T>` type. rxjs is **not** a dependency; `pipe()` and operators are not available on the object itself — wrap it with `from()` first.
- Live queries emit their current value once after the database is ready, then only on relevant changes (no double emission). `record.observe()` emits synchronously on subscribe.

## Sync

```ts
await synchronize({
  database,
  log: syncLogger.newLog(),
  migrationsEnabledAtVersion: 1,
  pullChanges: async ({ lastPulledAt, schemaVersion, migration }) => ({ changes, timestamp }),
  pushChanges: async ({ changes, lastPulledAt }) => {},
});

await synchronize({ database, unsafeTurbo: true, pullChanges: async () => ({ syncJson }), pushChanges: async () => {} });
await synchronize({ database, unsafeTurbo: true, pullChanges: async () => ({ syncJsonId }), pushChanges: async () => {} });
```

`synchronize` maps onto the core `performSync` with `pullFirst: true` — WatermelonDB's order — passing through `pullChanges`, `pushChanges`, `migrationsEnabledAtVersion`, `sendCreatedAsUpdated`, `log` and `unsafeTurbo`. The `pullChanges` arguments and the push payload already have WatermelonDB's shape; pushed rows carry `_status: 'synced'` and `_changed: ''`. See [Sync](./sync.md) for the merge semantics, the `migration` argument and turbo mode (`{ syncJsonId }` needs the native driver; other adapters accept `{ syncJson }` text).

`hasUnsyncedChanges({ database })` and `SyncLogger(limit)` (`newLog()`, `logs` newest first, `formattedLogs`) work as in WatermelonDB. `conflictResolver`, `onDidPullChanges` and `onWillApplyRemoteChanges` are not supported and throw if passed; `_unsafeBatchPerCollection` is ignored.

## React

```tsx
<DatabaseProvider database={database}>…</DatabaseProvider>
const database = useDatabase();
const Wrapped = withDatabase(Component);   // injects `database`
```

`DatabaseProvider` uses its own context and provides the compat `Database`. `withObservables` is not included — subscribe in an effect, or use rxjs `from()` with your existing HOC.

## Differences from WatermelonDB at a glance

- Models use `m.model()` + getters/setters instead of decorators; `create()` cannot set `id`.
- Observables are rxjs-shaped, not rxjs instances (no `.pipe`).
- `Q.experimentalJoinTables` / `Q.experimentalNestedJoin` are no-ops; unsafe raw-SQL/Loki query escapes are not available.
- `database.batch()`, `prepare*()`, `localStorage`, `conflictResolver` and `withObservables` are not provided.
- `LokiJSAdapter({ useWebWorker: true })` runs on the main thread (one warning).
- `read()` runs after `ready` but is not serialised against writers.
