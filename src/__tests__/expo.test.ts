/**
 * Tests for Expo SQLite Driver & Config Plugin.
 *
 * Since expo-sqlite requires native bindings, we test the driver
 * with a mock of expo-sqlite to verify the integration layer works
 * correctly — argument passing, error handling, lifecycle, etc.
 *
 * The config plugin is pure JS, so we test it directly.
 */

// ─── Mock expo-sqlite ──────────────────────────────────────────────────

const mockExecAsync = jest.fn().mockResolvedValue(undefined);
const mockRunAsync = jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
const mockGetAllAsync = jest.fn().mockResolvedValue([]);
const mockCloseAsync = jest.fn().mockResolvedValue(undefined);
const mockWithExclusiveTransactionAsync = jest.fn().mockImplementation(async (fn: any) => {
  await fn({});
});

const mockDatabase = {
  execAsync: mockExecAsync,
  runAsync: mockRunAsync,
  getAllAsync: mockGetAllAsync,
  closeAsync: mockCloseAsync,
  withExclusiveTransactionAsync: mockWithExclusiveTransactionAsync,
};

const mockOpenDatabaseAsync = jest.fn().mockResolvedValue(mockDatabase);

jest.mock(
  'expo-sqlite',
  () => ({
    openDatabaseAsync: mockOpenDatabaseAsync,
  }),
  { virtual: true },
);

// ─── Import after mocking ──────────────────────────────────────────────

import { createExpoSQLiteDriver } from '../adapters/expo-sqlite/ExpoSQLiteDriver';
import type { SQLiteDriver } from '../adapters/sqlite/SQLiteAdapter';

// ─── Config plugin (we can import directly since it's pure JS) ─────────
const withPomegranateDB = require('../../expo-plugin/index');

// ═══════════════════════════════════════════════════════════════════════
// Driver Tests
// ═══════════════════════════════════════════════════════════════════════

