/**
 * Expo SQLite Driver.
 *
 * Implements the SQLiteDriver interface using expo-sqlite (v14+).
 * This enables PomegranateDB to work seamlessly in Expo projects
 * using the Expo managed SQLite library instead of requiring
 * react-native-quick-sqlite or op-sqlite.
 *
 * Usage:
 *   import { createExpoSQLiteDriver } from 'pomegranate-db/expo';
 *   import { SQLiteAdapter } from 'pomegranate-db';
 *
 *   const adapter = new SQLiteAdapter({
 *     databaseName: 'myapp',
 *     driver: createExpoSQLiteDriver(),
 *   });
 */

import type { SQLiteDriver } from '../sqlite/SQLiteAdapter';

// We import the types only; the actual module is a peer dependency
// that must be installed by the consumer.
type ExpoSQLiteDatabase = {
  execAsync(source: string): Promise<void>;
  runAsync(
    source: string,
    ...params: unknown[]
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T = Record<string, unknown>>(source: string, ...params: unknown[]): Promise<T[]>;
  withExclusiveTransactionAsync(task: (txn: ExpoSQLiteDatabase) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
};

type ExpoSQLiteModule = {
  openDatabaseAsync(
    databaseName: string,
    options?: { enableChangeListener?: boolean },
  ): Promise<ExpoSQLiteDatabase>;
};

export interface ExpoSQLiteDriverConfig {
  /**
   * Options passed to expo-sqlite's openDatabaseAsync.
   * @default {}
   */
  openOptions?: { enableChangeListener?: boolean };
}

/**
 * Create a SQLiteDriver backed by expo-sqlite.
 *
 * expo-sqlite must be installed in the consuming project:
 *   npx expo install expo-sqlite
 */
export function createExpoSQLiteDriver(config?: ExpoSQLiteDriverConfig): SQLiteDriver {
  let db: ExpoSQLiteDatabase | null = null;
  let expoSQLite: ExpoSQLiteModule | null = null;

  // Lazily import expo-sqlite so this module can be imported
  // without expo-sqlite being installed (e.g. in tests).
  async function getExpoSQLite(): Promise<ExpoSQLiteModule> {
    if (!expoSQLite) {
      try {
        // @ts-expect-error — expo-sqlite is an optional peer dependency
        expoSQLite = await import('expo-sqlite') as ExpoSQLiteModule;
      } catch {
        throw new Error(
          'expo-sqlite is not installed. Install it with: npx expo install expo-sqlite',
        );
      }
    }
    return expoSQLite;
  }

  function requireDb(): ExpoSQLiteDatabase {
    if (!db) {
      throw new Error('Database not open. Call open() first.');
    }
    return db;
  }

  return {
    async open(name: string): Promise<void> {
      const sqlite = await getExpoSQLite();
      db = await sqlite.openDatabaseAsync(
        name.endsWith('.db') ? name : `${name}.db`,
        config?.openOptions,
      );
      // Enable WAL mode for better performance
      await db.execAsync('PRAGMA journal_mode = WAL');
    },

    async execute(sql: string, bindings?: unknown[]): Promise<void> {
      const database = requireDb();
      if (bindings && bindings.length > 0) {
        await database.runAsync(sql, ...bindings);
      } else {
        await database.execAsync(sql);
      }
    },

    async query(sql: string, bindings?: unknown[]): Promise<Record<string, unknown>[]> {
      const database = requireDb();
      if (bindings && bindings.length > 0) {
        return database.getAllAsync(sql, ...bindings);
      }
      return database.getAllAsync(sql);
    },

    async executeInTransaction(fn: () => Promise<void>): Promise<void> {
      const database = requireDb();
      await database.withExclusiveTransactionAsync(async (_txn) => {
        // expo-sqlite's exclusive transaction scopes all queries
        // on this database connection to the transaction, so we
        // can just call fn() which uses the same `db` reference.
        await fn();
      });
    },

    async close(): Promise<void> {
      if (db) {
        await db.closeAsync();
        db = null;
      }
    },
  };
}
