/**
 * Storage adapter interface.
 *
 * All database operations go through this interface, enabling
 * pluggable backends (SQLite, LokiJS, etc.).
 */

import type { QueryDescriptor, SearchDescriptor, BatchOperation } from '../query/types';
import type { DatabaseSchema, RawRecord, TableColumnSchema, TableSchema } from '../schema/types';
import type { TurboSyncResult, TurboSyncSource } from '../sync/types';

// ─── Adapter Configuration ────────────────────────────────────────────────

export interface AdapterConfig {
  readonly databaseName: string;
  /** Optional schema version override; normally derived from DatabaseSchema. */
  readonly schemaVersion?: number;
}

// ─── Encryption Provider ──────────────────────────────────────────────────

export interface EncryptionConfig {
  readonly enabled: boolean;
  readonly keyProvider: () => Promise<Uint8Array>;
}

// ─── Migration Types ──────────────────────────────────────────────────────

export interface Migration {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly steps: MigrationStep[];
}

export type MigrationStep =
  /** Create a table (with its `_status` and column indexes), like a fresh install would. */
  | { type: 'createTable'; schema: TableSchema }
  /**
   * Add a single column. `columnType` is a SQL type (`TEXT`, `INTEGER`, `REAL`).
   * Prefer `addColumns`, which takes schema column descriptors and shares the
   * exact NULL/default rules of `createTable`.
   */
  | { type: 'addColumn'; table: string; column: string; columnType: string; isOptional?: boolean }
  /**
   * Add one or more columns described the same way as in a table schema.
   * Optional columns are nullable (`DEFAULT NULL`); required columns are
   * `NOT NULL` with the type's default (`''` for text, `0` otherwise).
   * Existing rows receive that default.
   */
  | { type: 'addColumns'; table: string; columns: TableColumnSchema[] }
  | { type: 'destroyTable'; table: string }
  | { type: 'sql'; query: string };

/** Lifecycle callbacks fired by `Database.initialize()` when it runs migrations. */
export interface MigrationEvents {
  onStart?(from: number, to: number): void;
  onSuccess?(from: number, to: number): void;
  onError?(error: unknown, from: number, to: number): void;
}

// ─── Core Adapter Interface ───────────────────────────────────────────────

export interface StorageAdapter {
  /** Initialize the adapter. Creates tables if needed. */
  initialize(schema: DatabaseSchema): Promise<void>;

  /** Find records matching a query descriptor. */
  find(query: QueryDescriptor): Promise<RawRecord[]>;

  /** Count records matching a query descriptor. */
  count(query: QueryDescriptor): Promise<number>;

  /** Find a single record by ID. */
  findById(table: string, id: string): Promise<RawRecord | null>;

  /** Insert a new raw record. */
  insert(table: string, raw: RawRecord): Promise<void>;

  /** Update an existing raw record. */
  update(table: string, raw: RawRecord): Promise<void>;

  /** Mark a record as deleted (_status = 'deleted'). */
  markAsDeleted(table: string, id: string): Promise<void>;

  /** Permanently remove a record from the database. */
  destroyPermanently(table: string, id: string): Promise<void>;

  /** Execute a batch of operations atomically. */
  batch(operations: BatchOperation[]): Promise<void>;

  /**
   * Optional: wrap a set of operations in a write transaction.
   * When provided, `db.write()` will call this so that all individual
   * inserts/updates/deletes within a single write() share ONE database
   * transaction (one fsync) instead of each being autocommit.
   */
  writeTransaction?(fn: () => Promise<void>): Promise<void>;

  /** Full-text search. */
  search(descriptor: SearchDescriptor): Promise<{ records: RawRecord[]; total: number }>;

  /** Return all records with _status != 'synced' */
  getLocalChanges(
    tables: string[],
  ): Promise<Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>>;

  /**
   * Apply changes pulled from the server, in one transaction, merging with
   * unsynced local edits the way WatermelonDB does:
   *
   * - no local row → insert as `synced`
   * - local `synced` → overwrite as `synced`
   * - local `updated` (or `created`, an id collision) → take remote values for
   *   every column **except** those listed in the local `_changed`; keep the
   *   local `_status` and `_changed` so the edit is still pushed
   * - local `deleted` → ignore the remote row (the delete will be pushed)
   * - remote `deleted` id → remove locally regardless of local status
   */
  applyRemoteChanges(
    changes: Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>,
  ): Promise<void>;

  /** Mark synced records as _status = 'synced'. */
  markAsSynced(table: string, ids: string[]): Promise<void>;

  /** Get the database schema version currently stored. */
  getSchemaVersion(): Promise<number>;

  /**
   * Optional: read a value from the adapter's persistent key/value metadata.
   * Used by the sync engine to store `lastPulledAt`. Adapters without it fall
   * back to in-memory tracking (every sync becomes a full pull).
   */
  getMetadata?(key: string): Promise<string | null>;

  /** Optional: write a value to the adapter's persistent key/value metadata. */
  setMetadata?(key: string, value: string): Promise<void>;

  /**
   * Optional: turbo sync — import a whole pull payload in one step.
   *
   * Native SQLite drivers parse the payload in C++ and write rows directly;
   * other adapters may implement it via `JSON.parse` + `applyRemoteChanges`.
   * Rows land as `_status = 'synced'`; tables/columns missing from `schema`
   * are ignored/dropped and counted in the result.
   */
  applySyncJson?(source: TurboSyncSource, schema: DatabaseSchema): Promise<TurboSyncResult>;

  /**
   * Run the migrations whose `fromVersion` is at or above the stored schema
   * version, in order, atomically — on failure the stored version must be
   * unchanged. `Database.initialize()` calls this with a validated chain; it
   * can also be called directly.
   */
  migrate(migrations: Migration[]): Promise<void>;

  /** Completely reset the database. */
  reset(): Promise<void>;

  /** Close the database connection. */
  close(): Promise<void>;
}

// ─── Adapter Events ───────────────────────────────────────────────────────

export type AdapterEvent =
  | { type: 'initialized' }
  | { type: 'batch_completed'; operations: BatchOperation[] }
  | { type: 'reset' };
