/**
 * Collection — manages all records for a single table/model.
 *
 * Collections provide CRUD operations, query building, record caching,
 * and change notification. Each Collection is associated with one Model class.
 */

import type { ModelSchema, RawRecord, SchemaFields } from '../schema/types';
import { createRawRecord } from '../model/Model';
import type { ModelStatic, ModelCollectionRef, ModelDatabaseRef, Model } from '../model/Model';
import { QueryBuilder } from '../query/QueryBuilder';
import type { QueryDescriptor, SearchDescriptor, BatchOperation } from '../query/types';
import { Subject } from '../observable/Subject';
import type { Observable, Unsubscribe } from '../observable/Subject';
import { SharedObservable } from '../observable/Subject';
import type { StorageAdapter } from '../adapters/types';

// ─── Change event types ────────────────────────────────────────────────────

export type CollectionChangeType = 'created' | 'updated' | 'deleted';

export interface CollectionChange {
  readonly type: CollectionChangeType;
  readonly record: Model;
}

// ─── Collection class ──────────────────────────────────────────────────────

export class Collection<M extends Model = Model> implements ModelCollectionRef {
  readonly table: string;
  private _modelClass: ModelStatic;
  private _schema: ModelSchema;
  private _database: ModelDatabaseRef & { _adapter: StorageAdapter };

  /** In-memory cache of instantiated records by ID */
  private _cache = new Map<string, M>();

  /** Emits whenever the collection changes */
  private _changes$ = new Subject<CollectionChange>();

  constructor(database: ModelDatabaseRef & { _adapter: StorageAdapter }, modelClass: ModelStatic) {
    this._database = database;
    this._modelClass = modelClass;
    this._schema = modelClass.schema;
    this.table = this._schema.table;
  }

  // ─── Schema access ──────────────────────────────────────────────────

  get schema(): ModelSchema {
    return this._schema;
  }

  // ─── CRUD ──────────────────────────────────────────────────────────

  /**
   * Create a new record.
   * Must be called inside `db.write()`.
   */
  async create(patch: Record<string, unknown>): Promise<M> {
    this._database._ensureInWriter('Collection.create()');

    const raw = createRawRecord(this._schema, patch);
    await this._database._adapter.insert(this.table, raw);

    const record = this._instantiate(raw);
    this._cache.set(record.id, record);
    this._changes$.next({ type: 'created', record });
    return record;
  }

  /**
   * Find a record by ID.
   * Returns the cached instance if available.
   */
  async findById(id: string): Promise<M | null> {
    const cached = this._cache.get(id);
    if (cached) return cached;

    const raw = await this._database._adapter.findById(this.table, id);
    if (!raw) return null;

    const record = this._instantiate(raw);
    this._cache.set(id, record);
    return record;
  }

  /**
   * Find a record by ID or throw.
   */
  async findByIdOrFail(id: string): Promise<M> {
    const record = await this.findById(id);
    if (!record) {
      throw new Error(`Record not found: ${this.table}/${id}`);
    }
    return record;
  }

  /**
   * Query records using the fluent QueryBuilder.
   */
  query(): QueryBuilder;
  query(fn: (qb: QueryBuilder) => void): QueryBuilder;
  query(fn?: (qb: QueryBuilder) => void): QueryBuilder {
    const qb = new QueryBuilder(this.table);
    // Automatically exclude soft-deleted records
    qb.where('_status', 'neq', 'deleted');
    if (fn) fn(qb);
    return qb;
  }

  /**
   * Execute a query and return model instances.
   */
  async fetch(queryOrBuilder: QueryDescriptor | QueryBuilder): Promise<M[]> {
    const descriptor =
      queryOrBuilder instanceof QueryBuilder ? queryOrBuilder.build() : queryOrBuilder;

    const raws = await this._database._adapter.find(descriptor);
    return raws.map((raw) => this._materialize(raw));
  }

  /**
   * Count records matching a query.
   */
  async count(queryOrBuilder?: QueryDescriptor | QueryBuilder): Promise<number> {
    const descriptor = queryOrBuilder
      ? (queryOrBuilder instanceof QueryBuilder
        ? queryOrBuilder.build()
        : queryOrBuilder)
      : this.query().build();

    return this._database._adapter.count(descriptor);
  }

