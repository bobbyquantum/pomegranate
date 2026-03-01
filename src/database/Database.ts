/**
 * Database — the top-level entry point.
 *
 * The Database owns the adapter, manages collections, and provides
 * the `write()` transactional boundary.
 *
 * Usage:
 *   const db = new Database({
 *     adapter: new SQLiteAdapter({ databaseName: 'app.db' }),
 *     models: [Post, User, Comment],
 *   });
 *
 *   await db.write(async () => {
 *     await db.get(Post).create({ title: 'Hello' });
 *   });
 */

import type { StorageAdapter } from '../adapters/types';
import type { EncryptionConfig } from '../adapters/types';
import type { ModelSchema, DatabaseSchema, RawRecord, TableColumnSchema } from '../schema/types';
import { Collection } from '../collection/Collection';
import type { Model } from '../model/Model';
import type { ModelStatic, ModelDatabaseRef } from '../model/Model';
import type { BatchOperation } from '../query/types';
import { Subject } from '../observable/Subject';
import type { Observable } from '../observable/Subject';

// ─── Configuration ─────────────────────────────────────────────────────────

export interface DatabaseConfig {
  readonly adapter: StorageAdapter;
  readonly models: ModelStatic[];
  readonly schemaVersion?: number;
  readonly encryption?: EncryptionConfig;
}

// ─── Database Events ───────────────────────────────────────────────────

export type DatabaseEvent =
  | { type: 'initialized' }
  | { type: 'write_started' }
  | { type: 'write_completed' }
  | { type: 'sync_started' }
  | { type: 'sync_completed' }
  | { type: 'reset' };

// ─── Database class ────────────────────────────────────────────────────────

export class Database implements ModelDatabaseRef {
  readonly _adapter: StorageAdapter;
  private _collections = new Map<string, Collection>();
  private _modelMap = new Map<string, ModelStatic>();
  private _initialized = false;
  private _isInWriter = false;
  private _writeQueue: Array<() => Promise<void>> = [];
  private _isProcessingQueue = false;
  private _events$ = new Subject<DatabaseEvent>();
  private _schemaVersion: number;

  constructor(private config: DatabaseConfig) {
    this._adapter = config.adapter;
    this._schemaVersion = config.schemaVersion ?? 1;

    // Register all model classes
    for (const modelClass of config.models) {
      const schema = modelClass.schema;
      if (!schema) {
        throw new Error('Model class is missing static schema property');
      }
      this._modelMap.set(schema.table, modelClass);
      this._collections.set(schema.table, new Collection(this, modelClass));
    }
  }

  // ─── Initialization ──────────────────────────────────────────────────

  /**
   * Initialize the database. Must be called before any operations.
   * Creates tables if they don't exist.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    const dbSchema = this._buildDatabaseSchema();
    await this._adapter.initialize(dbSchema);
    this._initialized = true;
    this._events$.next({ type: 'initialized' });
  }

  private _buildDatabaseSchema(): DatabaseSchema {
    const tables = Array.from(this._collections.values()).map((collection) => {
      const schema = collection.schema;
      const columns: TableColumnSchema[] = schema.columns.map((col) => ({
        name: col.columnName,
        type: col.type,
        isOptional: col.isOptional,
        isIndexed: col.isIndexed,
      }));

      return {
        name: schema.table,
        columns,
      };
    });

    return {
      version: this._schemaVersion,
      tables,
    };
  }

  // ─── Collection Access ──────────────────────────────────────────────

  /**
   * Get the collection for a model class.
   */
  get<M extends Model>(modelClass: ModelStatic<ModelSchema>): Collection<M> {
    const table = modelClass.schema.table;
    const collection = this._collections.get(table);
    if (!collection) {
      throw new Error(`No collection registered for table "${table}"`);
    }
    return collection as Collection<M>;
  }

  /**
   * Get a collection by table name.
   */
  collection(table: string): Collection {
    const collection = this._collections.get(table);
    if (!collection) {
      throw new Error(`No collection registered for table "${table}"`);
    }
    return collection;
  }

  /**
   * All registered collections.
   */
  get collections(): Collection[] {
    return Array.from(this._collections.values());
  }

  // ─── Write Transaction ──────────────────────────────────────────────

  /**
   * Execute a write transaction.
   *
   * All mutations (create, update, delete) must happen inside a write() call.
   * Write calls are serialized — only one runs at a time.
   */
  async write<T>(fn: () => Promise<T>): Promise<T> {
    this._ensureInitialized();

    return new Promise<T>((resolve, reject) => {
      this._writeQueue.push(async () => {
        this._isInWriter = true;
        this._events$.next({ type: 'write_started' });
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this._isInWriter = false;
          this._events$.next({ type: 'write_completed' });
        }
      });

      this._processWriteQueue();
    });
  }

  private async _processWriteQueue(): Promise<void> {
    if (this._isProcessingQueue) return;
    this._isProcessingQueue = true;

    while (this._writeQueue.length > 0) {
      const fn = this._writeQueue.shift()!;
      await fn();
    }

    this._isProcessingQueue = false;
  }

  /**
   * @internal Throw if not inside a writer.
   */
  _ensureInWriter(action: string): void {
    if (!this._isInWriter) {
      throw new Error(
        `${action} must be called inside db.write(). ` +
          'Wrap your mutation in: await db.write(async () => { ... })',
      );
    }
  }

  // ─── Batch ──────────────────────────────────────────────────────────

  /**
   * Execute a batch of operations atomically.
   * Must be called inside `db.write()`.
   */
  async batch(operations: BatchOperation[]): Promise<void> {
    this._ensureInWriter('Database.batch()');
    await this._adapter.batch(operations);
  }

  /** @internal used by Model */
  async _batch(operations: BatchOperation[]): Promise<void> {
    await this._adapter.batch(operations);
  }

  // ─── Sync ──────────────────────────────────────────────────────────

  /**
   * Run a sync cycle.
   * See sync/index.ts for the full implementation.
   */
  async sync(opts: {
    pullChanges: (params: { lastPulledAt: number | null }) => Promise<{
      changes: Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>;
      timestamp: number;
    }>;
    pushChanges: (params: {
      changes: Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>;
      lastPulledAt: number;
    }) => Promise<void>;
  }): Promise<void> {
    this._ensureInitialized();

    // Import sync dynamically to keep the module boundary clean
    const { performSync } = await import('../sync');
    await performSync(this, opts);
  }

  // ─── Reset ──────────────────────────────────────────────────────────

  /**
   * Completely reset the database — drops all data.
   */
  async reset(): Promise<void> {
    await this._adapter.reset();
    for (const collection of this._collections.values()) {
      collection._clearCache();
    }
    this._events$.next({ type: 'reset' });
  }

  // ─── Events ──────────────────────────────────────────────────────────

  get events$(): Observable<DatabaseEvent> {
    return this._events$;
  }

  // ─── Close ──────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this._adapter.close();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private _ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error('Database is not initialized. Call `await db.initialize()` first.');
    }
  }

  /**
   * The tables this database manages.
   */
  get tables(): string[] {
    return Array.from(this._collections.keys());
  }
}
