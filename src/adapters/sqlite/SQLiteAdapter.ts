/**
 * SQLite Adapter.
 *
 * Implements the StorageAdapter interface using a SQL driver.
 * The actual SQLite driver is injected — this adapter generates SQL
 * and delegates execution, enabling different drivers for
 * React Native (react-native-sqlite-storage) and web (sql.js).
 *
 * The driver interface is intentionally minimal so it can wrap
 * any SQLite library.
 */

import type { StorageAdapter, AdapterConfig, EncryptionConfig, Migration } from '../types';
import type { QueryDescriptor, SearchDescriptor, BatchOperation } from '../../query/types';
import type { DatabaseSchema, RawRecord } from '../../schema/types';
import {
  createTableSQL,
  selectSQL,
  countSQL,
  searchSQL,
  insertSQL,
  updateSQL,
  deleteSQL,
} from './sql';

// ─── SQLite Driver Interface ──────────────────────────────────────────────

/**
 * Minimal driver interface that wraps any SQLite library.
 *
 * Implementations:
 *  - For React Native: wrap react-native-quick-sqlite or op-sqlite
 *  - For Web: wrap sql.js
 *  - For Node tests: wrap better-sqlite3
 */
export interface SQLiteDriver {
  open(name: string): Promise<void>;
  execute(sql: string, bindings?: unknown[]): Promise<void>;
  query(sql: string, bindings?: unknown[]): Promise<Record<string, unknown>[]>;
  executeInTransaction(fn: () => Promise<void>): Promise<void>;
  close(): Promise<void>;

  /**
   * Optional: direct synchronous execute, bypassing the async Promise wrapping.
   * Available on drivers that support JSI sync calls (op-sqlite, native-sqlite,
   * expo-sqlite in preferSync mode). Used by benchmarks for apples-to-apples
   * sync-vs-async comparisons.
   */
  executeSync?(sql: string, bindings?: unknown[]): void;

  /**
   * Optional: explicitly async execute, always going through the async path
   * even when the driver is configured for sync mode.
   * Used by benchmarks to measure async overhead.
   */
  executeAsync?(sql: string, bindings?: unknown[]): Promise<void>;

  /**
   * Optional: execute multiple statements in a single native call.
   * When provided, SQLiteAdapter.batch() will prefer this over
   * looping individual execute() calls inside a transaction.
   *
   * Each command is a [sql, bindings] tuple. The driver should
   * execute them atomically (in a single transaction).
   */
  executeBatch?(commands: Array<[string, unknown[]]>): Promise<void>;

  /**
   * Optional: like executeBatch but without wrapping in a transaction.
   * Used when the adapter has already opened a transaction (BEGIN IMMEDIATE)
   * and we want to run many commands in a single native call without nesting.
   *
   * If not provided, the adapter falls back to looping individual execute()
   * calls (still fast for sync drivers, but slow for async-only drivers).
   */
  executeBatchNoTx?(commands: Array<[string, unknown[]]>): Promise<void>;
}

// ─── SQLite Adapter Config ────────────────────────────────────────────────

export interface SQLiteAdapterConfig extends AdapterConfig {
  /** The SQLite driver to use. If not provided, a default will be selected. */
  driver?: SQLiteDriver;
  /** Optional encryption config */
  encryption?: EncryptionConfig;
}

// ─── SQLite Adapter ───────────────────────────────────────────────────────

export class SQLiteAdapter implements StorageAdapter {
  private _driver: SQLiteDriver;
  private _databaseName: string;
  private _encryption?: EncryptionConfig;
  private _initialized = false;
  private _inWriteTransaction = false;

  constructor(config: SQLiteAdapterConfig) {
    this._databaseName = config.databaseName;
    this._encryption = config.encryption;

    if (config.driver) {
      this._driver = config.driver;
    } else {
      // Use a no-op driver that throws — user must provide one
      this._driver = createStubDriver();
    }
  }

  // ─── Initialize ──────────────────────────────────────────────────────

