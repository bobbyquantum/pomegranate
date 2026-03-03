/**
 * NativeSQLiteDriver unit tests.
 *
 * All native surfaces (global JSI function, NativeModules) are mocked,
 * so these tests run in Node/Jest without a device or simulator.
 */

import { createNativeSQLiteDriver } from '../NativeSQLiteDriver';

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Build a fully-featured mock JSI adapter. */
function makeMockAdapter(
  overrides: Partial<{
    execute: jest.Mock;
    query: jest.Mock;
    executeBatch: jest.Mock;
    close: jest.Mock;
  }> = {},
) {
  return {
    execute: jest.fn(),
    query: jest.fn().mockReturnValue([]),
    executeBatch: jest.fn().mockReturnValue(0),
    close: jest.fn(),
    ...overrides,
  };
}

/** Install a mock global JSI factory and return the mock adapter it will produce. */
function installMockGlobal(mockAdapter = makeMockAdapter()) {
  (globalThis as any).nativePomegranateCreateAdapter = jest.fn(() => mockAdapter);
  return mockAdapter;
}

function clearMockGlobal() {
  delete (globalThis as any).nativePomegranateCreateAdapter;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('createNativeSQLiteDriver', () => {
  afterEach(() => {
    clearMockGlobal();
    jest.resetModules();
  });

  // ─── open() ────────────────────────────────────────────────────────────

  describe('open()', () => {
    it('uses the global JSI factory when already installed', async () => {
      const mock = installMockGlobal();
      const driver = createNativeSQLiteDriver({ autoInstall: false });

      await driver.open('testdb');

      expect((globalThis as any).nativePomegranateCreateAdapter).toHaveBeenCalledWith('testdb');
      expect(mock.execute).not.toHaveBeenCalled(); // no-op until we call execute
    });

    it('auto-installs the native module when global is absent', async () => {
      // Simulate a side-effect install: calling bridge.install() makes the global available
      const mock = makeMockAdapter();
      const fakeBridgeInstall = jest.fn().mockImplementation(() => {
        (globalThis as any).nativePomegranateCreateAdapter = jest.fn(() => mock);
        return true;
      });

      jest.mock('react-native', () => ({
        NativeModules: { PomegranateJSIBridge: { install: fakeBridgeInstall } },
      }));

      const driver = createNativeSQLiteDriver({ autoInstall: true });
      await driver.open('mydb');

      expect(fakeBridgeInstall).toHaveBeenCalledTimes(1);
      expect((globalThis as any).nativePomegranateCreateAdapter).toHaveBeenCalledWith('mydb');
    });

    it('throws when autoInstall is false and global is missing', async () => {
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await expect(driver.open('testdb')).rejects.toThrow(/not installed|PomegranateJSIBridge/i);
    });

    it('throws when PomegranateJSIBridge module is absent', async () => {
      jest.mock('react-native', () => ({ NativeModules: {} }));

      const driver = createNativeSQLiteDriver({ autoInstall: true });
      await expect(driver.open('testdb')).rejects.toThrow(/PomegranateJSIBridge/i);
    });

    it('throws when bridge.install() returns false', async () => {
      jest.mock('react-native', () => ({
        NativeModules: { PomegranateJSIBridge: { install: jest.fn().mockReturnValue(false) } },
      }));

      const driver = createNativeSQLiteDriver({ autoInstall: true });
      await expect(driver.open('testdb')).rejects.toThrow(/install\(\) returned false/i);
    });
  });

  // ─── execute() ─────────────────────────────────────────────────────────

  describe('execute()', () => {
    it('delegates to the JSI adapter', async () => {
      const mock = installMockGlobal();
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await driver.open('db');

      await driver.execute('INSERT INTO foo VALUES (?)', [42]);

      expect(mock.execute).toHaveBeenCalledWith('INSERT INTO foo VALUES (?)', [42]);
    });

    it('passes empty array when no bindings given', async () => {
      const mock = installMockGlobal();
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await driver.open('db');

      await driver.execute('DELETE FROM foo');

      expect(mock.execute).toHaveBeenCalledWith('DELETE FROM foo', []);
    });

    it('throws when called before open()', async () => {
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await expect(driver.execute('SELECT 1')).rejects.toThrow(/not open|open\(\)/i);
    });
  });

  // ─── query() ───────────────────────────────────────────────────────────

  describe('query()', () => {
    it('returns rows from the JSI adapter', async () => {
      const rows = [
        { id: '1', title: 'hello' },
        { id: '2', title: 'world' },
      ];
      const mock = installMockGlobal(makeMockAdapter({ query: jest.fn().mockReturnValue(rows) }));
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await driver.open('db');

      const result = await driver.query('SELECT * FROM items', ['x']);

      expect(mock.query).toHaveBeenCalledWith('SELECT * FROM items', ['x']);
      expect(result).toEqual(rows);
    });

    it('passes empty array when no bindings given', async () => {
      const mock = installMockGlobal();
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await driver.open('db');

      await driver.query('SELECT 1');

      expect(mock.query).toHaveBeenCalledWith('SELECT 1', []);
    });

    it('throws when called before open()', async () => {
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await expect(driver.query('SELECT 1')).rejects.toThrow(/not open|open\(\)/i);
    });
  });

  // ─── executeInTransaction() ────────────────────────────────────────────

  describe('executeInTransaction()', () => {
    it('wraps the callback in BEGIN / COMMIT', async () => {
      const executeCalls: [string, unknown[]][] = [];
      const mock = installMockGlobal(
        makeMockAdapter({ execute: jest.fn((sql, args) => executeCalls.push([sql, args])) }),
      );
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await driver.open('db');

      const callback = jest.fn();
      await driver.executeInTransaction(callback);

      expect(executeCalls[0][0]).toMatch(/BEGIN/i);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(executeCalls[executeCalls.length - 1][0]).toMatch(/COMMIT/i);
      void mock; // suppress unused warning
    });

    it('rolls back on error and re-throws', async () => {
      const executeCalls: string[] = [];
      installMockGlobal(makeMockAdapter({ execute: jest.fn((sql) => executeCalls.push(sql)) }));
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await driver.open('db');

      const boom = new Error('oops');
      await expect(
        driver.executeInTransaction(async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);

      const last = executeCalls[executeCalls.length - 1];
      expect(last).toMatch(/ROLLBACK/i);
    });

    it('throws when called before open()', async () => {
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await expect(driver.executeInTransaction(async () => {})).rejects.toThrow(
        /not open|open\(\)/i,
      );
    });
  });

  // ─── close() ───────────────────────────────────────────────────────────

  describe('close()', () => {
    it('calls close() on the JSI adapter', async () => {
      const mock = installMockGlobal();
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await driver.open('db');
      await driver.close();

      expect(mock.close).toHaveBeenCalledTimes(1);
    });

    it('is a no-op if not opened', async () => {
      installMockGlobal();
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      // Should not throw
      await expect(driver.close()).resolves.toBeUndefined();
    });

    it('prevents double-close from hitting native layer twice', async () => {
      const mock = installMockGlobal();
      const driver = createNativeSQLiteDriver({ autoInstall: false });
      await driver.open('db');
      await driver.close();
      await driver.close(); // second close should be silent

      expect(mock.close).toHaveBeenCalledTimes(1);
    });
  });
});
