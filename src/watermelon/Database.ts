/**
 * WatermelonDB `Database` over a core `Database`.
 *
 * Constructed synchronously; initialisation (open, create tables, migrate)
 * starts immediately and every operation awaits `ready`.
 */

import { Database as CoreDatabase } from '../database/Database';
import type { StorageAdapter } from '../adapters/types';
import type { Collection as CoreCollection } from '../collection/Collection';
import type { ModelStatic } from '../model/Model';
import type { Unsubscribe } from '../observable/Subject';
import type { BatchOperation } from '../query/types';
import type { RawRecord } from '../schema/types';
import type { CompatAdapter } from './adapters';
import type { AppSchema } from './schema';
import { Collection, toChangeSet } from './Collection';
import type { CollectionChangeSet } from './Collection';
import type { Model } from './Model';
import { WatermelonObservable, subscribeToFutureValues } from './observable';
import { registerCompatCollection } from './registry';
import { m } from '../schema/builder';

export interface DatabaseOptions {
  readonly adapter: CompatAdapter;
  readonly modelClasses: ModelStatic[];
  /** Accepted for compatibility; writers are always required. */
  readonly actionsEnabled?: boolean;
}

/**
 * What `database.batch()` accepts: prepared records, nested arrays of them,
 * and `null` / `undefined` / `false` (ignored), as in WatermelonDB.
 */
export type BatchEntry = Model | null | undefined | false | readonly BatchEntry[];

export interface CollectionMap {
  get<T extends Model = Model>(table: string): Collection<T>;
}

/** Passed to `write()` / `read()` callbacks like WatermelonDB's writer interface. */
export interface WriterInterface {
  callWriter<T>(fn: () => Promise<T>): Promise<T>;
  callReader<T>(fn: () => Promise<T>): Promise<T>;
}

export class Database {
  /** The core database. */
  readonly pomegranate: CoreDatabase;
  /** The core storage adapter. */
  readonly adapter: StorageAdapter;
  /** The WatermelonDB-shaped adapter configuration this database was built from. */
  readonly compatAdapter: CompatAdapter;
  readonly schema: AppSchema;
  /** Resolves once the database is open and migrated; rejects if that fails. */
  readonly ready: Promise<void>;
  readonly collections: CollectionMap;

  readonly #collections = new Map<string, Collection>();

  constructor({ adapter, modelClasses }: DatabaseOptions) {
    if (!adapter?.pomegranate) {
      throw new Error(
        'Database requires an adapter created with SQLiteAdapter or LokiJSAdapter from pomegranate-db/watermelon',
      );
    }
    this.compatAdapter = adapter;
    this.adapter = adapter.pomegranate;
    this.schema = adapter.schema;
    for (const modelClass of modelClasses) {
      ensureModelSchema(modelClass, adapter.schema);
    }
    this.pomegranate = new CoreDatabase({
      adapter: adapter.pomegranate,
      models: modelClasses,
      schemaVersion: adapter.schemaVersion,
      migrations: adapter.migrations,
      migrationEvents: adapter.migrationEvents,
    });

    const byTable = new Map(
      modelClasses.map((modelClass) => [modelClass.schema.table, modelClass]),
    );
    for (const core of this.pomegranate.collections) {
      // Core collections are typed over the core Model; ours hold compat Models.
      const compat = new Collection(this, core as CoreCollection<Model>, byTable.get(core.table)!);
      this.#collections.set(core.table, compat);
      registerCompatCollection(core, compat);
    }

    this.collections = {
      get: <T extends Model = Model>(table: string): Collection<T> => {
        const collection = this.#collections.get(table);
        if (!collection) {
          throw new Error(`No collection registered for table "${table}"`);
        }
        return collection as Collection<T>;
      },
    };

    this.ready = this.pomegranate.initialize();
    // Surface set-up failures through the adapter hook; callers awaiting
    // `ready` (every method does) still see the rejection.
    this.ready.catch((error: unknown) => {
      adapter.onSetUpError?.(error);
    });
  }

  get<T extends Model = Model>(table: string): Collection<T> {
    return this.collections.get<T>(table);
  }

