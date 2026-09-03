/**
 * WatermelonDB `Collection<T>` over a core `Collection`.
 */

import type { Collection as CoreCollection, CollectionChange } from '../collection/Collection';
import type { ModelCollectionRef, ModelDatabaseRef, ModelStatic } from '../model/Model';
import { createRawRecord } from '../model/Model';
import type { ModelSchema, RawRecord } from '../schema/types';
import type { Unsubscribe } from '../observable/Subject';
import type { Clause } from './Q';
import { Query } from './Query';
import type { Model } from './Model';
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
    const coreDb = this.database.pomegranate;
    coreDb._ensureInWriter('Collection.create()');

    const draft = new this.modelClass(this.pomegranate, createRawRecord(this.schema, {})) as T;
    if (typeof draft._captureMutations !== 'function') {
      throw new TypeError(
        `Model class for table "${this.table}" must extend Model from 'pomegranate-db/watermelon'`,
      );
    }
    const patch = await draft._captureMutations(mutator);

    const raw: RawRecord = createRawRecord(this.schema, patch, draft.id);
    await coreDb._adapter.insert(this.table, raw);
    const record = this.pomegranate._cacheRaw(raw);
    this.pomegranate._notifyChange('created', record);
    return record;
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
