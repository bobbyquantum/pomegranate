/**
 * Expo SQLite Driver test suite.
 *
 * Tests the ExpoSQLiteDriver with a mocked expo-sqlite module,
 * verifying the driver initialization, SQL execution, queries,
 * transactions, and close lifecycle.
 *
 * This validates that PomegranateDB's Expo SQLite integration works
 * in web-like environments (jsdom) — the same path expo-sqlite uses
 * when running on web (via wa-sqlite WASM).
 *
 * @jest-environment jsdom
 */

import { createExpoSQLiteDriver } from '../adapters/expo-sqlite/ExpoSQLiteDriver';
import type { SQLiteDriver } from '../adapters/sqlite/SQLiteAdapter';

// ─── Mock expo-sqlite ──────────────────────────────────────────────────────

/** In-memory mock of expo-sqlite's database API */
function createMockDatabase() {
  const tables = new Map<string, Record<string, unknown>[]>();
  let inTransaction = false;

  return {
    _tables: tables,
    _inTransaction: () => inTransaction,

    async execAsync(sql: string): Promise<void> {
      // Parse simple CREATE TABLE / PRAGMA
      const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS "?(\w+)"?/i);
      if (createMatch) {
        const tableName = createMatch[1];
        if (!tables.has(tableName)) {
          tables.set(tableName, []);
        }
      }
    },

    async runAsync(
      sql: string,
      ...args: unknown[]
    ): Promise<{ changes: number; lastInsertRowId: number }> {
      const insertMatch = sql.match(/INSERT INTO "?(\w+)"?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (insertMatch) {
        const tableName = insertMatch[1];
        const columns = insertMatch[2].split(',').map((c) => c.trim().replaceAll('"', ''));
        const rows = tables.get(tableName) || [];
        const record: Record<string, unknown> = {};
        columns.forEach((col, i) => {
          record[col] = args[i] ?? null;
        });
        rows.push(record);
        tables.set(tableName, rows);
        return { changes: 1, lastInsertRowId: rows.length };
      }

      const deleteMatch = sql.match(/DELETE FROM "?(\w+)"?/i);
      if (deleteMatch) {
        const tableName = deleteMatch[1];
        const rows = tables.get(tableName) || [];
        const count = rows.length;
        tables.set(tableName, []);
        return { changes: count, lastInsertRowId: 0 };
      }

      return { changes: 0, lastInsertRowId: 0 };
    },

    async getAllAsync(sql: string, ...args: unknown[]): Promise<Record<string, unknown>[]> {
      const selectMatch = sql.match(/SELECT .+ FROM "?(\w+)"?/i);
      if (selectMatch) {
        const tableName = selectMatch[1];
        return tables.get(tableName) || [];
      }
      return [];
    },

    async withExclusiveTransactionAsync(fn: (txn: unknown) => Promise<void>): Promise<void> {
      inTransaction = true;
      try {
        await fn(this);
      } finally {
        inTransaction = false;
      }
    },

    async closeAsync(): Promise<void> {
      tables.clear();
    },
  };
}

// Register mock before importing driver
let mockDb: ReturnType<typeof createMockDatabase>;

