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
import type { TurboSyncResult, TurboSyncSource } from '../../sync/types';
import { applySyncJsonInJs, tableColumnsFromSchema } from '../applySyncJsonFallback';
import { remoteValuesToApply } from '../remoteMerge';
import { logger } from '../../utils';
import {
  createTableSQL,
  addColumnSQL,
  legacyAddColumnSQL,
  selectSQL,
  countSQL,
  searchSQL,
  insertSQL,
  updateSQL,
  deleteSQL,
} from './sql';

/** Max ids per `IN (...)` list when looking up local sync state. */
const SYNC_STATE_CHUNK = 500;

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

  /**
   * Optional: turbo sync — parse and import a whole pull payload natively.
   *
   * `tableColumns` is { table: [column, …] }; the driver must ignore tables
   * and drop columns that are not listed. Rows are written with
   * INSERT OR REPLACE as `_status = 'synced'`, deletions with DELETE, all in
   * one transaction. Provided by `pomegranate-db/native-sqlite`.
   */
  applySyncJson?(source: TurboSyncSource, tableColumns: Record<string, string[]>): Promise<TurboSyncResult>;
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
  private _opened = false;
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

    // `reset()` drops the tables but keeps the connection; only open once.
    if (!this._opened) {
      await this._driver.open(this._databaseName);
      this._opened = true;
    }

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
        // `created` and `updated` are handled identically: what matters is the
        // local row's sync state, looked up once per table in id chunks.
        const incoming = [...tableChanges.created, ...tableChanges.updated];
        const local = await this._loadSyncStates(
          table,
          incoming.map((r) => r.id),
        );

        for (const raw of incoming) {
          const state = local.get(raw.id);

          if (!state) {
            const { sql, bindings } = insertSQL(table, { ...raw, _status: 'synced', _changed: '' });
            await this._driver.execute(sql, bindings);
            local.set(raw.id, { status: 'synced', changed: '' });
            continue;
          }

          if (state.status === 'deleted') {
            // Locally deleted — the delete wins and will be pushed.
            continue;
          }

          if (state.status === 'synced') {
            const { sql, bindings } = updateSQL(table, { ...raw, _status: 'synced', _changed: '' });
            await this._driver.execute(sql, bindings);
            continue;
          }

          // Locally 'updated' (or 'created' — an id collision, treated the same).
          if (state.status === 'created') {
            logger.warn(
              `Sync: remote record "${table}/${raw.id}" collides with a locally created record; ` +
                'merging and keeping the local changes.',
            );
          }
          const toApply = remoteValuesToApply(raw, state.changed);
          if (Object.keys(toApply).length > 1) {
            const { sql, bindings } = updateSQL(table, toApply);
            await this._driver.execute(sql, bindings);
          }
        }

        for (const id of tableChanges.deleted) {
          await this._driver.execute(`DELETE FROM "${table}" WHERE "id" = ?`, [id]);
        }
      }
    });
  }

  /** `id → { _status, _changed }` for the given ids, fetched in chunks of ≤ 500. */
  private async _loadSyncStates(
    table: string,
    ids: string[],
  ): Promise<Map<string, { status: string; changed: string }>> {
    const states = new Map<string, { status: string; changed: string }>();
    const unique = Array.from(new Set(ids));
    for (let i = 0; i < unique.length; i += SYNC_STATE_CHUNK) {
      const chunk = unique.slice(i, i + SYNC_STATE_CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = await this._driver.query(
        `SELECT "id", "_status", "_changed" FROM "${table}" WHERE "id" IN (${placeholders})`,
        chunk,
      );
      for (const row of rows) {
        states.set(String(row.id), {
          status: String(row._status),
          changed: typeof row._changed === 'string' ? row._changed : '',
        });
      }
    }
    return states;
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

  // ─── Metadata ───────────────────────────────────────────────────────

  async getMetadata(key: string): Promise<string | null> {
    const rows = await this._driver.query(
      'SELECT "value" FROM "__pomegranate_metadata" WHERE "key" = ?',
      [key],
    );
    return rows.length > 0 && rows[0].value != null ? String(rows[0].value) : null;
  }

  async setMetadata(key: string, value: string): Promise<void> {
    await this._driver.execute(
      'INSERT OR REPLACE INTO "__pomegranate_metadata" ("key", "value") VALUES (?, ?)',
      [key, value],
    );
  }

  // ─── Turbo sync ─────────────────────────────────────────────────────

  async applySyncJson(source: TurboSyncSource, schema: DatabaseSchema): Promise<TurboSyncResult> {
    if (this._driver.applySyncJson) {
      return this._driver.applySyncJson(source, tableColumnsFromSchema(schema));
    }
    return applySyncJsonInJs(this, source, schema);
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
                legacyAddColumnSQL(
                  step.table,
                  step.column,
                  step.columnType,
                  step.isOptional ?? false,
                ),
              );
              break;
            case 'addColumns':
              for (const column of step.columns) {
                await this._driver.execute(addColumnSQL(step.table, column));
                if (column.isIndexed) {
                  const indexName = `${step.table}_${column.name}`;
                  await this._driver.execute(
                    `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${step.table}" ("${column.name}")`,
                  );
                }
              }
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

    const dropAll = async () => {
      for (const t of tables) {
        await this._driver.execute(`DROP TABLE IF EXISTS "${t.name}"`);
      }
    };

    // Inside `writeTransaction` a nested BEGIN would fail — join it instead.
    if (this._inWriteTransaction) {
      await dropAll();
    } else {
      await this._driver.executeInTransaction(dropAll);
    }

    this._initialized = false;
  }

  // ─── Close ──────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this._driver.close();
    this._opened = false;
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