describe('ExpoSQLiteDriver', () => {
  let driver: SQLiteDriver;

  beforeEach(() => {
    jest.clearAllMocks();
    driver = createExpoSQLiteDriver();
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────

  describe('open', () => {
    it('opens a database with .db extension', async () => {
      await driver.open('myapp');
      expect(mockOpenDatabaseAsync).toHaveBeenCalledWith('myapp.db', undefined);
    });

    it('does not double-add .db extension', async () => {
      await driver.open('myapp.db');
      expect(mockOpenDatabaseAsync).toHaveBeenCalledWith('myapp.db', undefined);
    });

    it('enables WAL mode after opening', async () => {
      await driver.open('test');
      expect(mockExecAsync).toHaveBeenCalledWith('PRAGMA journal_mode = WAL');
    });

    it('passes open options to expo-sqlite', async () => {
      const d = createExpoSQLiteDriver({ openOptions: { enableChangeListener: true } });
      await d.open('test');
      expect(mockOpenDatabaseAsync).toHaveBeenCalledWith('test.db', { enableChangeListener: true });
    });
  });

  describe('close', () => {
    it('closes the database', async () => {
      await driver.open('test');
      await driver.close();
      expect(mockCloseAsync).toHaveBeenCalled();
    });

    it('does nothing if not open', async () => {
      await driver.close(); // should not throw
      expect(mockCloseAsync).not.toHaveBeenCalled();
    });
  });

  // ─── Execute ────────────────────────────────────────────────────────

  describe('execute', () => {
    beforeEach(async () => {
      await driver.open('test');
      jest.clearAllMocks();
    });

    it('uses execAsync for SQL without bindings', async () => {
      await driver.execute('CREATE TABLE test (id TEXT)');
      expect(mockExecAsync).toHaveBeenCalledWith('CREATE TABLE test (id TEXT)');
      expect(mockRunAsync).not.toHaveBeenCalled();
    });

    it('uses runAsync for SQL with bindings', async () => {
      await driver.execute('INSERT INTO test (id) VALUES (?)', ['abc']);
      expect(mockRunAsync).toHaveBeenCalledWith('INSERT INTO test (id) VALUES (?)', 'abc');
    });

    it('uses execAsync for empty bindings array', async () => {
      await driver.execute('CREATE TABLE test (id TEXT)', []);
      expect(mockExecAsync).toHaveBeenCalledWith('CREATE TABLE test (id TEXT)');
    });

    it('throws if database not open', async () => {
      await driver.close();
      await expect(driver.execute('SELECT 1')).rejects.toThrow('Database not open');
    });
  });

  // ─── Query ──────────────────────────────────────────────────────────

  describe('query', () => {
    beforeEach(async () => {
      await driver.open('test');
      jest.clearAllMocks();
    });

    it('calls getAllAsync without bindings', async () => {
      mockGetAllAsync.mockResolvedValueOnce([{ id: '1' }]);
      const rows = await driver.query('SELECT * FROM test');
      expect(mockGetAllAsync).toHaveBeenCalledWith('SELECT * FROM test');
      expect(rows).toEqual([{ id: '1' }]);
    });

    it('calls getAllAsync with bindings', async () => {
      mockGetAllAsync.mockResolvedValueOnce([{ id: '1', name: 'Alice' }]);
      const rows = await driver.query('SELECT * FROM test WHERE id = ?', ['1']);
      expect(mockGetAllAsync).toHaveBeenCalledWith('SELECT * FROM test WHERE id = ?', '1');
      expect(rows).toEqual([{ id: '1', name: 'Alice' }]);
    });

    it('throws if database not open', async () => {
      await driver.close();
      await expect(driver.query('SELECT 1')).rejects.toThrow('Database not open');
    });
  });

  // ─── Transactions ──────────────────────────────────────────────────

  describe('executeInTransaction', () => {
    beforeEach(async () => {
      await driver.open('test');
      jest.clearAllMocks();
    });

    it('wraps function in withExclusiveTransactionAsync', async () => {
      const fn = jest.fn().mockResolvedValue(undefined);
      await driver.executeInTransaction(fn);
      expect(mockWithExclusiveTransactionAsync).toHaveBeenCalled();
      expect(fn).toHaveBeenCalled();
    });

    it('propagates errors from the transaction function', async () => {
      const error = new Error('tx failed');
      mockWithExclusiveTransactionAsync.mockRejectedValueOnce(error);

      await expect(
        driver.executeInTransaction(async () => {
          throw error;
        }),
      ).rejects.toThrow('tx failed');
    });
  });

  // ─── Error Handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws helpful message when expo-sqlite is not installed', () => {
      // Re-mock require to simulate missing module
      jest.resetModules();
      jest.mock(
        'expo-sqlite',
        () => {
          throw new Error('Cannot find module');
        },
        { virtual: true },
      );

      // Need to re-import after resetting
      const {
        createExpoSQLiteDriver: createDriver,
      } = require('../adapters/expo-sqlite/ExpoSQLiteDriver');
      const d = createDriver();
      expect(d.open('test')).rejects.toThrow('expo-sqlite is not installed');

      // Restore mock
      jest.resetModules();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Config Plugin Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Expo Config Plugin (withPomegranateDB)', () => {
  const baseConfig = {
    name: 'TestApp',
    slug: 'test-app',
  };

  it('adds expo-sqlite plugin with FTS enabled by default', () => {
    const result = withPomegranateDB({ ...baseConfig });

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toEqual(['expo-sqlite', { enableFTS: true, useSQLCipher: false }]);
  });

  it('respects custom config options', () => {
    const result = withPomegranateDB(
      { ...baseConfig },
      {
        enableFTS: false,
        useSQLCipher: true,
      },
    );

    expect(result.plugins[0]).toEqual(['expo-sqlite', { enableFTS: false, useSQLCipher: true }]);
  });

  it('passes custom build flags to iOS config', () => {
    const result = withPomegranateDB(
      { ...baseConfig },
      {
        customBuildFlags: '-DSQLITE_ENABLE_DBSTAT_VTAB=1',
      },
    );

    expect(result.plugins[0][1]).toEqual({
      enableFTS: true,
      useSQLCipher: false,
      ios: { customBuildFlags: '-DSQLITE_ENABLE_DBSTAT_VTAB=1' },
    });
  });

  it('merges with existing expo-sqlite plugin (string form)', () => {
    const config = {
      ...baseConfig,
      plugins: ['expo-sqlite' as string | [string, Record<string, unknown>]],
    };

    const result = withPomegranateDB(config);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toEqual(['expo-sqlite', { enableFTS: true, useSQLCipher: false }]);
  });

  it('merges with existing expo-sqlite plugin (array form)', () => {
    const config = {
      ...baseConfig,
      plugins: [['expo-sqlite', { enableFTS: false }] as [string, Record<string, unknown>]],
    };

    const result = withPomegranateDB(config, { useSQLCipher: true });

    expect(result.plugins).toHaveLength(1);
    // Our config should override
    expect(result.plugins[0]).toEqual(['expo-sqlite', { enableFTS: true, useSQLCipher: true }]);
  });

  it('preserves other plugins', () => {
    const config = {
      ...baseConfig,
      plugins: ['expo-camera' as string | [string, Record<string, unknown>]],
    };

    const result = withPomegranateDB(config);
    expect(result.plugins).toHaveLength(2);
    expect(result.plugins[0]).toBe('expo-camera');
    expect(result.plugins[1][0]).toBe('expo-sqlite');
  });

  it('initializes plugins array if not present', () => {
    const result = withPomegranateDB({ ...baseConfig });
    expect(Array.isArray(result.plugins)).toBe(true);
    expect(result.plugins).toHaveLength(1);
  });
});
