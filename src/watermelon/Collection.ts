/**
 * WatermelonDB `Collection<T>` over a core `Collection`.
 */

import type { Collection as CoreCollection, CollectionChange } from '../collection/Collection';
import type { ModelCollectionRef, ModelDatabaseRef, ModelStatic } from '../model/Model';
import { createRawRecord } from '../model/Model';
import type { ModelSchema, RawRecord, ResolvedColumn } from '../schema/types';
import type { Unsubscribe } from '../observable/Subject';
import type { Clause } from './Q';
import { Query } from './Query';
import type { Model, PrepareMutator } from './Model';
import type { Database } from './Database';
import { WatermelonObservable, subscribeToFutureValues } from './observable';

export type CollectionChangeType = 'created' | 'updated' | 'destroyed';

export interface CollectionChangeSet<T extends Model = Model> {
  readonly record: T;
  readonly type: CollectionChangeType;
}

export function toChangeSet<T extends Model>(change: CollectionChange): CollectionChangeSet<T> {
  return {
    record: change.record as T,
    type: change.type === 'deleted' ? 'destroyed' : change.type,
  };
}

export class Collection<T extends Model = Model> implements ModelCollectionRef {
  readonly table: string;
  readonly database: Database;
  readonly modelClass: ModelStatic;
  /** The core collection. */
  readonly pomegranate: CoreCollection<T>;

  constructor(database: Database, core: CoreCollection<T>, modelClass: ModelStatic) {
    this.database = database;
    this.pomegranate = core;
    this.modelClass = modelClass;
    this.table = core.table;
  }

  get schema(): ModelSchema {
    return this.pomegranate.schema;
  }

  /** Alias kept for WatermelonDB parity (`collection.db`). */
  get db(): Database {
    return this.database;
  }

  query(...clauses: Array<Clause | readonly Clause[]>): Query<T> {
    // WatermelonDB accepts nested clause arrays (e.g. `query(clausesArray)`).
    const flat = clauses.flat() as Clause[];
    return new Query<T>(this, flat);
  }

  /** Find a record by id; rejects when it does not exist (or is deleted). */
  async find(id: string): Promise<T> {
    await this.database.ready;
    const record = await this.pomegranate.findById(id);
    if (!record || record.syncStatus === 'deleted') {
      throw new Error(`Record ${id} not found in ${this.table}`);
    }
    return record;
  }

  /**
   * Observe a record by id. Errors if the record does not exist; completes
   * when it is later deleted.
   */
  findAndObserve(id: string): WatermelonObservable<T> {
    return new WatermelonObservable<T>((observer) => {
      let cancelled = false;
      let inner: Unsubscribe | null = null;
      let emitted = false;
      this.database.ready.then(
        () => {
          if (cancelled) return;
          inner = this.pomegranate.observeById(id).subscribe((record) => {
            if (record && record.syncStatus !== 'deleted') {
              emitted = true;
              observer.next(record);
            } else if (emitted) {
              observer.complete();
            } else {
              observer.error(new Error(`Record ${id} not found in ${this.table}`));
            }
          });
        },
        (error: unknown) => observer.error(error),
      );
      return () => {
        cancelled = true;
        inner?.();
      };
    });
  }

  /**
   * Create a record. Must be called inside `database.write()`. The mutator
   * receives a draft whose setters stage values; getters reflect them.
   */
  async create(mutator?: (record: T) => void | Promise<void>): Promise<T> {
    await this.database.ready;
    this.database.pomegranate._ensureInWriter('Collection.create()');

    const draft = this._draft();
    const patch = await draft._captureMutations(mutator);
    return this._insert(draft, createRawRecord(this.schema, patch, draft.id));
  }

  /**
   * Build a record without persisting it, for `database.batch()`. The
   * mutator runs now (synchronously, like WatermelonDB's); `record.id` is
   * already assigned so it can be wired into other prepared records.
   */
  prepareCreate(mutator?: PrepareMutator<T>): T {
    const draft = this._draft();
    const patch = draft._captureMutationsSync(mutator, 'prepareCreate()');
    return this._stageCreate(draft, createRawRecord(this.schema, patch, draft.id));
  }

  /**
   * Like `prepareCreate()`, but the row comes from a raw object keyed by
   * **column** name (e.g. a server payload). Unknown columns are dropped,
   * values are coerced to the schema (booleans → 0/1, dates → timestamps,
   * JSON → string), missing columns take their defaults, `id` is honoured
   * when present, and the record is `_status: 'created'`, `_changed: ''`.
   */
  prepareCreateFromDirtyRaw(dirtyRaw: Record<string, unknown>): T {
    const raw = rawFromDirty(this.schema, dirtyRaw);
    return this._stageCreate(new this.modelClass(this.pomegranate, raw) as T, raw);
  }