  async initialize(schema: DatabaseSchema): Promise<void> {
    if (this._initialized) return;

    await this._driver.open(this._databaseName);

    // Create metadata table
    await this._driver.execute(
      `CREATE TABLE IF NOT EXISTS "__pomegranate_metadata" (
        "key" TEXT PRIMARY KEY NOT NULL,
        "value" TEXT
      )`,
    );

    // Check existing version
    const rows = await this._driver.query(
      'SELECT "value" FROM "__pomegranate_metadata" WHERE "key" = \'schema_version\'',
    );

    const existingVersion = rows.length > 0 ? Number.parseInt(rows[0].value as string, 10) : 0;

    if (existingVersion === 0) {
      // Fresh install — create all tables
      for (const table of schema.tables) {
        const sql = createTableSQL(table);
        // Split multi-statement SQL
        for (const stmt of sql.split(';\n')) {
          const trimmed = stmt.trim().replace(/;$/, '');
          if (trimmed) {
            await this._driver.execute(trimmed);
          }
        }
      }

      // Store version
      await this._driver.execute(
        'INSERT OR REPLACE INTO "__pomegranate_metadata" ("key", "value") VALUES (\'schema_version\', ?)',
        [String(schema.version)],
      );
    }

    this._initialized = true;
  }

  // ─── Query ──────────────────────────────────────────────────────────

  async find(query: QueryDescriptor): Promise<RawRecord[]> {
    const { sql, bindings } = selectSQL(query);
    const rows = await this._driver.query(sql, bindings);
    return rows as RawRecord[];
  }

  async count(query: QueryDescriptor): Promise<number> {
    const { sql, bindings } = countSQL(query);
    const rows = await this._driver.query(sql, bindings);
    return (rows[0] as Record<string, unknown>)?.count as number ?? 0;
  }

  async findById(table: string, id: string): Promise<RawRecord | null> {
    const rows = await this._driver.query(`SELECT * FROM "${table}" WHERE "id" = ?`, [id]);
    return (rows[0] as RawRecord) ?? null;
  }

  // ─── Insert / Update / Delete ────────────────────────────────────────

  async insert(table: string, raw: RawRecord): Promise<void> {
    const { sql, bindings } = insertSQL(table, raw);
    await this._driver.execute(sql, bindings);
  }

  async update(table: string, raw: RawRecord): Promise<void> {
    const { sql, bindings } = updateSQL(table, raw);
    await this._driver.execute(sql, bindings);
  }

  async markAsDeleted(table: string, id: string): Promise<void> {
    await this._driver.execute(`UPDATE "${table}" SET "_status" = 'deleted' WHERE "id" = ?`, [id]);
  }

  async destroyPermanently(table: string, id: string): Promise<void> {
    const { sql, bindings } = deleteSQL(table, id);
    await this._driver.execute(sql, bindings);
  }

  // ─── Write Transaction ──────────────────────────────────────────────

  async writeTransaction(fn: () => Promise<void>): Promise<void> {
    if (this._inWriteTransaction) {
      // Already inside a transaction — just run the function directly
      await fn();
      return;
    }
    this._inWriteTransaction = true;
    try {
      // Use manual BEGIN/COMMIT instead of driver.executeInTransaction()
      // because the inner fn() goes through async adapter methods (insert,
      // update, etc.) which use `await`. Even when the driver is in sync
      // mode, `await` yields to the microtask queue, so the sync
      // transaction wrappers (withTransactionSync) can't work.
      //
      // Manual BEGIN/COMMIT is safe because all execute() calls on the
      // same connection will be inside this transaction until COMMIT.
      await this._driver.execute('BEGIN IMMEDIATE');
      try {
        await fn();
        await this._driver.execute('COMMIT');
      } catch (error) {
        try {
          await this._driver.execute('ROLLBACK');
        } catch {
          // Rollback failed — connection may be in a bad state, but
          // we still want to surface the original error.
        }
        throw error;
      }
    } finally {
      this._inWriteTransaction = false;
    }
  }