  /** Run mutations. Nested `write()` calls join the running transaction. */
  async write<T>(fn: (writer: WriterInterface) => Promise<T>): Promise<T> {
    await this.ready;
    return this.pomegranate.write(() => fn(this.#writer));
  }

  /** Run reads after the database is ready (no serialisation against writes). */
  async read<T>(fn: (reader: WriterInterface) => Promise<T>): Promise<T> {
    await this.ready;
    return fn(this.#writer);
  }

  readonly #writer: WriterInterface = {
    callWriter: (fn) => fn(),
    callReader: (fn) => fn(),
  };

  /**
   * Persist prepared records (`prepareCreate`, `prepareCreateFromDirtyRaw`,
   * `prepareUpdate`, `prepareMarkAsDeleted`, `prepareDestroyPermanently`)
   * in one adapter batch. Must be called inside `write()`. Nested arrays are
   * flattened and `null` / `undefined` / `false` entries are ignored.
   *
   * Afterwards every collection is updated and notified per record, exactly
   * as the equivalent individual mutations would have: created records are
   * cached and emit `created`, updated ones refresh in place and emit
   * `updated` with their changed columns, deleted ones emit `deleted`.
   */
  async batch(...entries: BatchEntry[]): Promise<void> {
    await this.ready;
    const core = this.pomegranate;
    core._ensureInWriter('Database.batch()');

    const records: Model[] = [];
    flattenEntries(entries, records);
    if (records.length === 0) return;

    const operations = records.map((record) => this.#operationFor(record));

    // Held instances become the cached ones so the core refreshes them in
    // place; remember what the cache held so a failed batch can restore it.
    const staged: Array<{ record: Model; previous: Model | undefined }> = [];
    for (const [i, record] of records.entries()) {
      const collection = record.collection.pomegranate;
      const previous = collection._peekCached(record.id);
      if (previous === record) continue;
      if (operations[i].type === 'create' || previous === undefined) {
        collection._cacheRecord(record);
        staged.push({ record, previous });
      }
    }

    try {
      await core._batch(operations);
    } catch (error) {
      for (const { record, previous } of staged) {
        const collection = record.collection.pomegranate;
        if (previous) collection._cacheRecord(previous);
        else collection._evictCached(record.id);
      }
      throw error;
    }

    core._applyBatchOperations(operations);
    for (const record of records) {
      record._setPreparedState(null);
    }
  }

  #operationFor(record: Model): BatchOperation {
    const prepared = record?._preparedState;
    if (prepared === undefined) {
      throw new TypeError(
        'database.batch() only accepts records from pomegranate-db/watermelon ' +
          '(prepareCreate / prepareUpdate / prepareMarkAsDeleted / prepareDestroyPermanently)',
      );
    }
    const table = record.collection.table;
    if (record.collection.database !== this) {
      throw new Error(`Record ${table}#${record.id} belongs to a different database`);
    }
    if (!prepared) {
      throw new Error(
        `Record ${table}#${record.id} passed to database.batch() has no prepared ` +
          'operation — call prepareCreate / prepareUpdate / prepareMarkAsDeleted / ' +
          'prepareDestroyPermanently first',
      );
    }
    switch (prepared.type) {
      case 'create':
        return { type: 'create', table, rawRecord: prepared.raw };
      case 'update': {
        const updates: Partial<RawRecord> = {
          ...prepared.rawUpdates,
          ...record._syncColumnsFor(prepared.changedColumns),
        };
        return {
          type: 'update',
          table,
          rawRecord: { ...record._raw, ...updates },
          changedColumns: prepared.changedColumns,
        };
      }
      case 'markAsDeleted':
        return { type: 'delete', table, id: record.id };
      case 'destroyPermanently':
        return { type: 'destroyPermanently', table, id: record.id };
    }
  }

  /**
   * Drop every table and recreate them empty (also clearing sync metadata,
   * so the next sync is a first sync). Must be called inside `write()`.
   */
  async unsafeResetDatabase(): Promise<void> {
    await this.ready;
    this.pomegranate._ensureInWriter('Database.unsafeResetDatabase()');
    await this.pomegranate.reset();
    await this.pomegranate.initialize();
  }

  /**
   * Emits `null` on subscribe, then one change set per record created,
   * updated or destroyed in any of `tables`.
   */
  withChangesForTables(tables: string[]): WatermelonObservable<CollectionChangeSet[] | null> {
    const list = [...tables];
    return new WatermelonObservable<CollectionChangeSet[] | null>((observer) => {
      let cancelled = false;
      const unsubs: Unsubscribe[] = [];
      this.ready.then(
        () => {
          if (cancelled) return;
          observer.next(null);
          for (const table of list) {
            const core = this.collections.get(table).pomegranate;
            unsubs.push(
              subscribeToFutureValues(core.changes$, (change) => {
                observer.next([toChangeSet(change)]);
              }),
            );
          }
        },
        (error: unknown) => observer.error(error),
      );
      return () => {
        cancelled = true;
        for (const unsub of unsubs) unsub();
      };
    });
  }
}

function flattenEntries(entries: readonly BatchEntry[], out: Model[]): void {
  for (const entry of entries) {
    if (entry === null || entry === undefined || entry === false) continue;
    if (Array.isArray(entry)) {
      flattenEntries(entry as readonly BatchEntry[], out);
    } else {
      out.push(entry as Model);
    }
  }
}

/**
 * WatermelonDB models need only `static table`; the columns live in `appSchema`.
 * When a compat model class declares no `static schema`, derive one from the
 * app schema so such classes keep working. Field names equal column names, so
 * `getField('column')`, `_raw` and `prepareCreateFromDirtyRaw` line up.
 */
function ensureModelSchema(modelClass: ModelStatic, appSchema: AppSchema): void {
  if (modelClass.schema) return;
  const table = (modelClass as unknown as { table?: string }).table;
  if (!table) {
    throw new Error(`Model class ${modelClass.name} declares neither static schema nor static table`);
  }
  const tableSchema = appSchema.tables[table];
  if (!tableSchema) {
    throw new Error(`Model class ${modelClass.name} has table "${table}" which is not in appSchema`);
  }
  const fields: Record<string, unknown> = {};
  for (const column of tableSchema.columnArray) {
    let builder;
    switch (column.type) {
      case 'number':
        builder = m.number(column.name);
        break;
      case 'boolean':
        builder = m.boolean(column.name);
        break;
      default:
        builder = m.text(column.name);
    }
    if (column.isOptional) builder = builder.optional();
    if (column.isIndexed) builder = builder.indexed();
    fields[column.name] = builder;
  }
  (modelClass as unknown as { schema: unknown }).schema = m.model(table, fields as never);
}
