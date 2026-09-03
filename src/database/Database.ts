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
import type { EncryptionConfig, Migration, MigrationEvents } from '../adapters/types';
import type { ModelSchema, DatabaseSchema, TableColumnSchema } from '../schema/types';
import type { SyncConfig, SyncLog, SyncState } from '../sync/types';
import { Collection } from '../collection/Collection';
import type { Model } from '../model/Model';
import type { ModelStatic, ModelDatabaseRef } from '../model/Model';
import type { BatchOperation } from '../query/types';
import { BehaviorSubject, Subject } from '../observable/Subject';
import type { Observable } from '../observable/Subject';
import { resolveMigrationChain } from './migrations';

// ─── Configuration ─────────────────────────────────────────────────────────

export interface DatabaseConfig {
  readonly adapter: StorageAdapter;
  readonly models: ModelStatic[];
  readonly schemaVersion?: number;
  readonly encryption?: EncryptionConfig;
  /**
   * Migrations from every shipped schema version up to `schemaVersion`.
   * `initialize()` runs the ones an existing database still needs; the sync
   * engine reads them to build the pull `migration` argument.
   */
  readonly migrations?: readonly Migration[];
  /** Callbacks around the migration run performed by `initialize()`. */
  readonly migrationEvents?: MigrationEvents;
}

// ─── Database Events ───────────────────────────────────────────────────