  // ─── Batch ──────────────────────────────────────────────────────────

  async batch(operations: BatchOperation[]): Promise<void> {
    // Build the list of [sql, bindings] tuples for all operations
    const commands: Array<[string, unknown[]]> = [];
    for (const op of operations) {
      switch (op.type) {
        case 'create': {
          const { sql, bindings } = insertSQL(op.table, op.rawRecord!);
          commands.push([sql, bindings]);
          break;
        }
        case 'update': {
          const { sql, bindings } = updateSQL(op.table, op.rawRecord!);
          commands.push([sql, bindings]);
          break;
        }
        case 'delete':
          commands.push([
            `UPDATE "${op.table}" SET "_status" = 'deleted' WHERE "id" = ?`,
            [op.id!],
          ]);
          break;
        case 'destroyPermanently': {
          const { sql, bindings } = deleteSQL(op.table, op.id!);
          commands.push([sql, bindings]);
          break;
        }
      }
    }

    // When already inside a writeTransaction (BEGIN IMMEDIATE), we must
    // NOT use the driver's executeBatch — it wraps commands in its own
    // transaction internally, and SQLite doesn't support nested transactions.
    // That causes a deadlock / hang (the CI benchmark hang).
    if (this._inWriteTransaction) {
      if (this._driver.executeBatchNoTx) {
        // Best path: single native call, no transaction wrapper.
        // Critical for async drivers (expo-sqlite) where per-call overhead
        // is high (~2ms). Turns 10K bridge crossings into 1.
        await this._driver.executeBatchNoTx(commands);
      } else {
        // Sync drivers (op-sqlite, native-sqlite) are fast enough per-call
        // that looping is acceptable (~0.02ms each).
        for (const [sql, bindings] of commands) {
          await this._driver.execute(sql, bindings);
        }
      }
    } else if (this._driver.executeBatch) {
      // Prefer the driver's native batch if available (single JSI call,
      // single transaction — avoids per-statement round-trips).
      await this._driver.executeBatch(commands);
    } else {
      // Fallback: loop individual execute() calls inside a transaction
      await this._driver.executeInTransaction(async () => {
        for (const [sql, bindings] of commands) {
          await this._driver.execute(sql, bindings);
        }
      });
    }
  }

  // ─── Search ──────────────────────────────────────────────────────────

  async search(descriptor: SearchDescriptor): Promise<{ records: RawRecord[]; total: number }> {
    const { sql, countSql, bindings, countBindings } = searchSQL(descriptor);
    const [rows, countRows] = await Promise.all([
      this._driver.query(sql, bindings),
      this._driver.query(countSql, countBindings),
    ]);

    return {
      records: rows as RawRecord[],
      total: (countRows[0] as Record<string, unknown>)?.count as number ?? 0,
    };
  }

  // ─── Sync helpers ──────────────────────────────────────────────────

  async getLocalChanges(
    tables: string[],
  ): Promise<Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>> {
    const result: Record<
      string,
      { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }
    > = {};

    for (const table of tables) {
      const created = await this._driver.query(
        `SELECT * FROM "${table}" WHERE "_status" = 'created'`,
      );
      const updated = await this._driver.query(
        `SELECT * FROM "${table}" WHERE "_status" = 'updated'`,
      );
      const deletedRows = await this._driver.query(
        `SELECT "id" FROM "${table}" WHERE "_status" = 'deleted'`,
      );

      result[table] = {
        created: created as RawRecord[],
        updated: updated as RawRecord[],
        deleted: deletedRows.map((r) => r.id as string),
      };
    }

    return result;
  }

