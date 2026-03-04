/**
 * Storage adapter interface.
 *
 * All database operations go through this interface, enabling
 * pluggable backends (SQLite, LokiJS, etc.).
 */

import type { QueryDescriptor, SearchDescriptor, BatchOperation } from '../query/types';
import type { DatabaseSchema, RawRecord, TableSchema } from '../schema/types';

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
  | { type: 'createTable'; schema: TableSchema }
  | { type: 'addColumn'; table: string; column: string; columnType: string; isOptional?: boolean }
  | { type: 'destroyTable'; table: string }
  | { type: 'sql'; query: string };

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

  /** Apply synced changes from remote (in a transaction). */
  applyRemoteChanges(
    changes: Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>,
  ): Promise<void>;

  /** Mark synced records as _status = 'synced'. */
  markAsSynced(table: string, ids: string[]): Promise<void>;

  /** Get the database schema version currently stored. */
  getSchemaVersion(): Promise<number>;

  /** Run migrations. */
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
