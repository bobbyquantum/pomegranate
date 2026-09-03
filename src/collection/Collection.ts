/**
 * Collection — manages all records for a single table/model.
 *
 * Collections provide CRUD operations, query building, record caching,
 * and change notification. Each Collection is associated with one Model class.
 */

import type { ModelSchema, RawRecord } from '../schema/types';
import { createRawRecord } from '../model/Model';
import type { ModelStatic, ModelCollectionRef, ModelDatabaseRef, Model } from '../model/Model';
import { QueryBuilder } from '../query/QueryBuilder';
import type { AssociationJoin } from '../query/QueryBuilder';
import type { QueryDescriptor, SearchDescriptor } from '../query/types';
import { collectQueryColumns, collectExistsTables } from '../query/introspect';
import { Subject } from '../observable/Subject';
import type { Observable } from '../observable/Subject';
import { SharedObservable } from '../observable/Subject';
import type { StorageAdapter } from '../adapters/types';

// ─── Change event types ────────────────────────────────────────────────────

export type CollectionChangeType = 'created' | 'updated' | 'deleted';

export interface CollectionChange {
  readonly type: CollectionChangeType;
  readonly record: Model;
  /**
   * Column names changed by an `updated` event (from `Model.update()`).
   * Absent for created/deleted events and for synthetic notifications
   * (batch, sync), which live queries treat as "anything may have changed".
   */
  readonly columns?: readonly string[];
}

export interface ObserveQueryOptions {
  /**
   * Re-emit when any of these columns changes on a record in the result set
   * (WatermelonDB `observeWithColumns`). Without it, the observable emits only
   * when the set/order of matching record ids changes (`observe`).
   */
  readonly columns?: readonly string[];
}

/** What a Collection needs from its Database */
type CollectionDatabase = ModelDatabaseRef & {
  readonly _adapter: StorageAdapter;
  collection(table: string): Collection;
};

// ─── Collection class ──────────────────────────────────────────────────────

export class Collection<M extends Model = Model> implements ModelCollectionRef {
  readonly table: string;
  private _modelClass: ModelStatic;
  private _schema: ModelSchema;
  private _database: CollectionDatabase;

  /** In-memory cache of instantiated records by ID */
  private _cache = new Map<string, M>();

  /** Emits whenever the collection changes */
  private _changes$ = new Subject<CollectionChange>();