  async applyRemoteChanges(
    changes: Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>,
  ): Promise<void> {
    await this._driver.executeInTransaction(async () => {
      for (const [table, tableChanges] of Object.entries(changes)) {
        // Apply created records
        for (const raw of tableChanges.created) {
          const record = { ...raw, _status: 'synced', _changed: '' };
          // Use INSERT OR REPLACE in case the record already exists locally
          const { sql, bindings } = insertSQL(table, record);
          const replaceSql = sql.replace('INSERT INTO', 'INSERT OR REPLACE INTO');
          await this._driver.execute(replaceSql, bindings);
        }

        // Apply updated records
        for (const raw of tableChanges.updated) {
          const record = { ...raw, _status: 'synced', _changed: '' };
          // Check if record exists
          const existing = await this._driver.query(
            `SELECT "_status" FROM "${table}" WHERE "id" = ?`,
            [raw.id],
          );

          if (existing.length > 0) {
            const { sql, bindings } = updateSQL(table, record);
            await this._driver.execute(sql, bindings);
          } else {
            const { sql, bindings } = insertSQL(table, record);
            await this._driver.execute(sql, bindings);
          }
        }

        // Apply deletions
        for (const id of tableChanges.deleted) {
          await this._driver.execute(`DELETE FROM "${table}" WHERE "id" = ?`, [id]);
        }
      }
    });
  }

  async markAsSynced(table: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    await this._driver.execute(
      `UPDATE "${table}" SET "_status" = 'synced', "_changed" = '' WHERE "id" IN (${placeholders})`,
      ids,
    );
  }

  // ─── Schema version ──────────────────────────────────────────────────

  async getSchemaVersion(): Promise<number> {
    try {
      const rows = await this._driver.query(
        'SELECT "value" FROM "__pomegranate_metadata" WHERE "key" = \'schema_version\'',
      );
      return rows.length > 0 ? Number.parseInt(rows[0].value as string, 10) : 0;
    } catch {
      return 0;
    }
  }

  // ─── Migration ──────────────────────────────────────────────────────

  async migrate(migrations: Migration[]): Promise<void> {
    const currentVersion = await this.getSchemaVersion();

    const applicable = migrations
      .filter((m) => m.fromVersion >= currentVersion)
      .toSorted((a, b) => a.fromVersion - b.fromVersion);

    await this._driver.executeInTransaction(async () => {
      for (const migration of applicable) {
        for (const step of migration.steps) {
          switch (step.type) {
            case 'createTable': {
              const sql = createTableSQL(step.schema);
              for (const stmt of sql.split(';\n')) {
                const trimmed = stmt.trim().replace(/;$/, '');
                if (trimmed) await this._driver.execute(trimmed);
              }
              break;
            }
            case 'addColumn':
              await this._driver.execute(
                `ALTER TABLE "${step.table}" ADD COLUMN "${step.column}" ${step.columnType}${step.isOptional ? '' : ' NOT NULL DEFAULT ""'}`,
              );
              break;
            case 'destroyTable':
              await this._driver.execute(`DROP TABLE IF EXISTS "${step.table}"`);
              break;
            case 'sql':
              await this._driver.execute(step.query);
              break;
          }
        }

        await this._driver.execute(
          'INSERT OR REPLACE INTO "__pomegranate_metadata" ("key", "value") VALUES (\'schema_version\', ?)',
          [String(migration.toVersion)],
        );
      }
    });
  }

  // ─── Reset ──────────────────────────────────────────────────────────

  async reset(): Promise<void> {
    // Get all user tables
    const tables = await this._driver.query(
      'SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'',
    );

    await this._driver.executeInTransaction(async () => {
      for (const t of tables) {
        await this._driver.execute(`DROP TABLE IF EXISTS "${t.name}"`);
      }
    });

    this._initialized = false;
  }

  // ─── Close ──────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this._driver.close();
  }
}

// ─── Stub Driver ──────────────────────────────────────────────────────────

function notConfigured(): never {
  throw new Error(
    'No SQLite driver configured. Provide a driver in SQLiteAdapterConfig.driver, ' +
      'or use LokiAdapter for in-memory/web use.',
  );
}

function createStubDriver(): SQLiteDriver {
  return {
    open: async () => notConfigured(),
    execute: async () => notConfigured(),
    query: async () => {
      notConfigured();
      return [];
    },
    executeInTransaction: async () => notConfigured(),
    close: async () => {},
  };
}
