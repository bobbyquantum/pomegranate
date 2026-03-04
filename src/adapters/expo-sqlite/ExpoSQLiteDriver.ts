/**
 * Expo SQLite Driver.
 *
 * Implements the SQLiteDriver interface using expo-sqlite (v14+).
 * This enables PomegranateDB to work seamlessly in Expo projects
 * using the Expo managed SQLite library instead of requiring
 * react-native-quick-sqlite or op-sqlite.
 *
 * Supports both **async** and **sync** modes:
 *   - `preferSync: false` (default) — uses async APIs (runAsync, getAllAsync).
 *     Works on all platforms including web (wa-sqlite / OPFS).
 *   - `preferSync: true` — uses synchronous JSI APIs (runSync, getAllSync).
 *     Faster on native (no Promise overhead) but NOT available on web.
 *     Falls back to async automatically on web.
 *
 * Usage:
 *   import { createExpoSQLiteDriver } from 'pomegranate-db/expo';
 *   import { SQLiteAdapter } from 'pomegranate-db';
 *
 *   // Async (default — works everywhere)
 *   const driver = createExpoSQLiteDriver();
 *
 *   // Sync (native-only, falls back to async on web)
 *   const driverSync = createExpoSQLiteDriver({ preferSync: true });
 */

import type { SQLiteDriver } from '../sqlite/SQLiteAdapter';

// ─── Expo SQLite Types ────────────────────────────────────────────────────
// We define minimal types for both async and sync APIs so we don't require
// expo-sqlite as a direct dependency — it's a peer dependency.