  /** `prepareCreateFromDirtyRaw()` persisted at once. Must be inside `write()`. */
  async createFromDirtyRaw(dirtyRaw: Record<string, unknown>): Promise<T> {
    await this.database.ready;
    this.database.pomegranate._ensureInWriter('Collection.createFromDirtyRaw()');
    const record = this.prepareCreateFromDirtyRaw(dirtyRaw);
    record._setPreparedState(null);
    return this._insert(record, record._raw);
  }

  /** A fresh draft with default values (not cached, not persisted). */
  private _draft(): T {
    const draft = new this.modelClass(this.pomegranate, createRawRecord(this.schema, {})) as T;
    if (typeof draft._captureMutations !== 'function') {
      throw new TypeError(
        `Model class for table "${this.table}" must extend Model from 'pomegranate-db/watermelon'`,
      );
    }
    return draft;
  }

  private _stageCreate(draft: T, raw: RawRecord): T {
    if (draft._raw !== raw) draft._setRaw(raw);
    draft._setPreparedState({ type: 'create', raw });
    return draft;
  }

  /** Persist `raw` as `record`, cache the instance and notify observers. */
  private async _insert(record: T, raw: RawRecord): Promise<T> {
    await this.database.pomegranate._adapter.insert(this.table, raw);
    this._commitCreated(record, raw);
    return record;
  }

  /** @internal After `raw` was inserted: make `record` the live instance. */
  _commitCreated(record: T, raw: RawRecord): void {
    if (record._raw !== raw) record._setRaw(raw);
    this.pomegranate._cacheRecord(record);
    this.pomegranate._notifyChange('created', record);
  }

  /** Emits one change set per created/updated/destroyed record. */
  get changes(): WatermelonObservable<CollectionChangeSet<T>[]> {
    return new WatermelonObservable<CollectionChangeSet<T>[]>((observer) => {
      let cancelled = false;
      let inner: Unsubscribe | null = null;
      this.database.ready.then(
        () => {
          if (cancelled) return;
          inner = subscribeToFutureValues(this.pomegranate.changes$, (change) => {
            observer.next([toChangeSet<T>(change)]);
          });
        },
        (error: unknown) => observer.error(error),
      );
      return () => {
        cancelled = true;
        inner?.();
      };
    });
  }

  // ─── ModelCollectionRef (delegated to the core collection) ─────────────

  _update(id: string, raw: Partial<RawRecord>, changedColumns?: readonly string[]): Promise<void> {
    return this.pomegranate._update(id, raw, changedColumns);
  }

  _delete(id: string): Promise<void> {
    return this.pomegranate._delete(id);
  }

  _destroyPermanently(id: string): Promise<void> {
    return this.pomegranate._destroyPermanently(id);
  }

  _getDatabase(): ModelDatabaseRef {
    return this.pomegranate._getDatabase();
  }
}

// ─── Dirty raw sanitisation ─────────────────────────────────────────────────

/**
 * Build a raw row from a column-keyed object, as WatermelonDB's
 * `sanitizedRaw` does: unknown columns dropped, values coerced per column
 * type, missing or invalid ones replaced by the schema default.
 */
export function rawFromDirty(schema: ModelSchema, dirtyRaw: Record<string, unknown>): RawRecord {
  const patch: Record<string, unknown> = {};
  for (const col of schema.columns) {
    if (!(col.columnName in dirtyRaw)) continue;
    const value = coerceDirtyValue(col, dirtyRaw[col.columnName]);
    if (value !== undefined) patch[col.fieldName] = value;
  }
  const id = dirtyRaw.id;
  return createRawRecord(schema, patch, typeof id === 'string' && id !== '' ? id : undefined);
}

/** A field-level value for `createRawRecord`, or `undefined` to use the column default. */
function coerceDirtyValue(col: ResolvedColumn, value: unknown): unknown {
  if (value === null || value === undefined) return col.isOptional ? null : undefined;
  switch (col.type) {
    case 'text':
      return typeof value === 'string' ? value : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'boolean':
      if (typeof value === 'boolean') return value;
      return value === 1 || value === 0 ? value === 1 : undefined;
    case 'date':
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'json':
      return value;
  }
}
