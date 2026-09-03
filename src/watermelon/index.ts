/**
 * pomegranate-db/watermelon — WatermelonDB compatibility layer.
 *
 * Lets an app written against WatermelonDB switch its imports to this module
 * and keep compiling: `Database`, `Model`, `Q`, `Query`, `Relation`,
 * `appSchema` / `tableSchema` / `schemaMigrations`, `SQLiteAdapter` /
 * `LokiJSAdapter`, `synchronize` / `hasUnsyncedChanges` / `SyncLogger`, and
 * `DatabaseProvider` / `useDatabase`. Models are defined with the core `m`
 * schema builder (re-exported here). See docs/watermelon-compat.md.
 */

// ─── Schema builder (core) ─────────────────────────────────────────────────
export { m } from '../schema/builder';
export type { ModelSchema, RawRecord, SyncStatus } from '../schema/types';
/** WatermelonDB's name for a raw row. */
export type DirtyRaw = Record<string, unknown>;

// ─── Model / Relation ──────────────────────────────────────────────────────
export { Model, Relation } from './Model';
export type { Associations, ModelAssociation, Mutator } from './Model';

// ─── Collection / Query / Q ────────────────────────────────────────────────
export { Collection } from './Collection';
export type { CollectionChangeSet, CollectionChangeType } from './Collection';
export { Query } from './Query';
export * as Q from './QNamespace';
export { applyClauses, applyConditions, isComparison } from './Q';
export type {
  Clause,
  Where,
  WhereClause,
  AndClause,
  OrClause,
  OnClause,
  SortByClause,
  TakeClause,
  SkipClause,
  JoinTablesClause,
  NestedJoinTableClause,
  Comparison,
  ComparisonOperator,
  SortOrder,
  Value,
  QType,
} from './Q';

// ─── Database ──────────────────────────────────────────────────────────────
export { Database } from './Database';
export type { DatabaseOptions, CollectionMap, WriterInterface } from './Database';

// ─── Schema & migrations ───────────────────────────────────────────────────
export {
  appSchema,
  tableSchema,
  toCoreColumnType,
  toCoreColumn,
  toCoreTableSchema,
  toCoreDatabaseSchema,
} from './schema';
export type {
  AppSchema,
  AppSchemaSpec,
  TableSchema,
  TableSchemaSpec,
  ColumnSchema,
  ColumnMap,
  ColumnType,
} from './schema';
export {
  schemaMigrations,
  createTable,
  addColumns,
  unsafeExecuteSql,
  toCoreMigrations,
  toCoreMigrationStep,
} from './migrations';
export type {
  Migration,
  MigrationStep,
  CreateTableMigrationStep,
  AddColumnsMigrationStep,
  SqlMigrationStep,
  SchemaMigrations,
} from './migrations';

// ─── Adapters ──────────────────────────────────────────────────────────────
export { SQLiteAdapter, LokiJSAdapter } from './adapters';
export type {
  CompatAdapter,
  CompatMigrationEvents,
  SQLiteAdapterOptions,
  LokiJSAdapterOptions,
} from './adapters';
export type { SQLiteDriver } from '../adapters/sqlite/SQLiteAdapter';

// ─── Sync ──────────────────────────────────────────────────────────────────
export { synchronize, hasUnsyncedChanges, SyncLogger } from './sync';
export type {
  SyncArgs,
  SyncLog,
  SyncPullArgs,
  SyncPullResult,
  SyncPushArgs,
  SyncDatabaseChangeSet,
} from './sync';
export type { SyncMigrationInfo, SyncPushResult, TurboSyncSource } from '../sync/types';

// ─── React ─────────────────────────────────────────────────────────────────
export { DatabaseProvider, useDatabase, withDatabase } from './react';
export type { DatabaseProviderProps } from './react';

// ─── Observables ───────────────────────────────────────────────────────────
export { WatermelonObservable } from './observable';
export type {
  WatermelonObserver,
  WatermelonSubscription,
  ObserverOrNext,
  WatermelonProducer,
} from './observable';
