/**
 * NativeSQLiteDriver (JSI) — exercised against a stubbed JSI adapter and a
 * mocked `react-native` NativeModules bridge:
 *  - auto-install success and every failure mode
 *  - the SQLiteDriver surface (open/execute/query/transactions/batch/close)
 *  - turbo sync routing (`syncJsonId` vs `syncJson`)
 *  - the provideSyncJson / discardSyncJson JS entry points
 */

import type { SQLiteDriver } from '../adapters/sqlite/SQLiteAdapter';
import type { TurboSyncResult } from '../sync/types';

const mockNativeModules: { PomegranateJSIBridge?: { install: () => unknown } } = {};
jest.mock('react-native', () => ({ NativeModules: mockNativeModules }));

import {
  createNativeSQLiteDriver,
  provideSyncJson,
  discardSyncJson,
} from '../adapters/native-sqlite/NativeSQLiteDriver';

// ─── Stub JSI adapter ───────────────────────────────────────────────────

interface Call {
  method: string;
  args: unknown[];
}

const turboResult: TurboSyncResult = {
  timestamp: 42,
  tables: 1,
  inserted: 2,
  deleted: 0,
  skippedTables: 0,
  skippedColumns: 0,
};

function stubAdapter(failing: string[] = []) {
  const calls: Call[] = [];
  const fail = new Set(failing);
  const run = (sql: string) => {
    if (fail.has(sql)) throw new Error(`native failure: ${sql}`);
  };
  return {
    calls,
    execute(sql: string, args: unknown[]) {
      calls.push({ method: 'execute', args: [sql, args] });
      run(sql);
    },
    query(sql: string, args: unknown[]) {
      calls.push({ method: 'query', args: [sql, args] });
      return [{ sql, bound: args.length }];
    },
    executeBatch(commands: Array<{ sql: string; args: unknown[] }>) {
      calls.push({ method: 'executeBatch', args: [commands] });
      return commands.length;
    },
    applySyncJson(syncJsonId: number, tableColumns?: Record<string, string[]>) {
      calls.push({ method: 'applySyncJson', args: [syncJsonId, tableColumns] });
      return turboResult;
    },
    applySyncJsonText(json: string, tableColumns?: Record<string, string[]>) {
      calls.push({ method: 'applySyncJsonText', args: [json, tableColumns] });
      return { ...turboResult, timestamp: 43 };
    },
    close() {
      calls.push({ method: 'close', args: [] });
    },
  };
}

type Stub = ReturnType<typeof stubAdapter>;

/** Install the JSI global so `open()` hands back `stub`. */
function installBinding(stub: Stub): string[] {
  const opened: string[] = [];
  globalThis.nativePomegranateCreateAdapter = (name: string) => {
    opened.push(name);
    return stub;
  };
  return opened;
}

afterEach(() => {
  delete globalThis.nativePomegranateCreateAdapter;
  delete globalThis.nativePomegranateProvideSyncJson;
  delete globalThis.nativePomegranateDiscardSyncJson;
  delete mockNativeModules.PomegranateJSIBridge;
});

// ─── Installation ───────────────────────────────────────────────────────