type ExpoSQLiteDatabase = {
  // Async API (always available)
  execAsync(source: string): Promise<void>;
  runAsync(
    source: string,
    ...params: unknown[]
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T = Record<string, unknown>>(source: string, ...params: unknown[]): Promise<T[]>;
  withExclusiveTransactionAsync(task: (txn: ExpoSQLiteDatabase) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;

  // Sync API (native only — not available on web)
  execSync?(source: string): void;
  runSync?(
    source: string,
    ...params: unknown[]
  ): { lastInsertRowId: number; changes: number };
  getAllSync?<T = Record<string, unknown>>(source: string, ...params: unknown[]): T[];
  withTransactionSync?(task: () => void): void;
  closeSync?(): void;
};

type ExpoSQLiteModule = {
  openDatabaseAsync(
    databaseName: string,
    options?: { enableChangeListener?: boolean },
  ): Promise<ExpoSQLiteDatabase>;
  openDatabaseSync?(
    databaseName: string,
    options?: { enableChangeListener?: boolean },
  ): ExpoSQLiteDatabase;
};

// ─── Config ───────────────────────────────────────────────────────────────

export interface ExpoSQLiteDriverConfig {
  /**
   * Options passed to expo-sqlite's openDatabaseAsync/openDatabaseSync.
   * @default {}
   */
  openOptions?: { enableChangeListener?: boolean };

  /**
   * When true, use synchronous JSI calls (runSync, getAllSync, etc.)
   * for better performance on native platforms.
   *
   * On web (wa-sqlite), sync methods are not available — the driver
   * will automatically fall back to async mode.
   *
   * @default false
   */
  preferSync?: boolean;
}

// ─── Driver Factory ───────────────────────────────────────────────────────

/**
 * Create a SQLiteDriver backed by expo-sqlite.
 *
 * expo-sqlite must be installed in the consuming project:
 *   npx expo install expo-sqlite
 */
export function createExpoSQLiteDriver(config?: ExpoSQLiteDriverConfig): SQLiteDriver {
  let db: ExpoSQLiteDatabase | null = null;
  let expoSQLite: ExpoSQLiteModule | null = null;

  // Whether we're actually using sync mode (resolved after open)
  let useSync = false;

  // Lazily import expo-sqlite so this module can be imported
  // without expo-sqlite being installed (e.g. in tests).
  async function getExpoSQLite(): Promise<ExpoSQLiteModule> {
    if (!expoSQLite) {
      try {
        // @ts-expect-error — expo-sqlite is an optional peer dependency
        expoSQLite = (await import('expo-sqlite')) as ExpoSQLiteModule;
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
      const dbName = name.endsWith('.db') ? name : `${name}.db`;

      // Try sync open if preferred and available
      if (config?.preferSync && typeof sqlite.openDatabaseSync === 'function') {
        try {
          db = sqlite.openDatabaseSync(dbName, config?.openOptions);
          useSync = true;
        } catch {
          // openDatabaseSync not supported (e.g. web) — fall through
        }
      }

      // Async fallback (or default path)
      if (!db) {
        db = await sqlite.openDatabaseAsync(dbName, config?.openOptions);
        useSync = false;
      }

      // Enable WAL mode for better performance (may not be supported on web/wa-sqlite)
      try {
        if (useSync && db.execSync) {
          db.execSync('PRAGMA journal_mode = WAL');
        } else {
          await db.execAsync('PRAGMA journal_mode = WAL');
        }
      } catch {
        // WAL not supported on this platform (e.g. web wa-sqlite), continue without it
      }
    },

    async execute(sql: string, bindings?: unknown[]): Promise<void> {
      const database = requireDb();
      if (useSync && database.runSync) {
        if (bindings && bindings.length > 0) {
          database.runSync(sql, ...bindings);
        } else if (database.execSync) {
          database.execSync(sql);
        } else {
          database.runSync(sql);
        }
      } else {
        if (bindings && bindings.length > 0) {
          await database.runAsync(sql, ...bindings);
        } else {
          await database.execAsync(sql);
        }
      }
    },

    async query(sql: string, bindings?: unknown[]): Promise<Record<string, unknown>[]> {
      const database = requireDb();
      if (useSync && database.getAllSync) {
        if (bindings && bindings.length > 0) {
          return database.getAllSync(sql, ...bindings);
        }
        return database.getAllSync(sql);
      }
      if (bindings && bindings.length > 0) {
        return database.getAllAsync(sql, ...bindings);
      }
      return database.getAllAsync(sql);
    },

    async executeInTransaction(fn: () => Promise<void>): Promise<void> {
      const database = requireDb();

      // Sync transaction path (native only)
      if (useSync && database.withTransactionSync) {
        try {
          database.withTransactionSync(() => {
            // NOTE: fn() returns a Promise but our sync transaction
            // callback is synchronous. The inner operations will also
            // be sync (since useSync=true), so the await is a no-op.
            // We run the promise synchronously via the micro-task trick.
            let error: unknown;
            let done = false;
            fn().then(
              () => { done = true; },
              (e) => { error = e; done = true; },
            );
            // In sync mode all awaits inside fn() resolve immediately
            // (they're wrapping synchronous calls), so done should be true.
            if (!done) {
              throw new Error(
                'ExpoSQLiteDriver: async operations inside sync transaction are not supported. ' +
                  'Use preferSync: false for mixed async/sync workloads.',
              );
            }
            if (error) throw error;
          });
          return;
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes('not supported on web')) {
            // Fall through to async
          } else {
            throw e;
          }
        }
      }

      // Async transaction path
      if (typeof database.withExclusiveTransactionAsync === 'function') {
        try {
          await database.withExclusiveTransactionAsync(async (_txn) => {
            await fn();
          });
          return;
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes('not supported on web')) {
            // Fall through to manual transaction below
          } else {
            throw e;
          }
        }
      }

      // Manual transaction fallback (web, or platforms without exclusive transactions)
      if (useSync && database.execSync) {
        database.execSync('BEGIN TRANSACTION');
        try {
          await fn();
          database.execSync('COMMIT');
        } catch (e) {
          database.execSync('ROLLBACK');
          throw e;
        }
      } else {
        await database.execAsync('BEGIN TRANSACTION');
        try {
          await fn();
          await database.execAsync('COMMIT');
        } catch (e) {
          await database.execAsync('ROLLBACK');
          throw e;
        }
      }
    },

    async close(): Promise<void> {
      if (db) {
        if (useSync && db.closeSync) {
          db.closeSync();
        } else {
          await db.closeAsync();
        }
        db = null;
      }
    },

    // ── Raw sync/async for benchmarking ──────────────────────────────────

    executeSync(sql: string, bindings?: unknown[]): void {
      const database = requireDb();
      if (!database.runSync) {
        throw new Error(
          'ExpoSQLiteDriver: sync API not available (web platform). ' +
            'Set preferSync: true and run on native.',
        );
      }
      if (bindings && bindings.length > 0) {
        database.runSync(sql, ...bindings);
      } else if (database.execSync) {
        database.execSync(sql);
      } else {
        database.runSync(sql);
      }
    },

    async executeAsync(sql: string, bindings?: unknown[]): Promise<void> {
      const database = requireDb();
      if (bindings && bindings.length > 0) {
        await database.runAsync(sql, ...bindings);
      } else {
        await database.execAsync(sql);
      }
    },
  };
}
