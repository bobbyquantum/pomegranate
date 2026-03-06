/**
 * OpSQLiteDriver unit tests.
 *
 * @op-engineering/op-sqlite is mocked throughout, so these run in
 * Node/Jest with no device or native build required.
 */

import { createOpSQLiteDriver } from '../OpSQLiteDriver';

// ─── Mock factory ─────────────────────────────────────────────────────────

function makeMockDb(
  overrides: Partial<{
    execute: jest.Mock;
    executeSync: jest.Mock;
    executeBatch: jest.Mock;
    transaction: jest.Mock;
    close: jest.Mock;
    getDbPath: jest.Mock;
    updateHook: jest.Mock;
  }> = {},
) {
  return {
    execute: jest.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
    executeSync: jest.fn().mockReturnValue({ rows: [], rowsAffected: 0 }),
    executeBatch: jest.fn().mockResolvedValue({ rowsAffected: 0 }),
    // Default transaction mock: actually invokes the callback (mirrors real op-sqlite behaviour)
    transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({})),
    close: jest.fn(),
    getDbPath: jest.fn().mockReturnValue('/data/myapp.db'),
    updateHook: jest.fn(),
    ...overrides,
  };
}

function mockOpSQLite(db = makeMockDb()) {
  jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn(() => db) }), { virtual: true });
  return db;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('createOpSQLiteDriver', () => {
  afterEach(() => {
    jest.resetModules();
  });

  // ─── open() ────────────────────────────────────────────────────────────

  describe('open()', () => {
    it('opens the database with .db suffix', async () => {
      const db = mockOpSQLite();
      const { open: opOpen } = require('@op-engineering/op-sqlite');
      const driver = createOpSQLiteDriver();

      await driver.open('myapp');

      expect(opOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'myapp.db' }));
      // WAL and busy_timeout pragmas are applied
      expect(db.executeSync).toHaveBeenCalledWith('PRAGMA journal_mode = WAL');
      expect(db.executeSync).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000');
    });

    it('does not double-append .db if name already ends with it', async () => {
      const db = mockOpSQLite();
      const { open: opOpen } = require('@op-engineering/op-sqlite');
      const driver = createOpSQLiteDriver();

      await driver.open('myapp.db');

      expect(opOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'myapp.db' }));
      void db;
    });

    it('passes encryptionKey when provided', async () => {
      const db = mockOpSQLite();
      const { open: opOpen } = require('@op-engineering/op-sqlite');
      const driver = createOpSQLiteDriver({ encryptionKey: 'secret' });

      await driver.open('secure');

      expect(opOpen).toHaveBeenCalledWith(
        expect.objectContaining({ encryptionKey: 'secret', name: 'secure.db' }),
      );
      void db;
    });

    it('passes custom location when provided', async () => {
      const db = mockOpSQLite();
      const { open: opOpen } = require('@op-engineering/op-sqlite');
      const driver = createOpSQLiteDriver({ location: '/sdcard/databases' });

      await driver.open('app');

      expect(opOpen).toHaveBeenCalledWith(
        expect.objectContaining({ location: '/sdcard/databases' }),
      );
      void db;
    });

    it('installs the update hook when onTableChanged is provided', async () => {
      const db = mockOpSQLite();
      const onTableChanged = jest.fn();
      const driver = createOpSQLiteDriver({ onTableChanged });

      await driver.open('app');

      expect(db.updateHook).toHaveBeenCalledWith(expect.any(Function));
    });

    it('fires onTableChanged for each write event', async () => {
      let capturedHook: ((event: any) => void) | null = null;
      const db = mockOpSQLite(
        makeMockDb({
          updateHook: jest.fn((cb) => {
            capturedHook = cb;
          }),
        }),
      );
      const onTableChanged = jest.fn();
      const driver = createOpSQLiteDriver({ onTableChanged });
      await driver.open('app');

      capturedHook!({ table: 'todos', operation: 'INSERT', rowId: 1 });

      expect(onTableChanged).toHaveBeenCalledWith('todos', 'INSERT');
      void db;
    });

    it('throws a helpful error when op-sqlite is not installed', async () => {
      jest.mock(
        '@op-engineering/op-sqlite',
        () => {
          throw new Error('Cannot find module');
        },
        { virtual: true },
      );
      const driver = createOpSQLiteDriver();

      await expect(driver.open('db')).rejects.toThrow(/@op-engineering\/op-sqlite/i);
    });
  });

  // ─── execute() ─────────────────────────────────────────────────────────

  describe('execute()', () => {
    it('delegates to db.execute() in async mode', async () => {
      const db = mockOpSQLite();
      const driver = createOpSQLiteDriver({ preferSync: false });
      await driver.open('db');

      await driver.execute('INSERT INTO foo VALUES (?)', [99]);

      expect(db.execute).toHaveBeenCalledWith('INSERT INTO foo VALUES (?)', [99]);
    });

    it('delegates to db.executeSync() in sync mode', async () => {
      const db = mockOpSQLite();
      const driver = createOpSQLiteDriver({ preferSync: true });
      await driver.open('db');

      await driver.execute('INSERT INTO foo VALUES (?)', [99]);

      expect(db.executeSync).toHaveBeenCalledWith('INSERT INTO foo VALUES (?)', [99]);
    });

    it('throws when called before open()', async () => {
      mockOpSQLite();
      const driver = createOpSQLiteDriver();

      await expect(driver.execute('SELECT 1')).rejects.toThrow(/not open|open\(\)/i);
    });
  });

  // ─── query() ───────────────────────────────────────────────────────────

  describe('query()', () => {
    it('returns the rows array from the result (async mode)', async () => {
      const rows = [{ id: 'x', name: 'test' }];
      mockOpSQLite(makeMockDb({ execute: jest.fn().mockResolvedValue({ rows, rowsAffected: 0 }) }));
      const driver = createOpSQLiteDriver({ preferSync: false });
      await driver.open('db');

      const result = await driver.query('SELECT * FROM items WHERE id = ?', ['x']);

      expect(result).toEqual(rows);
    });

    it('returns the rows array from the result (sync mode)', async () => {
      const rows = [{ id: 'x', name: 'test' }];
      mockOpSQLite(makeMockDb({ executeSync: jest.fn().mockReturnValue({ rows, rowsAffected: 0 }) }));
      const driver = createOpSQLiteDriver({ preferSync: true });
      await driver.open('db');

      const result = await driver.query('SELECT * FROM items WHERE id = ?', ['x']);

      expect(result).toEqual(rows);
    });

    it('throws when called before open()', async () => {
      mockOpSQLite();
      const driver = createOpSQLiteDriver();

      await expect(driver.query('SELECT 1')).rejects.toThrow(/not open|open\(\)/i);
    });
  });

  // ─── executeInTransaction() ────────────────────────────────────────────

  describe('executeInTransaction()', () => {
    it('wraps callback in a db.transaction() (async mode)', async () => {
      const db = mockOpSQLite();
      const driver = createOpSQLiteDriver({ preferSync: false });
      await driver.open('db');

      const callback = jest.fn();
      await driver.executeInTransaction(callback);

      expect(db.transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('uses manual BEGIN/COMMIT in sync mode', async () => {
      const db = mockOpSQLite();
      const driver = createOpSQLiteDriver({ preferSync: true });
      await driver.open('db');

      const callback = jest.fn();
      await driver.executeInTransaction(callback);

      expect(db.executeSync).toHaveBeenCalledWith('BEGIN EXCLUSIVE TRANSACTION');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(db.executeSync).toHaveBeenCalledWith('COMMIT');
    });

    it('propagates errors from the callback (async mode)', async () => {
      const boom = new Error('tx failed');
      mockOpSQLite(
        makeMockDb({
          transaction: jest.fn().mockRejectedValue(boom),
        }),
      );
      const driver = createOpSQLiteDriver({ preferSync: false });
      await driver.open('db');

      await expect(
        driver.executeInTransaction(async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);
    });

    it('throws when called before open()', async () => {
      mockOpSQLite();
      const driver = createOpSQLiteDriver();

      await expect(driver.executeInTransaction(async () => {})).rejects.toThrow(
        /not open|open\(\)/i,
      );
    });
  });

  // ─── close() ───────────────────────────────────────────────────────────

  describe('close()', () => {
    it('removes the update hook and calls db.close()', async () => {
      const db = mockOpSQLite();
      const driver = createOpSQLiteDriver({ onTableChanged: jest.fn() });
      await driver.open('db');
      await driver.close();

      expect(db.updateHook).toHaveBeenLastCalledWith(null);
      expect(db.close).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when not open', async () => {
      mockOpSQLite();
      const driver = createOpSQLiteDriver();
      await expect(driver.close()).resolves.toBeUndefined();
    });

    it('prevents double-close from calling native close twice', async () => {
      const db = mockOpSQLite();
      const driver = createOpSQLiteDriver();
      await driver.open('db');
      await driver.close();
      await driver.close();

      expect(db.close).toHaveBeenCalledTimes(1);
    });
  });
});
