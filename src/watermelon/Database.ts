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
import type { CompatAdapter } from './adapters';
import type { AppSchema } from './schema';
import { Collection, toChangeSet } from './Collection';
import type { CollectionChangeSet } from './Collection';
import type { Model } from './Model';
import { WatermelonObservable, subscribeToFutureValues } from './observable';
import { registerCompatCollection } from './registry';

export interface DatabaseOptions {
  readonly adapter: CompatAdapter;
  readonly modelClasses: ModelStatic[];
  /** Accepted for compatibility; writers are always required. */
  readonly actionsEnabled?: boolean;
}

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