jest.mock(
  'expo-sqlite',
  () => ({
    openDatabaseAsync: jest.fn(async (_name: string, _options?: unknown) => {
      mockDb = createMockDatabase();
      return mockDb;
    }),
  }),
  { virtual: true },
);

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Expo SQLite Driver', () => {
  let driver: SQLiteDriver;

  beforeEach(async () => {
    driver = createExpoSQLiteDriver();
  });

  afterEach(async () => {
    try {
      await driver.close();
    } catch {
      // ignore if already closed
    }
  });

  // ─── Lifecycle ───────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('opens a database', async () => {
      await driver.open('expo-web-test');
      const expoSQLite = require('expo-sqlite');
      expect(expoSQLite.openDatabaseAsync).toHaveBeenCalledWith('expo-web-test.db', undefined);
    });

    it('appends .db extension if not present', async () => {
      await driver.open('myapp');
      const expoSQLite = require('expo-sqlite');
      expect(expoSQLite.openDatabaseAsync).toHaveBeenCalledWith('myapp.db', undefined);
    });

    it('does not double-append .db extension', async () => {
      await driver.open('myapp.db');
      const expoSQLite = require('expo-sqlite');
      expect(expoSQLite.openDatabaseAsync).toHaveBeenCalledWith('myapp.db', undefined);
    });

    it('closes a database', async () => {
      await driver.open('close-test');
      await driver.close();
      // Calling close again should not throw
      await driver.close();
    });

    it('throws when executing before open', async () => {
      await expect(driver.execute('SELECT 1')).rejects.toThrow('not open');
    });

    it('throws when querying before open', async () => {
      await expect(driver.query('SELECT 1')).rejects.toThrow('not open');
    });
  });

  // ─── SQL Execution ──────────────────────────────────────────────────

  describe('execute', () => {
    beforeEach(async () => {
      await driver.open('exec-test');
    });

    it('executes CREATE TABLE', async () => {
      await driver.execute('CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, title TEXT)');
      expect(mockDb._tables.has('posts')).toBe(true);
    });

    it('executes INSERT with bindings', async () => {
      await driver.execute('CREATE TABLE IF NOT EXISTS posts (id TEXT, title TEXT)');
      await driver.execute('INSERT INTO posts (id, title) VALUES (?, ?)', ['1', 'Hello']);
      const rows = mockDb._tables.get('posts')!;
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Hello');
    });

    it('executes PRAGMA without bindings', async () => {
      // Should not throw
      await driver.execute('PRAGMA journal_mode = WAL');
    });
  });

  // ─── Queries ────────────────────────────────────────────────────────

  describe('query', () => {
    beforeEach(async () => {
      await driver.open('query-test');
      await driver.execute('CREATE TABLE IF NOT EXISTS items (id TEXT, name TEXT, value INTEGER)');
    });

    it('returns empty array for empty table', async () => {
      const results = await driver.query('SELECT * FROM items');
      expect(results).toEqual([]);
    });

    it('returns inserted rows', async () => {
      await driver.execute('INSERT INTO items (id, name, value) VALUES (?, ?, ?)', [
        '1',
        'alpha',
        10,
      ]);
      await driver.execute('INSERT INTO items (id, name, value) VALUES (?, ?, ?)', [
        '2',
        'beta',
        20,
      ]);

      const results = await driver.query('SELECT * FROM items');
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('alpha');
      expect(results[1].value).toBe(20);
    });

    it('passes bindings to query', async () => {
      await driver.execute('INSERT INTO items (id, name, value) VALUES (?, ?, ?)', [
        '1',
        'alpha',
        10,
      ]);
      // Our mock doesn't actually filter, but verify the call doesn't throw
      const results = await driver.query('SELECT * FROM items WHERE id = ?', ['1']);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ─── Transactions ──────────────────────────────────────────────────

  describe('executeInTransaction', () => {
    beforeEach(async () => {
      await driver.open('txn-test');
      await driver.execute('CREATE TABLE IF NOT EXISTS logs (id TEXT, msg TEXT)');
    });

    it('executes multiple operations in a transaction', async () => {
      await driver.executeInTransaction(async () => {
        await driver.execute('INSERT INTO logs (id, msg) VALUES (?, ?)', ['1', 'first']);
        await driver.execute('INSERT INTO logs (id, msg) VALUES (?, ?)', ['2', 'second']);
      });

      const results = await driver.query('SELECT * FROM logs');
      expect(results).toHaveLength(2);
    });

    it('completes transaction scope', async () => {
      let wasInTransaction = false;

      await driver.executeInTransaction(async () => {
        wasInTransaction = mockDb._inTransaction();
        await driver.execute('INSERT INTO logs (id, msg) VALUES (?, ?)', ['1', 'test']);
      });

      expect(wasInTransaction).toBe(true);
      expect(mockDb._inTransaction()).toBe(false);
    });
  });

  // ─── Configuration ─────────────────────────────────────────────────

  describe('configuration', () => {
    it('passes openOptions to expo-sqlite', async () => {
      const customDriver = createExpoSQLiteDriver({
        openOptions: { enableChangeListener: true },
      });
      await customDriver.open('config-test');

      const expoSQLite = require('expo-sqlite');
      expect(expoSQLite.openDatabaseAsync).toHaveBeenCalledWith('config-test.db', {
        enableChangeListener: true,
      });

      await customDriver.close();
    });

    it('works with no config', async () => {
      const defaultDriver = createExpoSQLiteDriver();
      await defaultDriver.open('no-config');
      await defaultDriver.close();
    });
  });

  // ─── Integration with SQLiteAdapter ─────────────────────────────────

  describe('integration with Database', () => {
    it('can be used to create a full Database stack', async () => {
      // We import here to avoid circular issues
      const { Database } = require('../database/Database');
      const { SQLiteAdapter } = require('../adapters/sqlite/SQLiteAdapter');
      const { m } = require('../schema/builder');
      const { Model } = require('../model/Model');

      const NoteSchema = m.model('notes', {
        title: m.text(),
        body: m.text().default(''),
      });

      class Note extends Model<typeof NoteSchema> {
        static schema = NoteSchema;
      }

      const expoDriver = createExpoSQLiteDriver();
      const adapter = new SQLiteAdapter({
        databaseName: 'integration-test',
        driver: expoDriver,
      });

      const db = new Database({
        adapter,
        models: [Note],
      });

      await db.initialize();

      // Create a record
      await db.write(async () => {
        await db.collection('notes').create({ title: 'Test Note', body: 'Hello from Expo' });
      });

      // Query it back
      const collection = db.collection('notes');
      const qb = collection.query();
      const notes = await collection.fetch(qb);
      expect(notes).toHaveLength(1);
      expect(notes[0].getField('title')).toBe('Test Note');

      await db.close();
    });
  });
});