  /**
   * Full-text search.
   */
  async search(opts: {
    term: string;
    fields: string[];
    limit?: number;
    offset?: number;
    extend?: (qb: QueryBuilder) => void;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<{ records: M[]; total: number }> {
    const qb = this.query();
    if (opts.extend) opts.extend(qb);

    const orderByEntries = opts.orderBy
      ? Object.entries(opts.orderBy).map(([column, order]) => ({ column, order }) as const)
      : [];

    const descriptor: SearchDescriptor = {
      table: this.table,
      term: opts.term,
      fields: opts.fields,
      conditions: qb.build().conditions,
      orderBy: orderByEntries,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    };

    const result = await this._database._adapter.search(descriptor);
    const records = result.records.map((raw) => this._materialize(raw));
    return { records, total: result.total };
  }

  // ─── Observe ──────────────────────────────────────────────────────

  /**
   * Observe all changes to this collection.
   */
  get changes$(): Observable<CollectionChange> {
    return this._changes$;
  }

  /**
   * Create a live query that re-runs whenever the collection changes.
   * Returns an observable of record arrays.
   */
  observeQuery(queryOrBuilder: QueryDescriptor | QueryBuilder): Observable<M[]> {
    const descriptor =
      queryOrBuilder instanceof QueryBuilder ? queryOrBuilder.build() : queryOrBuilder;

    return new SharedObservable<M[]>((emit) => {
      // Initial fetch
      this._database._adapter.find(descriptor).then((raws) => {
        emit(raws.map((raw) => this._materialize(raw)));
      });

      // Re-fetch on any collection change
      const unsub = this._changes$.subscribe(async () => {
        const raws = await this._database._adapter.find(descriptor);
        emit(raws.map((raw) => this._materialize(raw)));
      });

      return unsub;
    });
  }

  /**
   * Observe a single record by ID.
   */
  observeById(id: string): Observable<M | null> {
    return new SharedObservable<M | null>((emit) => {
      // Initial fetch
      this.findById(id).then(emit);

      // Re-check on changes
      const unsub = this._changes$.subscribe(async (change) => {
        if (change.record.id === id) {
          if (change.type === 'deleted') {
            emit(null);
          } else {
            emit(await this.findById(id));
          }
        }
      });

      return unsub;
    });
  }

  /**
   * Observe a count matching a query.
   */
  observeCount(queryOrBuilder?: QueryDescriptor | QueryBuilder): Observable<number> {
    const descriptor = queryOrBuilder
      ? (queryOrBuilder instanceof QueryBuilder
        ? queryOrBuilder.build()
        : queryOrBuilder)
      : this.query().build();

    return new SharedObservable<number>((emit) => {
      this._database._adapter.count(descriptor).then(emit);

      const unsub = this._changes$.subscribe(async () => {
        emit(await this._database._adapter.count(descriptor));
      });

      return unsub;
    });
  }

  // ─── Internal (called by Model) ────────────────────────────────────

  async _update(id: string, rawUpdates: Partial<RawRecord>): Promise<void> {
    const existing = this._cache.get(id);
    if (!existing) throw new Error(`Cannot update: record ${id} not in cache`);

    const merged = { ...existing._rawRecord, ...rawUpdates } as RawRecord;
    await this._database._adapter.update(this.table, merged);

    this._changes$.next({ type: 'updated', record: existing });
  }

  async _delete(id: string): Promise<void> {
    await this._database._adapter.markAsDeleted(this.table, id);
    const record = this._cache.get(id);
    if (record) {
      this._changes$.next({ type: 'deleted', record });
    }
  }

  async _destroyPermanently(id: string): Promise<void> {
    await this._database._adapter.destroyPermanently(this.table, id);
    const record = this._cache.get(id);
    this._cache.delete(id);
    if (record) {
      this._changes$.next({ type: 'deleted', record });
    }
  }

  _getDatabase(): ModelDatabaseRef {
    return this._database;
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  /** Create a Model instance from a raw record */
  private _instantiate(raw: RawRecord): M {
    return new this._modelClass(this, raw) as M;
  }

  /** Get-or-create a Model instance from a raw record (cache-aware) */
  private _materialize(raw: RawRecord): M {
    const existing = this._cache.get(raw.id);
    if (existing) {
      // Refresh the raw data
      existing._setRaw(raw);
      return existing;
    }
    const record = this._instantiate(raw);
    this._cache.set(raw.id, record);
    return record;
  }

  /** Clear the cache — used during reset or sync */
  _clearCache(): void {
    this._cache.clear();
  }

  /** Directly add a raw record to cache (used during sync) */
  _cacheRaw(raw: RawRecord): M {
    return this._materialize(raw);
  }

  /** Notify external change (used by sync/batch) */
  _notifyChange(type: CollectionChangeType, record: Model): void {
    this._changes$.next({ type, record });
  }
}