describe('createNativeSQLiteDriver installation', () => {
  it('uses an already-installed binding without touching NativeModules', async () => {
    const stub = stubAdapter();
    const opened = installBinding(stub);
    const driver = createNativeSQLiteDriver();
    await driver.open('app.db');
    expect(opened).toEqual(['app.db']);
    expect(mockNativeModules.PomegranateJSIBridge).toBeUndefined();
  });

  it('refuses to auto-install when autoInstall is false', async () => {
    const driver = createNativeSQLiteDriver({ autoInstall: false });
    await expect(driver.open('x')).rejects.toThrow(/Call NativeModules.PomegranateJSIBridge.install\(\) first/);
  });

  it('fails when the PomegranateJSIBridge native module is missing', async () => {
    const driver = createNativeSQLiteDriver();
    await expect(driver.open('x')).rejects.toThrow(
      /Failed to install PomegranateDB JSI binding: PomegranateJSIBridge native module not found/,
    );
  });

  it('fails when install() returns false', async () => {
    mockNativeModules.PomegranateJSIBridge = { install: () => false };
    const driver = createNativeSQLiteDriver();
    await expect(driver.open('x')).rejects.toThrow(/install\(\) returned false/);
  });

  it('stringifies a non-Error thrown by install()', async () => {
    mockNativeModules.PomegranateJSIBridge = {
      install: () => {
        throw 'dlopen failed';
      },
    };
    const driver = createNativeSQLiteDriver();
    await expect(driver.open('x')).rejects.toThrow('Failed to install PomegranateDB JSI binding: dlopen failed');
  });

  it('keeps the original error as cause when install() throws an Error', async () => {
    const original = new Error('jsi unavailable');
    mockNativeModules.PomegranateJSIBridge = {
      install: () => {
        throw original;
      },
    };
    const driver = createNativeSQLiteDriver();
    const error = await driver.open('x').then(
      () => {
        throw new Error('open() should have rejected');
      },
      (e: unknown) => e as Error & { cause?: unknown },
    );
    expect(error.message).toBe('Failed to install PomegranateDB JSI binding: jsi unavailable');
    expect(error.cause).toBe(original);
  });

  it('fails when install() succeeds but the global binding never appears', async () => {
    mockNativeModules.PomegranateJSIBridge = { install: () => true };
    const driver = createNativeSQLiteDriver();
    await expect(driver.open('x')).rejects.toThrow(TypeError);
    await expect(driver.open('x')).rejects.toThrow(/installation succeeded but/);
  });

  it('auto-installs through NativeModules and then opens', async () => {
    const stub = stubAdapter();
    let installs = 0;
    mockNativeModules.PomegranateJSIBridge = {
      install: () => {
        installs++;
        installBinding(stub);
        return true;
      },
    };
    const driver = createNativeSQLiteDriver({ autoInstall: true });
    await driver.open('auto.db');
    await driver.execute('SELECT 1');
    expect(installs).toBe(1);
    expect(stub.calls).toEqual([{ method: 'execute', args: ['SELECT 1', []] }]);
  });
});

// ─── Driver surface ─────────────────────────────────────────────────────

