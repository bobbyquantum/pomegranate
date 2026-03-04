/**
 * op-sqlite Driver.
 *
 * Implements the SQLiteDriver interface using @op-engineering/op-sqlite.
 * Provides JSI-based synchronous SQLite access for React Native apps
 * — the fastest SQLite option for bare RN projects.
 *
 * Features:
 *   - JSI synchronous execution (no bridge overhead)
 *   - SQLCipher encryption support (via encryptionKey)
 *   - Prepared statement support
 *   - Batch execution in transactions
 *   - Update hooks for reactive queries
 *
 * Usage:
 *   import { SQLiteAdapter } from 'pomegranate-db';
 *   import { createOpSQLiteDriver } from 'pomegranate-db/src/adapters/op-sqlite';
 *
 *   const adapter = new SQLiteAdapter({
 *     databaseName: 'myapp',
 *     driver: createOpSQLiteDriver({ encryptionKey: 'secret' }),
 *   });
 */

import type { SQLiteDriver } from '../sqlite/SQLiteAdapter';

// ─── op-sqlite Types ──────────────────────────────────────────────────────

// Minimal type definitions so we don't require @op-engineering/op-sqlite
// as a direct dependency — it's a peer dependency of the consumer's app.

interface OpSQLiteQueryResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
  insertId?: number;
}

interface OpSQLiteTransaction {
  execute(sql: string, args?: unknown[]): Promise<OpSQLiteQueryResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface OpSQLiteDatabase {
  execute(sql: string, args?: unknown[]): Promise<OpSQLiteQueryResult>;
  executeSync(sql: string, args?: unknown[]): OpSQLiteQueryResult;
  executeBatch(commands: [string, unknown[]?][]): Promise<{ rowsAffected: number }>;
  transaction(fn: (tx: OpSQLiteTransaction) => Promise<void>): Promise<void>;
  close(): void;
  getDbPath(): string;
  updateHook(
    callback: ((event: { rowId: number; table: string; operation: string }) => void) | null,
  ): void;
}

interface OpSQLiteOpenOptions {
  name: string;
  location?: string;
  encryptionKey?: string;
}

interface OpSQLiteModule {
  open(options: OpSQLiteOpenOptions): OpSQLiteDatabase;
}

// ─── Driver Config ────────────────────────────────────────────────────────

export interface OpSQLiteDriverConfig {
  /**
   * SQLCipher encryption key.
   * If provided, the database will be encrypted at rest.
   * Requires op-sqlite to be compiled with SQLCipher support.
   */
  encryptionKey?: string;

  /**
   * Custom storage location for the database file.
   * If not specified, uses the app's default database directory.
   */
  location?: string;

  /**
   * Optional callback invoked on every database write.
   * Useful for driving reactive queries / cache invalidation.
   */
  onTableChanged?: (table: string, operation: 'INSERT' | 'UPDATE' | 'DELETE') => void;

  /**
   * When true (default), use synchronous JSI calls (executeSync)
   * for maximum performance — same approach as WatermelonDB.
   *
   * When false, use the async execute() API which dispatches to
   * a worker thread. Slightly slower per-operation but doesn't
   * block the JS thread during execution.
   *
   * @default true
   */
  preferSync?: boolean;
}

// ─── Driver Factory ───────────────────────────────────────────────────────

/**
 * Create a SQLiteDriver backed by @op-engineering/op-sqlite.
 *
 * @param config Optional driver configuration (encryption, hooks, etc.)
 * @returns A SQLiteDriver that can be passed to SQLiteAdapter.
 */
export function createOpSQLiteDriver(config?: OpSQLiteDriverConfig): SQLiteDriver {
  let db: OpSQLiteDatabase | null = null;
  let opSQLite: OpSQLiteModule | null = null;
  const useSync = config?.preferSync !== false; // default: true

  async function getOpSQLite(): Promise<OpSQLiteModule> {
    if (!opSQLite) {
      try {
        // @ts-expect-error — @op-engineering/op-sqlite is an optional peer dependency
        opSQLite = (await import('@op-engineering/op-sqlite')) as unknown as OpSQLiteModule;
      } catch {
        throw new Error(
          '@op-engineering/op-sqlite is not installed. Install it with:\n' +
            '  npm install @op-engineering/op-sqlite\n' +
            'Then rebuild your native app.',
        );
      }
    }
    return opSQLite;
  }

  function requireDb(): OpSQLiteDatabase {
    if (!db) {
      throw new Error('Database not open. Call open() first.');
    }
    return db;
  }

  return {
    async open(name: string): Promise<void> {
      const sqlite = await getOpSQLite();
      const dbName = name.endsWith('.db') ? name : `${name}.db`;

      const openOptions: OpSQLiteOpenOptions = { name: dbName };
      if (config?.location) {
        openOptions.location = config.location;
      }
      if (config?.encryptionKey) {
        openOptions.encryptionKey = config.encryptionKey;
      }

      db = sqlite.open(openOptions);

      // Enable WAL mode for better concurrent read performance
      db.executeSync('PRAGMA journal_mode = WAL');
      // Busy timeout for concurrent access
      db.executeSync('PRAGMA busy_timeout = 5000');

      // Install update hook if requested
      if (config?.onTableChanged) {
        const callback = config.onTableChanged;
        db.updateHook(({ table, operation }) => {
          callback(table, operation as 'INSERT' | 'UPDATE' | 'DELETE');
        });
      }
    },

    async execute(sql: string, bindings?: unknown[]): Promise<void> {
      const database = requireDb();
      if (useSync) {
        database.executeSync(sql, bindings ?? []);
      } else {
        await database.execute(sql, bindings);
      }
    },

    async query(sql: string, bindings?: unknown[]): Promise<Record<string, unknown>[]> {
      const database = requireDb();
      if (useSync) {
        const result = database.executeSync(sql, bindings ?? []);
        return result.rows;
      }
      const result = await database.execute(sql, bindings);
      return result.rows;
    },

    async executeInTransaction(fn: () => Promise<void>): Promise<void> {
      const database = requireDb();
      if (useSync) {
        // Manual sync transaction — avoids async round-trips
        database.executeSync('BEGIN EXCLUSIVE TRANSACTION');
        try {
          await fn();
          database.executeSync('COMMIT');
        } catch (error) {
          database.executeSync('ROLLBACK');
          throw error;
        }
      } else {
        // Async transaction via op-sqlite's transaction() wrapper
        await database.transaction(async (_tx) => {
          await fn();
        });
      }
    },

    async executeBatch(commands: Array<[string, unknown[]]>): Promise<void> {
      const database = requireDb();
      // op-sqlite's executeBatch sends all commands to C++ in a single
      // JSI call and runs them in one transaction — no per-statement
      // round-trips between JS and native.
      await database.executeBatch(
        commands.map(([sql, bindings]) => [sql, bindings] as [string, unknown[]]),
      );
    },

    async close(): Promise<void> {
      if (db) {
        db.updateHook(null); // Remove hook before closing
        db.close();
        db = null;
      }
    },

    // ── Raw sync/async for benchmarking ──────────────────────────────────

    executeSync(sql: string, bindings?: unknown[]): void {
      const database = requireDb();
      database.executeSync(sql, bindings ?? []);
    },

    async executeAsync(sql: string, bindings?: unknown[]): Promise<void> {
      const database = requireDb();
      await database.execute(sql, bindings);
    },
  };
}
