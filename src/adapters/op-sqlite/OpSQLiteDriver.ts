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
      await database.execute(sql, bindings);
    },

    async query(sql: string, bindings?: unknown[]): Promise<Record<string, unknown>[]> {
      const database = requireDb();
      const result = await database.execute(sql, bindings);
      return result.rows;
    },

    async executeInTransaction(fn: () => Promise<void>): Promise<void> {
      const database = requireDb();
      await database.transaction(async (_tx) => {
        // op-sqlite's transaction scopes all operations on the
        // connection to the transaction, similar to expo-sqlite.
        await fn();
      });
    },

    async close(): Promise<void> {
      if (db) {
        db.updateHook(null); // Remove hook before closing
        db.close();
        db = null;
      }
    },
  };
}