export type DatabaseEvent =
  | { type: 'initialized' }
  | { type: 'write_started' }
  | { type: 'write_completed' }
  | { type: 'sync_started' }
  | { type: 'sync_completed' }
  | { type: 'sync_failed'; error: string }
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
  private _syncState$ = new BehaviorSubject<SyncState>('idle');
  private _syncLog$ = new BehaviorSubject<SyncLog | null>(null);
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
   *
   * A fresh database gets its tables created at `schemaVersion`. An existing
   * one at an older version is migrated with `config.migrations`, which must
   * form an unbroken one-step chain from the stored version to
   * `schemaVersion`; otherwise this throws and nothing is changed. Opening a
   * database at a *newer* version than the app's schema is refused.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    const dbSchema = this._buildDatabaseSchema();
    await this._adapter.initialize(dbSchema);
    await this._migrateIfNeeded();
    this._initialized = true;
    this._events$.next({ type: 'initialized' });
  }

  private async _migrateIfNeeded(): Promise<void> {
    const stored = await this._adapter.getSchemaVersion();
    const target = this._schemaVersion;

    // 0 = fresh install: the adapter has just created every table at `target`.
    if (stored === 0 || stored === target) return;

    if (stored > target) {
      throw new Error(
        `Database schema version ${stored} is newer than the app's schema version ${target}. ` +
          'Downgrading is not supported.',
      );
    }

    const chain = resolveMigrationChain(this.config.migrations ?? [], stored, target);
    const events = this.config.migrationEvents;
    events?.onStart?.(stored, target);
    try {
      await this._adapter.migrate(chain);
    } catch (error) {
      events?.onError?.(error, stored, target);
      throw error;
    }
    events?.onSuccess?.(stored, target);
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
   * Write calls are serialized — only one runs at a time. A `write()` issued
   * from inside the running writer (a helper that wraps its own mutations in
   * `write()`, called from another `write()`) is re-entrant: it runs inline as
   * part of the outer transaction instead of queueing behind it, which would
   * deadlock.
   *
   * Re-entrancy is detected with a flag: there is one writer at a time, and a
   * queued writer only starts on a microtask, so `write()` calls issued in the
   * same tick still queue in order. The one case the flag cannot tell apart is
   * a `write()` from an unrelated task that lands while the writer is awaiting
   * asynchronous adapter I/O — it joins the running transaction instead of
   * waiting for it.
   */
  async write<T>(fn: () => Promise<T>): Promise<T> {
    this._ensureInitialized();

    if (this._isInWriter) {
      // Nested call from the running writer: the adapter's writeTransaction
      // already treats nested calls as part of the outer transaction.
      return fn();
    }

    return new Promise<T>((resolve, reject) => {
      this._writeQueue.push(async () => {
        this._isInWriter = true;
        this._events$.next({ type: 'write_started' });
        try {
          let result: T;
          if (this._adapter.writeTransaction) {
            // Wrap all mutations in a single database transaction
            // (one BEGIN/COMMIT = one fsync instead of per-statement autocommit)
            await this._adapter.writeTransaction(async () => {
              result = await fn();
            });
          } else {
            result = await fn();
          }
          resolve(result!);
        } catch (error) {
          reject(error);
        } finally {
          this._isInWriter = false;
          this._events$.next({ type: 'write_completed' });
        }
      });

      // Start on a microtask so that writes issued back-to-back in one tick are
      // all queued before the first one sets the in-writer flag.
      void Promise.resolve().then(() => this._processWriteQueue());
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

    // Notify affected collections so live queries / observers update
    const affectedTables = new Set(operations.map((op) => op.table));
    for (const table of affectedTables) {
      const collection = this._collections.get(table);
      if (collection) {
        // Fire a single synthetic notification per table to trigger re-queries.
        // We use 'updated' with a minimal record since observers only check
        // that *something* changed on the collection.
        collection._notifyChange('updated', { id: '__batch__' } as Model);
      }
    }
  }

  /** @internal used by Model */
  async _batch(operations: BatchOperation[]): Promise<void> {
    await this._adapter.batch(operations);
  }

  // ─── Relation Resolution (RelationDatabaseRef) ─────────────────────

  /** @internal Find a record by table+id for relation resolution */
  async _findById(table: string, id: string): Promise<Model | null> {
    const collection = this._collections.get(table);
    if (!collection) {
      throw new Error(`No collection registered for table "${table}"`);
    }
    return collection.findById(id);
  }

  /** @internal Observe a record by table+id for relation resolution */
  _observeById(table: string, id: string): Observable<Model | null> {
    const collection = this._collections.get(table);
    if (!collection) {
      throw new Error(`No collection registered for table "${table}"`);
    }
    return collection.observeById(id);
  }

  /** @internal Fetch related records for has-many relation */
  async _fetchRelated(table: string, foreignKey: string, id: string): Promise<Model[]> {
    const collection = this._collections.get(table);
    if (!collection) {
      throw new Error(`No collection registered for table "${table}"`);
    }
    const qb = collection.query((q) => {
      q.where(foreignKey, 'eq', id);
    });
    return collection.fetch(qb);
  }

  /** @internal Observe related records for has-many relation */
  _observeRelated(table: string, foreignKey: string, id: string): Observable<Model[]> {
    const collection = this._collections.get(table);
    if (!collection) {
      throw new Error(`No collection registered for table "${table}"`);
    }
    const qb = collection.query((q) => {
      q.where(foreignKey, 'eq', id);
    });
    return collection.observeQuery(qb);
  }

  // ─── Sync ──────────────────────────────────────────────────────────

  /**
   * Run a sync cycle.
   * See sync/index.ts for the full implementation.
   */
  async sync(opts: SyncConfig): Promise<void> {
    this._ensureInitialized();
    this._events$.next({ type: 'sync_started' });

    // Import sync dynamically to keep the module boundary clean
    const { performSync } = await import('../sync');
    try {
      await performSync(this, opts, {
        onStateChange: (state) => {
          this._syncState$.next(state);
        },
        onLogChange: (log) => {
          this._syncLog$.next(log);
        },
      });
      this._events$.next({ type: 'sync_completed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._events$.next({ type: 'sync_failed', error: message });
      throw error;
    }
  }

  // ─── Reset ──────────────────────────────────────────────────────────

  /**
   * Completely reset the database — drops all data.
   *
   * The database is left uninitialized: call `initialize()` again to recreate
   * the tables (at `schemaVersion`) before using it. Safe to call from inside
   * `write()`; the re-initialisation then joins the running transaction.
   */
  async reset(): Promise<void> {
    await this._adapter.reset();
    this._clearAllCaches();
    this._initialized = false;
    this._events$.next({ type: 'reset' });
  }

  // ─── Events ──────────────────────────────────────────────────────────

  get events$(): Observable<DatabaseEvent> {
    return this._events$;
  }

  get syncState$(): Observable<SyncState> {
    return this._syncState$;
  }

  get syncLog$(): Observable<SyncLog | null> {
    return this._syncLog$;
  }

  observeSyncState(): Observable<SyncState> {
    return this._syncState$;
  }

  observeSyncLog(): Observable<SyncLog | null> {
    return this._syncLog$;
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

  /** The schema version this database was configured with. */
  get schemaVersion(): number {
    return this._schemaVersion;
  }

  /** The migrations this database was configured with (empty if none). */
  get migrations(): readonly Migration[] {
    return this.config.migrations ?? [];
  }

  /** The compiled adapter-level schema (tables and columns) for this database. */
  get schema(): DatabaseSchema {
    return this._buildDatabaseSchema();
  }

  /** @internal Drop every collection's record cache (after a bulk import). */
  _clearAllCaches(): void {
    for (const collection of this._collections.values()) {
      collection._clearCache();
    }
  }
}
