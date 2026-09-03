/**
 * WatermelonDB-shaped adapter constructors.
 *
 * `SQLiteAdapter` and `LokiJSAdapter` accept WatermelonDB's options and
 * produce a configuration object the compat `Database` consumes: the core
 * storage adapter plus the schema version, migrations and migration events.
 */

import { SQLiteAdapter as CoreSQLiteAdapter } from '../adapters/sqlite/SQLiteAdapter';
import type { SQLiteDriver } from '../adapters/sqlite/SQLiteAdapter';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import type { StorageAdapter, Migration as CoreMigration, MigrationEvents } from '../adapters/types';
import { logger } from '../utils';
import type { AppSchema } from './schema';
import type { SchemaMigrations } from './migrations';
import { toCoreMigrations } from './migrations';

/** WatermelonDB's migration lifecycle callbacks (no arguments on start/success). */
export interface CompatMigrationEvents {
  onStart?: () => void;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

/** What the compat `Database` needs from an adapter. */
export interface CompatAdapter {
  readonly schema: AppSchema;
  readonly schemaVersion: number;
  readonly migrations: CoreMigration[];
  readonly migrationEvents?: MigrationEvents;
  readonly dbName: string;
  /** The core storage adapter. */
  readonly pomegranate: StorageAdapter;
  /** Called if the database fails to initialise (open, create or migrate). */
  readonly onSetUpError?: (error: unknown) => void;
}

interface CommonOptions {
  schema: AppSchema;
  migrations?: SchemaMigrations;
  dbName?: string;
  migrationEvents?: CompatMigrationEvents;
  onSetUpError?: (error: unknown) => void;
}

// ─── SQLite ────────────────────────────────────────────────────────────────

export interface SQLiteAdapterOptions extends CommonOptions {
  /**
   * The SQLite driver. Defaults to `createNativeSQLiteDriver()` from
   * `pomegranate-db/native-sqlite` (loaded lazily, so this module can be
   * imported on web as long as a driver is given or Loki is used).
   */
  driver?: SQLiteDriver;
  /** Ignored — PomegranateDB always uses its JSI driver when no driver is given. */
  jsi?: boolean;
  /** Ignored. */
  usesExclusiveLocking?: boolean;
}

export class SQLiteAdapter implements CompatAdapter {
  readonly schema: AppSchema;
  readonly schemaVersion: number;
  readonly migrations: CoreMigration[];
  readonly migrationEvents?: MigrationEvents;
  readonly dbName: string;
  readonly pomegranate: CoreSQLiteAdapter;
  readonly onSetUpError?: (error: unknown) => void;

  constructor(options: SQLiteAdapterOptions) {
    if (!options?.schema) throw new Error('SQLiteAdapter requires a `schema`');
    this.schema = options.schema;
    this.schemaVersion = options.schema.version;
    this.migrations = toCoreMigrations(options.migrations);
    this.migrationEvents = options.migrationEvents;
    this.onSetUpError = options.onSetUpError;
    this.dbName = options.dbName ?? 'pomegranate';
    this.pomegranate = new CoreSQLiteAdapter({
      databaseName: this.dbName,
      driver: options.driver ?? loadNativeDriver(),
    });
  }
}

function loadNativeDriver(): SQLiteDriver {
  // Lazy so that importing this module never requires the native binding.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nativeSqlite = require('../adapters/native-sqlite') as typeof import('../adapters/native-sqlite');
  return nativeSqlite.createNativeSQLiteDriver();
}

// ─── LokiJS ────────────────────────────────────────────────────────────────

export interface LokiJSAdapterOptions extends CommonOptions {
  /** Not supported: LokiJS always runs on the main thread. Warns once. */
  useWebWorker?: boolean;
  /** Persist to IndexedDB with Loki's incremental adapter when `indexedDB` exists. */
  useIncrementalIndexedDB?: boolean;
  /** Ignored. */
  onQuotaExceededError?: (error: unknown) => void;
  /** Ignored. */
  onIndexedDBVersionChange?: () => void;
  /** Ignored. */
  onIndexedDBFetchStart?: () => void;
  /** Ignored. */
  extraIncrementalIDBOptions?: Record<string, unknown>;
}

let warnedAboutWebWorker = false;

export class LokiJSAdapter implements CompatAdapter {
  readonly schema: AppSchema;
  readonly schemaVersion: number;
  readonly migrations: CoreMigration[];
  readonly migrationEvents?: MigrationEvents;
  readonly dbName: string;
  readonly pomegranate: LokiAdapter;
  readonly onSetUpError?: (error: unknown) => void;
  /** Whether IndexedDB persistence was actually set up. */
  readonly persistent: boolean;

  constructor(options: LokiJSAdapterOptions) {
    if (!options?.schema) throw new Error('LokiJSAdapter requires a `schema`');
    this.schema = options.schema;
    this.schemaVersion = options.schema.version;
    this.migrations = toCoreMigrations(options.migrations);
    this.migrationEvents = options.migrationEvents;
    this.onSetUpError = options.onSetUpError;
    this.dbName = options.dbName ?? 'pomegranate';

    if (options.useWebWorker && !warnedAboutWebWorker) {
      warnedAboutWebWorker = true;
      logger.warn(
        'LokiJSAdapter: useWebWorker is not supported by the WatermelonDB compatibility layer; ' +
          'LokiJS runs on the main thread.',
      );
    }

    const persistenceAdapter = options.useIncrementalIndexedDB
      ? createIncrementalIndexedDbAdapter()
      : undefined;
    this.persistent = persistenceAdapter !== undefined;
    this.pomegranate = new LokiAdapter({ databaseName: this.dbName, persistenceAdapter });
  }
}

function createIncrementalIndexedDbAdapter(): unknown {
  if ((globalThis as Record<string, unknown>).indexedDB === undefined) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('lokijs/src/incremental-indexeddb-adapter') as
      | { default?: new () => unknown }
      | (new () => unknown);
    const Adapter =
      typeof loaded === 'function' ? loaded : loaded.default;
    return Adapter ? new Adapter() : undefined;
  } catch (error) {
    logger.warn('LokiJSAdapter: could not load the IncrementalIndexedDB adapter; using memory only.', error);
    return undefined;
  }
}
