/**
 * PomegranateDB — main entry point.
 *
 * Reactive offline-first database with sync support.
 */

// ─── Schema ────────────────────────────────────────────────────────────────
export { m } from './schema';
export type {
  ColumnType,
  ColumnDescriptor,
  TextColumn,
  NumberColumn,
  BooleanColumn,
  DateColumn,
  JsonColumn,
  BelongsToDescriptor,
  HasManyDescriptor,
  RelationDescriptor,
  FieldDescriptor,
  SchemaFields,
  ModelSchema,
  ResolvedColumn,
  ResolvedRelation,
  DatabaseSchema,
  TableSchema,
  SyncStatus,
  RawRecord,
  InferCreatePatch,
  InferUpdatePatch,
  InferRecord,
  BelongsToRelation,
  HasManyRelation,
  ModelInstance,
} from './schema';

// ─── Model ─────────────────────────────────────────────────────────────────
export { Model } from './model';
export type { ModelStatic, ModelAssociation, ModelAssociations } from './model';

// ─── Collection ────────────────────────────────────────────────────────────
export { Collection } from './collection';
export type { CollectionChangeType, CollectionChange, ObserveQueryOptions } from './collection';

// ─── Database ──────────────────────────────────────────────────────────────
export { Database } from './database';
export type { DatabaseConfig, DatabaseEvent } from './database';

// ─── Query ─────────────────────────────────────────────────────────────────
export { QueryBuilder, query } from './query';
export type {
  QueryDescriptor,
  SearchDescriptor,
  ComparisonOperator,
  SortOrder,
  Condition,
  WhereClause,
  AndClause,
  OrClause,
  NotClause,
  ExistsClause,
  OrderByClause,
  BatchOperation,
  AssociationJoin,
  AssociationResolver,
  QueryBuilderOptions,
} from './query';

// ─── Adapters ──────────────────────────────────────────────────────────────
export { SQLiteAdapter } from './adapters';
export type { SQLiteAdapterConfig, SQLiteDriver } from './adapters';
export { LokiAdapter, SynchronousWorker } from './adapters';
export type { LokiAdapterConfig, WorkerInterface } from './adapters';
export { createExpoSQLiteDriver } from './adapters';
export type { ExpoSQLiteDriverConfig } from './adapters';
export type { StorageAdapter, EncryptionConfig, Migration, MigrationStep } from './adapters';

// ─── Sync ──────────────────────────────────────────────────────────────────
export { performSync } from './sync';
export type {
  SyncConfig,
  SyncPullParams,
  SyncPullResult,
  SyncPushPayload,
  SyncTableChanges,
  SyncTableChangeSet,
  SyncState,
  SyncLog,
  TurboSyncSource,
  TurboSyncResult,
} from './sync';

// ─── Observable ────────────────────────────────────────────────────────────
export { Subject, BehaviorSubject, SharedObservable } from './observable';
export type { Observable, Listener, Unsubscribe } from './observable';

// ─── Hooks (React) ─────────────────────────────────────────────────────────
export {
  useObservable,
  useLiveQuery,
  useById,
  useField,
  useSearch,
  useCount,
  useDatabase,
  useCollection,
  DatabaseProvider,
  DatabaseSuspenseProvider,
} from './hooks';
export type {
  UseLiveQueryOptions,
  UseSearchOptions,
  UseSearchResult,
  DatabaseSuspenseProviderProps,
} from './hooks';
