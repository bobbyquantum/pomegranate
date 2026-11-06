/**
 * Turbo sync + lastPulledAt persistence tests.
 *
 * Covers:
 *  - lastPulledAt survives across syncs on the SQLite adapter (regression:
 *    it used to be written as a fake record into a two-column metadata table,
 *    fail silently, and force a full pull every time)
 *  - unsafeTurbo with a JSON-text payload on SQLite (JS fallback) and Loki
 *  - unsafeTurbo delegating to a driver with native applySyncJson
 *  - turbo preconditions: first sync only, no local changes
 *  - a regular sync receiving { syncJson } parses it; { syncJsonId } is refused
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { SQLiteAdapter } from '../adapters/sqlite/SQLiteAdapter';
import type { SQLiteDriver } from '../adapters/sqlite/SQLiteAdapter';
import { performSync } from '../sync/sync';
import type { SyncPullParams, SyncPullResult, TurboSyncResult, TurboSyncSource } from '../sync/types';

// ─── Schema ─────────────────────────────────────────────────────────────

const TaskSchema = m.model('tasks', {
  title: m.text(),
  done: m.boolean().default(false),
  priority: m.number().default(0),
  notes: m.text().optional(),
});
class Task extends Model<typeof TaskSchema> {
  static schema = TaskSchema;
}

const ProjectSchema = m.model('projects', {
  name: m.text(),
});
class Project extends Model<typeof ProjectSchema> {
  static schema = ProjectSchema;
}

// ─── better-sqlite3 driver ──────────────────────────────────────────────

function createDriver(): SQLiteDriver & { raw: () => BetterSqlite3.Database } {
  let db: BetterSqlite3.Database | null = null;
  const need = () => {
    if (!db) throw new Error('not open');
    return db;
  };
  return {
    raw: need,
    async open(name) {
      db = new BetterSqlite3(name);
    },
    async execute(sql, bindings = []) {
      need().prepare(sql).run(...bindings);
    },
    async query(sql, bindings = []) {
      return need().prepare(sql).all(...bindings) as Record<string, unknown>[];
    },
    async executeInTransaction(fn) {
      need().exec('BEGIN');
      try {
        await fn();
        need().exec('COMMIT');
      } catch (error) {
        need().exec('ROLLBACK');
        throw error;
      }
    },
    async close() {
      db?.close();
      db = null;
    },
  };
}

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomegranate-turbo-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function createSqliteDb(name: string) {
  const driver = createDriver();
  const adapter = new SQLiteAdapter({ databaseName: path.join(tmpDir, name), driver });
  const db = new Database({ adapter, models: [Task, Project], schemaVersion: 7 });
  await db.initialize();
  return { db, driver, adapter };
}

async function createLokiDb(name: string) {
  const db = new Database({ adapter: new LokiAdapter({ databaseName: name }), models: [Task, Project] });
  await db.initialize();
  return db;
}

const payload = (timestamp = 1_700_000_000_000): SyncPullResult => ({
  changes: {
    tasks: {
      created: [
        { id: 't1', title: 'Buy milk', done: false, priority: 2, notes: { tags: ['a'] } } as any,
        { id: 't2', title: 'Ship it', done: true, priority: 9, notes: null, extra_column: 'dropped' } as any,
      ],
      updated: [],
      deleted: [],
    },
    projects: { created: [{ id: 'p1', name: 'Pomegranate' } as any], updated: [], deleted: [] },
    unknown_table: { created: [{ id: 'x' } as any], updated: [], deleted: [] },
  },
  timestamp,
});

const noPush = async () => {};

// ─── lastPulledAt persistence ───────────────────────────────────────────

describe('lastPulledAt on SQLite', () => {
  it('is persisted and handed to the next pull', async () => {
    const { db } = await createSqliteDb('lpa.db');
    const seen: SyncPullParams[] = [];
    const pull = async (params: SyncPullParams): Promise<SyncPullResult> => {
      seen.push(params);
      return { changes: {}, timestamp: 111 + seen.length };
    };

    await performSync(db, { pullChanges: pull, pushChanges: noPush });
    await performSync(db, { pullChanges: pull, pushChanges: noPush });
    await performSync(db, { pullChanges: pull, pushChanges: noPush });

    expect(seen.map((p) => p.lastPulledAt)).toEqual([null, 112, 113]);
    expect(seen[0].schemaVersion).toBe(7);
    expect(await db._adapter.getMetadata!('pomegranate_last_pulled_at')).toBe('114');
    await db.close();
  });
});

// ─── Turbo: JS fallback on SQLite ───────────────────────────────────────

describe('unsafeTurbo on SQLite (JS fallback)', () => {
  it('imports a syncJson payload, filters to the schema and records the checkpoint', async () => {
    const { db, driver } = await createSqliteDb('turbo-sqlite.db');
    let pushed = false;

    await db.sync({
      unsafeTurbo: true,
      pullChanges: async () => ({ syncJson: JSON.stringify(payload()) }),
      pushChanges: async () => {
        pushed = true;
      },
    });

    expect(pushed).toBe(false);
    const rows = driver.raw().prepare('SELECT * FROM tasks ORDER BY id').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 't1', title: 'Buy milk', done: 0, priority: 2, _status: 'synced', _changed: '' });
    expect(rows[0].notes).toBe(JSON.stringify({ tags: ['a'] })); // nested value stored as text
    expect(rows[1]).toMatchObject({ id: 't2', done: 1 });
    expect('extra_column' in rows[1]).toBe(false);
    expect(driver.raw().prepare('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 1 });
    expect(await db._adapter.getMetadata!('pomegranate_last_pulled_at')).toBe('1700000000000');

    // Live collection sees the imported rows.
    const tasks = db.get(Task);
    expect(await tasks.count(tasks.query())).toBe(2);
    await db.close();
  });

  it('refuses to run once a sync has happened', async () => {
    const { db } = await createSqliteDb('turbo-second.db');
    await performSync(db, { pullChanges: async () => ({ changes: {}, timestamp: 5 }), pushChanges: noPush });
    await expect(
      db.sync({ unsafeTurbo: true, pullChanges: async () => ({ syncJson: '{}' }), pushChanges: noPush }),
    ).rejects.toThrow(/first sync/);
    await db.close();
  });

  it('refuses to run with unsynced local changes', async () => {
    const { db } = await createSqliteDb('turbo-dirty.db');
    await db.write(async () => {
      await db.get(Task).create({ title: 'local', done: false, priority: 1 });
    });
    await expect(
      db.sync({ unsafeTurbo: true, pullChanges: async () => ({ syncJson: '{}' }), pushChanges: noPush }),
    ).rejects.toThrow(/unsynced local changes/);
    await db.close();
  });

  it('rejects a payload without a timestamp', async () => {
    const { db } = await createSqliteDb('turbo-nots.db');
    await expect(
      db.sync({
        unsafeTurbo: true,
        pullChanges: async () => ({ syncJson: JSON.stringify({ changes: {} }) }),
        pushChanges: noPush,
      }),
    ).rejects.toThrow(/timestamp/);
    await db.close();
  });

  it('cannot import a syncJsonId without a native driver', async () => {
    const { db } = await createSqliteDb('turbo-id.db');
    await expect(
      db.sync({ unsafeTurbo: true, pullChanges: async () => ({ syncJsonId: 42 }), pushChanges: noPush }),
    ).rejects.toThrow(/native/);
    await db.close();
  });
});

// ─── Turbo: native driver delegation ────────────────────────────────────

describe('unsafeTurbo with a native driver', () => {
  it('passes the source and table columns straight to driver.applySyncJson', async () => {
    const driver = createDriver();
    const calls: Array<[TurboSyncSource, Record<string, string[]>]> = [];
    const nativeDriver: SQLiteDriver = {
      ...driver,
      async applySyncJson(source, tableColumns): Promise<TurboSyncResult> {
        calls.push([source, tableColumns]);
        return { timestamp: 999, tables: 2, inserted: 3, deleted: 0, skippedTables: 1, skippedColumns: 1 };
      },
    };
    const adapter = new SQLiteAdapter({ databaseName: path.join(tmpDir, 'native.db'), driver: nativeDriver });
    const db = new Database({ adapter, models: [Task, Project] });
    await db.initialize();

    const logs: Array<ReturnType<typeof Object> & { turbo?: TurboSyncResult }> = [];
    const unsubscribe = db.syncLog$.subscribe((log) => log && logs.push(log));

    await db.sync({ unsafeTurbo: true, pullChanges: async () => ({ syncJsonId: 42 }), pushChanges: noPush });

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual({ syncJsonId: 42 });
    expect(calls[0][1]).toEqual({
      tasks: ['title', 'done', 'priority', 'notes'],
      projects: ['name'],
    });
    expect(await adapter.getMetadata('pomegranate_last_pulled_at')).toBe('999');
    expect(logs.at(-1)?.turbo).toMatchObject({ inserted: 3, skippedTables: 1 });
    unsubscribe();
    await db.close();
  });
});

// ─── Turbo on Loki ──────────────────────────────────────────────────────

describe('unsafeTurbo on Loki', () => {
  it('imports a syncJson payload via the JS fallback', async () => {
    const db = await createLokiDb('turbo-loki');
    await db.sync({
      unsafeTurbo: true,
      pullChanges: async () => ({ syncJson: JSON.stringify(payload(123)) }),
      pushChanges: noPush,
    });
    const tasks = db.get(Task);
    const all = await tasks.fetch(tasks.query());
    expect(all.map((t) => t.getField('title')).sort()).toEqual(['Buy milk', 'Ship it']);
    expect(all.every((t) => t.syncStatus === 'synced')).toBe(true);
    expect(await db._adapter.getMetadata!('pomegranate_last_pulled_at')).toBe('123');

    // Second, regular sync sees the checkpoint.
    let seen: number | null | undefined;
    await performSync(db, {
      pullChanges: async ({ lastPulledAt }) => {
        seen = lastPulledAt;
        return { changes: {}, timestamp: 124 };
      },
      pushChanges: noPush,
    });
    expect(seen).toBe(123);
    await db.close();
  });
});

// ─── Regular sync receiving turbo sources ───────────────────────────────

describe('regular sync with turbo-shaped pull results', () => {
  it('parses { syncJson } text', async () => {
    const db = await createLokiDb('regular-json');
    // The regular path applies the payload as-is (no schema filtering), so
    // hand it only tables the database knows about.
    const { unknown_table: _ignored, ...changes } = payload(50).changes;
    await performSync(db, {
      pullChanges: async () => ({ syncJson: JSON.stringify({ changes, timestamp: 50 }) }),
      pushChanges: noPush,
    });
    const tasks = db.get(Task);
    expect(await tasks.count(tasks.query())).toBe(2);
    await db.close();
  });

  it('refuses { syncJsonId } without unsafeTurbo', async () => {
    const db = await createLokiDb('regular-id');
    await expect(
      performSync(db, { pullChanges: async () => ({ syncJsonId: 1 }), pushChanges: noPush }),
    ).rejects.toThrow(/unsafeTurbo/);
    await db.close();
  });
});