  constructor(database: CollectionDatabase, modelClass: ModelStatic) {
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
   * The builder can resolve associations to other tables for `on()`.
   */
  query(): QueryBuilder;
  query(fn: (qb: QueryBuilder) => void): QueryBuilder;
  query(fn?: (qb: QueryBuilder) => void): QueryBuilder {
    const qb = new QueryBuilder(this.table, {
      associations: (from, to) => this._resolveAssociation(from, to),
    });
    // Automatically exclude soft-deleted records
    qb.where('_status', 'neq', 'deleted');
    if (fn) fn(qb);
    return qb;
  }

  /**
   * Execute a query and return model instances.
   */
  async fetch(queryOrBuilder: QueryDescriptor | QueryBuilder): Promise<M[]> {
    const descriptor = toDescriptor(queryOrBuilder);
    const raws = await this._database._adapter.find(descriptor);
    return raws.map((raw) => this._materialize(raw));
  }

  /**
   * Count records matching a query.
   */
  async count(queryOrBuilder?: QueryDescriptor | QueryBuilder): Promise<number> {
    const descriptor = queryOrBuilder ? toDescriptor(queryOrBuilder) : this.query().build();
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
   * Create a live query (WatermelonDB `observe` / `observeWithColumns`).
   *
   * Emits once on subscribe, then whenever the ordered list of matching ids
   * changes — or, with `options.columns`, when one of those columns changes
   * on a matched record. Change events are filtered for relevance before the
   * query is re-run: an `updated` event with column info is ignored unless the
   * record is in the current result set or one of its changed columns is
   * referenced by the query. Changes to tables reached via `on()` (exists
   * clauses) always trigger a re-run.
   */
  observeQuery(
    queryOrBuilder: QueryDescriptor | QueryBuilder,
    options: ObserveQueryOptions = {},
  ): Observable<M[]> {
    const descriptor = toDescriptor(queryOrBuilder);
    const columns = options.columns ? [...options.columns] : null;

    return this._observeLive<RawRecord[], M[]>(
      descriptor,
      () => this._database._adapter.find(descriptor),
      (raws) => raws.map((raw) => this._materialize(raw)),
      (next, previous) => resultSetChanged(next, previous, columns),
      (raws) => new Set(raws.map((raw) => raw.id)),
    );
  }

  /**
   * Live query that also re-emits when any of `columns` changes on a matched
   * record. Alias for `observeQuery(query, { columns })`.
   */
  observeQueryWithColumns(
    queryOrBuilder: QueryDescriptor | QueryBuilder,
    columns: readonly string[],
  ): Observable<M[]> {
    return this.observeQuery(queryOrBuilder, { columns });
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
   * Observe a count matching a query. Emits once on subscribe, then only when
   * the count changes. Irrelevant `updated` events are filtered as in
   * `observeQuery` (by referenced columns; there is no id set to consult).
   */
  observeCount(queryOrBuilder?: QueryDescriptor | QueryBuilder): Observable<number> {
    const descriptor = queryOrBuilder ? toDescriptor(queryOrBuilder) : this.query().build();

    return this._observeLive<number, number>(
      descriptor,
      () => this._database._adapter.count(descriptor),
      (count) => count,
      (next, previous) => next !== previous,
      () => null,
    );
  }

  /**
   * Shared live-query engine.
   *
   * `execute` runs the query; `project` maps its result to the emitted value
   * (always called, so caches stay fresh); `hasChanged` decides whether to
   * emit; `idsOf` exposes the current result ids for relevance filtering.
   * Runs are serialised and coalesced so results never emit out of order.
   */
  private _observeLive<R, T>(
    descriptor: QueryDescriptor,
    execute: () => Promise<R>,
    project: (result: R) => T,
    hasChanged: (next: R, previous: R) => boolean,
    idsOf: (result: R) => ReadonlySet<string> | null,
  ): Observable<T> {
    const queryColumns = collectQueryColumns(descriptor);
    const innerTables = [...collectExistsTables(descriptor)].filter((t) => t !== this.table);

    return new SharedObservable<T>((emit) => {
      let cancelled = false;
      let previous: { value: R } | null = null;
      let lastIds: ReadonlySet<string> | null = null;
      let running = false;
      let dirty = false;

      const run = async (): Promise<void> => {
        if (running) {
          dirty = true;
          return;
        }
        running = true;
        try {
          do {
            dirty = false;
            const next = await execute();
            if (cancelled) return;
            const changed = !previous || hasChanged(next, previous.value);
            previous = { value: next };
            lastIds = idsOf(next);
            const projected = project(next);
            if (changed) emit(projected);
          } while (dirty && !cancelled);
        } finally {
          running = false;
        }
      };

      const isRelevant = (change: CollectionChange): boolean => {
        if (change.type !== 'updated' || !change.columns || !previous) return true;
        if (lastIds?.has(change.record.id)) return true;
        return change.columns.some((column) => queryColumns.has(column));
      };

      void run();

      const unsubs = [
        subscribeToFutureChanges(this._changes$, (change) => {
          if (isRelevant(change)) void run();
        }),
      ];
      for (const table of innerTables) {
        const inner = this._collectionFor(table);
        if (inner) {
          unsubs.push(
            subscribeToFutureChanges(inner.changes$, () => {
              void run();
            }),
          );
        }
      }

      return () => {
        cancelled = true;
        for (const unsub of unsubs) unsub();
      };
    });
  }

  // ─── Associations (for QueryBuilder.on) ────────────────────────────

  /**
   * Join columns linking this table to `table`, from the schema's relations
   * first, then the model class's `static associations`. `null` if unknown.
   */
  _associationTo(table: string): AssociationJoin | null {
    for (const relation of this._schema.relations) {
      if (relation._relatedSchemaThunk().table === table) {
        return relation.kind === 'belongs_to'
          ? { localColumn: relation.foreignKey, foreignColumn: 'id' }
          : { localColumn: 'id', foreignColumn: relation.foreignKey };
      }
    }
    const association = this._modelClass.associations?.[table];
    if (association) {
      return association.type === 'belongs_to'
        ? { localColumn: association.key, foreignColumn: 'id' }
        : { localColumn: 'id', foreignColumn: association.foreignKey };
    }
    return null;
  }

  private _resolveAssociation(fromTable: string, toTable: string): AssociationJoin | null {
    const from = fromTable === this.table ? this : this._collectionFor(fromTable);
    return from ? from._associationTo(toTable) : null;
  }

  private _collectionFor(table: string): Collection | null {
    try {
      return this._database.collection(table);
    } catch {
      return null;
    }
  }

  // ─── Internal (called by Model) ────────────────────────────────────

  async _update(
    id: string,
    rawUpdates: Partial<RawRecord>,
    changedColumns?: readonly string[],
  ): Promise<void> {
    const existing = this._cache.get(id);
    if (!existing) throw new Error(`Cannot update: record ${id} not in cache`);

    const merged = { ...existing._rawRecord, ...rawUpdates } as RawRecord;
    await this._database._adapter.update(this.table, merged);

    this._changes$.next({
      type: 'updated',
      record: existing,
      columns: changedColumns ? [...changedColumns] : undefined,
    });
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

  /**
   * Apply raw updates to an already-instantiated record so it reflects a
   * change made directly through the adapter (e.g. marked synced). No-op when
   * the record is not cached; the record's own observable emits.
   */
  _refreshCached(id: string, updates: Partial<RawRecord>): void {
    this._cache.get(id)?._setRaw(updates);
  }

  /** Drop a record from the cache (after it was destroyed through the adapter). */
  _evictCached(id: string): void {
    this._cache.delete(id);
  }

  /**
   * Notify external change (used by sync/batch).
   * Omit `columns` when the changed columns are unknown — live queries then
   * re-run unconditionally.
   */
  _notifyChange(type: CollectionChangeType, record: Model, columns?: readonly string[]): void {
    this._changes$.next({ type, record, columns });
  }
}

// ─── Module helpers ────────────────────────────────────────────────────────

/**
 * `Subject` replays its last value synchronously on subscribe; for a change
 * stream that is a stale event the initial query run already covers, so skip it.
 */
function subscribeToFutureChanges(
  changes: Observable<CollectionChange>,
  handler: (change: CollectionChange) => void,
): () => void {
  let subscribed = false;
  const unsub = changes.subscribe((change) => {
    if (subscribed) handler(change);
  });
  subscribed = true;
  return unsub;
}

function toDescriptor(queryOrBuilder: QueryDescriptor | QueryBuilder): QueryDescriptor {
  return queryOrBuilder instanceof QueryBuilder ? queryOrBuilder.build() : queryOrBuilder;
}

/**
 * True when the ordered id list differs, or (when `columns` is given) any of
 * those columns' raw values differs for a record present in both results.
 */
function resultSetChanged(
  next: readonly RawRecord[],
  previous: readonly RawRecord[],
  columns: readonly string[] | null,
): boolean {
  if (next.length !== previous.length) return true;
  if (next.some((record, i) => record.id !== previous[i].id)) return true;
  if (!columns) return false;
  return next.some((record, i) => columns.some((column) => record[column] !== previous[i][column]));
}