describe('createNativeSQLiteDriver operations', () => {
  let stub: Stub;
  let driver: SQLiteDriver;

  beforeEach(async () => {
    stub = stubAdapter(['INSERT bad', 'ROLLBACK']);
    installBinding(stub);
    driver = createNativeSQLiteDriver();
  });

  it('rejects every operation before open()', async () => {
    const closed = createNativeSQLiteDriver();
    await expect(closed.execute('SELECT 1')).rejects.toThrow(/Database not open/);
    await expect(closed.query('SELECT 1')).rejects.toThrow(/Database not open/);
    await expect(closed.executeBatch!([['SELECT 1', []]])).rejects.toThrow(/Database not open/);
    await expect(closed.executeInTransaction(async () => {})).rejects.toThrow(/Database not open/);
    await expect(closed.applySyncJson!({ syncJsonId: 1 }, {})).rejects.toThrow(/Database not open/);
  });

  it('execute and query default the bindings to an empty array', async () => {
    await driver.open('db');
    await driver.execute('CREATE TABLE t (a)');
    await driver.execute('INSERT INTO t VALUES (?)', [1]);
    expect(await driver.query('SELECT * FROM t')).toEqual([{ sql: 'SELECT * FROM t', bound: 0 }]);
    expect(await driver.query('SELECT ? , ?', [1, 2])).toEqual([{ sql: 'SELECT ? , ?', bound: 2 }]);
    expect(stub.calls.slice(0, 2)).toEqual([
      { method: 'execute', args: ['CREATE TABLE t (a)', []] },
      { method: 'execute', args: ['INSERT INTO t VALUES (?)', [1]] },
    ]);
  });

  it('commits a transaction around the callback', async () => {
    await driver.open('db');
    await driver.executeInTransaction(async () => {
      await driver.execute('INSERT ok');
    });
    expect(stub.calls.map((c) => c.args[0])).toEqual(['BEGIN EXCLUSIVE TRANSACTION', 'INSERT ok', 'COMMIT']);
  });

  it('rolls back when the callback fails and rethrows the original error', async () => {
    await driver.open('db');
    const good = stubAdapter();
    installBinding(good);
    const okDriver = createNativeSQLiteDriver();
    await okDriver.open('db');
    await expect(
      okDriver.executeInTransaction(async () => {
        await okDriver.execute('INSERT x');
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(good.calls.map((c) => c.args[0])).toEqual(['BEGIN EXCLUSIVE TRANSACTION', 'INSERT x', 'ROLLBACK']);
  });

  it('keeps the original error when the rollback itself fails', async () => {
    await driver.open('db');
    await expect(
      driver.executeInTransaction(async () => {
        await driver.execute('INSERT bad');
      }),
    ).rejects.toThrow('native failure: INSERT bad');
    expect(stub.calls.map((c) => c.args[0])).toEqual(['BEGIN EXCLUSIVE TRANSACTION', 'INSERT bad', 'ROLLBACK']);
  });

  it('sends a batch as one JSI call', async () => {
    await driver.open('db');
    await driver.executeBatch!([
      ['INSERT a', [1]],
      ['INSERT b', [2, 3]],
    ]);
    expect(stub.calls).toEqual([
      {
        method: 'executeBatch',
        args: [
          [
            { sql: 'INSERT a', args: [1] },
            { sql: 'INSERT b', args: [2, 3] },
          ],
        ],
      },
    ]);
  });

  it('routes a syncJsonId to applySyncJson and syncJson text to applySyncJsonText', async () => {
    await driver.open('db');
    const columns = { tasks: ['title'] };
    expect(await driver.applySyncJson!({ syncJsonId: 7 }, columns)).toEqual(turboResult);
    expect(await driver.applySyncJson!({ syncJson: '{"changes":{}}' }, columns)).toMatchObject({ timestamp: 43 });
    expect(stub.calls).toEqual([
      { method: 'applySyncJson', args: [7, columns] },
      { method: 'applySyncJsonText', args: ['{"changes":{}}', columns] },
    ]);
  });

  it('exposes raw sync and async execution', async () => {
    await driver.open('db');
    const raw = driver as SQLiteDriver & { executeSync(sql: string, bindings?: unknown[]): void };
    raw.executeSync('PRAGMA a');
    raw.executeSync('PRAGMA b', [1]);
    await driver.executeAsync!('PRAGMA c');
    await driver.executeAsync!('PRAGMA d', [2]);
    expect(stub.calls.map((c) => c.args)).toEqual([
      ['PRAGMA a', []],
      ['PRAGMA b', [1]],
      ['PRAGMA c', []],
      ['PRAGMA d', [2]],
    ]);
  });

  it('closes once and refuses further operations', async () => {
    await driver.open('db');
    await driver.close();
    await driver.close();
    expect(stub.calls).toEqual([{ method: 'close', args: [] }]);
    await expect(driver.execute('SELECT 1')).rejects.toThrow(/Database not open/);
  });
});

// ─── provideSyncJson / discardSyncJson ──────────────────────────────────

describe('provideSyncJson / discardSyncJson', () => {
  it('require the JSI binding for provide, and report false for discard without it', () => {
    expect(() => provideSyncJson(1, '{}')).toThrow(TypeError);
    expect(() => provideSyncJson(1, '{}')).toThrow(/open a native-sqlite database first/);
    expect(discardSyncJson(1)).toBe(false);
  });

  it('forward to the native store when installed', () => {
    const provided: Array<[number, string]> = [];
    const discarded: number[] = [];
    globalThis.nativePomegranateProvideSyncJson = (id, json) => {
      provided.push([id, json]);
    };
    globalThis.nativePomegranateDiscardSyncJson = (id) => {
      discarded.push(id);
      return id === 5;
    };

    provideSyncJson(5, '{"changes":{}}');
    expect(provided).toEqual([[5, '{"changes":{}}']]);
    expect(discardSyncJson(5)).toBe(true);
    expect(discardSyncJson(6)).toBe(false);
    expect(discarded).toEqual([5, 6]);
  });
});
