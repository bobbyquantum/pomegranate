/**
 * Sync engine additions:
 *  - pull-first ordering, merged pushes, "unchanged since snapshot" marking
 *  - push failure / rejected ids semantics
 *  - onConflict override on the merged record
 *  - schema filtering of the pull payload on the regular path
 *  - migration-aware pulls (`migration` argument, lastPulledSchemaVersion)
 *  - hasUnsyncedChanges, SyncLog fields, `log`, `sendCreatedAsUpdated`
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { SQLiteAdapter } from '../adapters/sqlite/SQLiteAdapter';
import type { Migration } from '../adapters/types';
import { hasUnsyncedChanges, performSync } from '../sync/sync';
import type { SyncLog, SyncPullParams, SyncPullResult, SyncPushPayload, SyncTableChanges } from '../sync/types';
import type { RawRecord } from '../schema/types';
import { createBetterSqliteDriver } from './helpers/betterSqliteDriver';

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

const ProjectSchema = m.model('projects', { name: m.text() });
class Project extends Model<typeof ProjectSchema> {
  static schema = ProjectSchema;
}

let counter = 0;
async function createDb(lokiInstance?: unknown, extra: Partial<ConstructorParameters<typeof Database>[0]> = {}) {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: `pf-${counter++}`, lokiInstance }),
    models: [Task, Project],
    ...extra,
  });
  await db.initialize();
  return db;
}

const remote = (id: string, fields: Partial<RawRecord> = {}): RawRecord =>
  ({ id, title: `remote ${id}`, done: false, priority: 1, notes: null, ...fields }) as RawRecord;

const pullOf = (changes: SyncTableChanges, timestamp = 2000) => async (): Promise<SyncPullResult> => ({ changes, timestamp });
const noPush = async () => {};

/** Seed a record as if it had been pulled, then edit it locally. */
async function seedAndEdit(db: Database, id: string, edit: Record<string, unknown>) {
  await db._adapter.applyRemoteChanges({
    tasks: { created: [remote(id, { title: 'server title', priority: 1 })], updated: [], deleted: [] },
  });
  const task = (await db.get(Task).findById(id))!;
  await db.write(async () => {
    await task.update(edit);
  });
  return task;
}

// ─── Pull-first ordering ────────────────────────────────────────────────

describe('pullFirst ordering', () => {
  it('pulls, applies, then pushes with the new checkpoint', async () => {
    const db = await createDb();
    await db.write(async () => {
      await db.get(Task).create({ title: 'mine' });
    });

    const calls: string[] = [];
    const states: string[] = [];
    let pushPayload: SyncPushPayload | null = null;
    const unsubscribe = db.observeSyncState().subscribe((s) => states.push(s));

    await db.sync({
      pullFirst: true,
      pullChanges: async (params) => {
        calls.push('pull');
        expect(params.lastPulledAt).toBeNull();
        return { changes: { tasks: { created: [remote('r1')], updated: [], deleted: [] } }, timestamp: 2000 };
      },
      pushChanges: async (payload) => {
        calls.push('push');
        pushPayload = payload;
      },
    });
    unsubscribe();

    expect(calls).toEqual(['pull', 'push']);
    expect(pushPayload!.lastPulledAt).toBe(2000);
    expect(pushPayload!.changes.tasks.created).toHaveLength(1);
    expect(states).toEqual(['idle', 'pulling', 'applying', 'pushing', 'complete']);
    expect(await db._adapter.findById('tasks', 'r1')).toMatchObject({ _status: 'synced' });
    expect(await hasUnsyncedChanges(db)).toBe(false);
    await db.close();
  });

  it('pushes the merged record after applying remote changes to a pending edit', async () => {
    const db = await createDb();
    const task = await seedAndEdit(db, 'm1', { title: 'local title' });
    expect(task.syncStatus).toBe('updated');

    let pushed: SyncTableChanges | null = null;
    await performSync(db, {
      pullFirst: true,
      pullChanges: pullOf({ tasks: { created: [], updated: [remote('m1', { title: 'newer server title', priority: 9 })], deleted: [] } }),
      pushChanges: async ({ changes }) => {
        pushed = changes;
      },
    });

    // The local title won, the server's priority came in, and the push carried both.
    expect(pushed!.tasks.updated[0]).toMatchObject({ id: 'm1', title: 'local title', priority: 9 });
    expect(await db._adapter.findById('tasks', 'm1')).toMatchObject({
      title: 'local title',
      priority: 9,
      _status: 'synced',
      _changed: '',
    });
    await db.close();
  });

  it('does not mark a record synced if it was edited again while pushing', async () => {
    const db = await createDb();
    const task = await seedAndEdit(db, 'e1', { title: 'first edit' });

    const pushes: string[] = [];
    const config = {
      pullFirst: true,
      pullChanges: pullOf({}),
      pushChanges: async ({ changes }: SyncPushPayload) => {
        pushes.push(changes.tasks.updated[0].title as string);
        if (pushes.length === 1) {
          await db.write(async () => {
            await task.update({ title: 'edited during push' });
          });
        }
      },
    };

    await performSync(db, config);
    expect(await db._adapter.findById('tasks', 'e1')).toMatchObject({
      title: 'edited during push',
      _status: 'updated',
      _changed: 'title',
    });

    await performSync(db, config);
    expect(pushes).toEqual(['first edit', 'edited during push']);
    expect(await db._adapter.findById('tasks', 'e1')).toMatchObject({ _status: 'synced' });
    await db.close();
  });

  it('keeps pulled data and the checkpoint when the push fails', async () => {
    const db = await createDb();
    const local = await db.write(async () => db.get(Task).create({ title: 'unsent' }));
    const log: Partial<SyncLog> = {};

    await expect(
      performSync(db, {
        pullFirst: true,
        log,
        pullChanges: pullOf({ tasks: { created: [remote('r1')], updated: [], deleted: [] } }, 3000),
        pushChanges: async () => {
          throw new Error('server 500');
        },
      }),
    ).rejects.toThrow('server 500');

    expect(await db._adapter.findById('tasks', 'r1')).toMatchObject({ _status: 'synced' });
    expect(await db._adapter.getMetadata!('pomegranate_last_pulled_at')).toBe('3000');
    expect(await db._adapter.findById('tasks', local.id)).toMatchObject({ _status: 'created' });
    expect(log).toMatchObject({ state: 'error', error: 'server 500', newLastPulledAt: 3000, localChangeCount: 1 });
    expect(log.phase).toMatch(/^failed: server 500/);

    // The next cycle pushes it.
    let pushedIds: string[] = [];
    await performSync(db, {
      pullFirst: true,
      pullChanges: async ({ lastPulledAt }) => {
        expect(lastPulledAt).toBe(3000);
        return { changes: {}, timestamp: 3001 };
      },
      pushChanges: async ({ changes }) => {
        pushedIds = changes.tasks.created.map((r) => r.id);
      },
    });
    expect(pushedIds).toEqual([local.id]);
    await db.close();
  });

  it('leaves rejected ids unsynced', async () => {
    const db = await createDb();
    const [a, b] = await db.write(async () => [
      await db.get(Task).create({ title: 'a' }),
      await db.get(Task).create({ title: 'b' }),
    ]);
    const log: Partial<SyncLog> = {};

    await performSync(db, {
      pullFirst: true,
      log,
      pullChanges: pullOf({}),
      pushChanges: async () => ({ experimentalRejectedIds: { tasks: [b.id] } }),
    });

    expect(await db._adapter.findById('tasks', a.id)).toMatchObject({ _status: 'synced' });
    expect(await db._adapter.findById('tasks', b.id)).toMatchObject({ _status: 'created' });
    expect(log.rejectedIds).toEqual({ tasks: [b.id] });
    await db.close();
  });

  it('runs onConflict on the merged record and pushes the result', async () => {
    const db = await createDb();
    await seedAndEdit(db, 'c1', { title: 'local title' });
    const seen: Array<[RawRecord, RawRecord]> = [];
    let pushed: SyncTableChanges | null = null;
    const log: Partial<SyncLog> = {};

    await performSync(db, {
      pullFirst: true,
      log,
      pullChanges: pullOf({ tasks: { created: [], updated: [remote('c1', { title: 'server title 2', priority: 7 })], deleted: [] } }),
      pushChanges: async ({ changes }) => {
        pushed = changes;
      },
      onConflict: (local, merged) => {
        seen.push([local, merged]);
        return { ...merged, notes: 'resolved by handler' } as RawRecord;
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toMatchObject({ title: 'local title', priority: 1, _status: 'updated', _changed: 'title' });
    expect(seen[0][1]).toMatchObject({ title: 'local title', priority: 7, _status: 'updated', _changed: 'title' });
    expect(pushed!.tasks.updated[0]).toMatchObject({ title: 'local title', priority: 7, notes: 'resolved by handler' });
    expect(await db._adapter.findById('tasks', 'c1')).toMatchObject({
      title: 'local title',
      priority: 7,
      notes: 'resolved by handler',
      _status: 'synced',
    });
    expect(log.resolvedConflicts).toBe(1);
    await db.close();
  });
});

// ─── Schema filtering on the regular path ───────────────────────────────

describe('pull payload schema filtering', () => {
  it('drops unknown tables and columns, coerces booleans and stringifies objects', async () => {
    const db = await createDb();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log: Partial<SyncLog> = {};

    await performSync(db, {
      log,
      pullChanges: pullOf({
        tasks: {
          created: [
            { id: 't1', title: 'ok', done: true, priority: 2, notes: { a: 1 }, ghost: 'x', _status: 'created' } as any,
          ],
          updated: [],
          deleted: [],
        },
        nope: { created: [{ id: 'n' } as any], updated: [], deleted: [] },
      }),
      pushChanges: noPush,
    });

    const row = await db._adapter.findById('tasks', 't1');
    expect(row).toMatchObject({ title: 'ok', done: 1, priority: 2, notes: JSON.stringify({ a: 1 }), _status: 'synced' });
    expect('ghost' in row!).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignored 1 unknown table(s) and dropped 1 unknown column'));
    expect(log.remoteChangeCount).toBe(1);
    warn.mockRestore();
    await db.close();
  });
});

// ─── Migration-aware pulls ──────────────────────────────────────────────

const TaskV3Schema = m.model('tasks', {
  title: m.text(),
  done: m.boolean().default(false),
  priority: m.number().default(0),
  notes: m.text().optional(),
  category: m.text().optional(),
});
class TaskV3 extends Model<typeof TaskV3Schema> {
  static schema = TaskV3Schema;
}
const TagSchema = m.model('tags', { name: m.text() });
class Tag extends Model<typeof TagSchema> {
  static schema = TagSchema;
}

const migrations: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    steps: [{ type: 'addColumns', table: 'tasks', columns: [{ name: 'category', type: 'text', isOptional: true, isIndexed: false }] }],
  },
  {
    fromVersion: 2,
    toVersion: 3,
    steps: [{ type: 'createTable', schema: { name: 'tags', columns: [{ name: 'name', type: 'text', isOptional: false, isIndexed: false }] } }],
  },
];

describe('migration-aware pull', () => {
  async function pullParams(db: Database, config: Partial<Parameters<typeof performSync>[1]> = {}) {
    const seen: SyncPullParams[] = [];
    await performSync(db, {
      pullChanges: async (params) => {
        seen.push(params);
        return { changes: {}, timestamp: 100 + seen.length };
      },
      pushChanges: noPush,
      ...config,
    });
    return seen[0];
  }

  async function migrationArg(db: Database, config: Partial<Parameters<typeof performSync>[1]> = {}) {
    const params = await pullParams(db, config);
    return params.migration;
  }

  it('sends migration: null when migrationsEnabledAtVersion is not set', async () => {
    const db = await createDb();
    expect(await migrationArg(db)).toBeNull();
    expect(await migrationArg(db)).toBeNull();
    await db.close();
  });

  it('sends migration: null on the first sync and records the schema version', async () => {
    const db = await createDb(undefined, { schemaVersion: 3 });
    expect(await migrationArg(db, { migrationsEnabledAtVersion: 1 })).toBeNull();
    expect(await db._adapter.getMetadata!('pomegranate_last_pulled_schema_version')).toBe('3');
    await db.close();
  });

  it('describes the tables and columns added since the last pull, then clears', async () => {
    const { default: Loki } = await import('lokijs');
    const instance = new Loki('mig-sync');
    const v1 = await createDb(instance, { schemaVersion: 1 });
    expect(await migrationArg(v1, { migrationsEnabledAtVersion: 1 })).toBeNull();
    expect(await v1._adapter.getMetadata!('pomegranate_last_pulled_schema_version')).toBe('1');

    const v3 = new Database({
      adapter: new LokiAdapter({ databaseName: 'v3', lokiInstance: instance }),
      models: [TaskV3, Tag, Project],
      schemaVersion: 3,
      migrations,
    });
    await v3.initialize();
    expect(v3.migrations).toBe(migrations);

    const log: Partial<SyncLog> = {};
    const params = await pullParams(v3, { migrationsEnabledAtVersion: 1, log });
    expect(params.lastPulledAt).toBe(101);
    expect(params.schemaVersion).toBe(3);
    expect(params.migration).toEqual({ from: 1, tables: ['tags'], columns: [{ table: 'tasks', columns: ['category'] }] });
    expect(log.migration).toEqual(params.migration);
    expect(log.lastPulledSchemaVersion).toBe(3);
    expect(await v3._adapter.getMetadata!('pomegranate_last_pulled_schema_version')).toBe('3');

    expect(await migrationArg(v3, { migrationsEnabledAtVersion: 1 })).toBeNull();
    await v3.close();
  });

  it('assumes migrationsEnabledAtVersion when no schema version was recorded', async () => {
    const db = await createDb(undefined, { schemaVersion: 3, migrations });
    await db._adapter.setMetadata!('pomegranate_last_pulled_at', '500');
    const params = await pullParams(db, { migrationsEnabledAtVersion: 2 });
    expect(params.migration).toEqual({ from: 2, tables: ['tags'], columns: [] });
    await db.close();
  });

  it('refuses to sync across a gap in the migration chain', async () => {
    const db = await createDb(undefined, { schemaVersion: 3, migrations: [migrations[1]] });
    await db._adapter.setMetadata!('pomegranate_last_pulled_at', '500');
    await db._adapter.setMetadata!('pomegranate_last_pulled_schema_version', '1');
    const log: Partial<SyncLog> = {};
    await expect(pullParams(db, { migrationsEnabledAtVersion: 1, log })).rejects.toThrow(
      /Missing migrations between schema versions 1 and 3 — cannot sync/,
    );
    expect(log.state).toBe('error');
    await db.close();
  });

  it('refuses a recorded schema version newer than the app', async () => {
    const db = await createDb(undefined, { schemaVersion: 2 });
    await db._adapter.setMetadata!('pomegranate_last_pulled_at', '500');
    await db._adapter.setMetadata!('pomegranate_last_pulled_schema_version', '3');
    await expect(pullParams(db, { migrationsEnabledAtVersion: 1 })).rejects.toThrow(/downgrades are not supported/);
    await db.close();
  });

  it('records the schema version after a turbo sync on SQLite', async () => {
    const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver: createBetterSqliteDriver() });
    const db = new Database({ adapter, models: [Task, Project], schemaVersion: 4 });
    await db.initialize();
    await db.sync({
      unsafeTurbo: true,
      pullChanges: async (params) => {
        expect(params.migration).toBeNull();
        return { syncJson: JSON.stringify({ changes: {}, timestamp: 9 }) };
      },
      pushChanges: noPush,
    });
    expect(await adapter.getMetadata('pomegranate_last_pulled_schema_version')).toBe('4');
    await db.close();
  });
});

// ─── Helpers and log shape ──────────────────────────────────────────────

describe('hasUnsyncedChanges', () => {
  it('reports pending changes, optionally per table', async () => {
    const db = await createDb();
    expect(await hasUnsyncedChanges(db)).toBe(false);
    await db.write(async () => {
      await db.get(Project).create({ name: 'p' });
    });
    expect(await hasUnsyncedChanges(db)).toBe(true);
    expect(await hasUnsyncedChanges(db, ['tasks'])).toBe(false);
    expect(await hasUnsyncedChanges(db, ['projects'])).toBe(true);
    await db.close();
  });
});

describe('SyncLog', () => {
  it('fills the WatermelonDB-like fields and mutates the log option in place', async () => {
    const db = await createDb();
    await db.write(async () => {
      await db.get(Task).create({ title: 'a' });
    });
    const log: Partial<SyncLog> = {};
    const phases: string[] = [];
    const unsubscribe = db.observeSyncLog().subscribe((l) => l?.phase && phases.push(l.phase));

    await db.sync({
      log,
      pullFirst: true,
      pullChanges: pullOf({ tasks: { created: [remote('r1'), remote('r2')], updated: [], deleted: ['gone'] } }, 777),
      pushChanges: noPush,
    });
    unsubscribe();

    expect(log).toMatchObject({
      state: 'complete',
      phase: 'done',
      lastPulledAt: null,
      newLastPulledAt: 777,
      pullTimestamp: 777,
      lastPulledSchemaVersion: 1,
      migration: null,
      remoteChangeCount: 3,
      localChangeCount: 1,
      pushedTables: ['tasks'],
    });
    expect(log.startedAt).toEqual(expect.any(Number));
    expect(log.finishedAt).toEqual(expect.any(Number));
    expect(phases).toEqual(
      expect.arrayContaining(['starting', 'pulling remote changes', 'applying remote changes', 'pushing local changes', 'done']),
    );
    await db.close();
  });

  it('sendCreatedAsUpdated pushes created records as updates', async () => {
    const db = await createDb();
    await db.write(async () => {
      await db.get(Task).create({ title: 'a' });
    });
    let pushed: SyncTableChanges | null = null;
    await performSync(db, {
      sendCreatedAsUpdated: true,
      pullChanges: pullOf({}),
      pushChanges: async ({ changes }) => {
        pushed = changes;
      },
    });
    expect(pushed!.tasks.created).toEqual([]);
    expect(pushed!.tasks.updated).toHaveLength(1);
    expect(pushed!.tasks.updated[0]).toMatchObject({ title: 'a', _status: 'synced', _changed: '' });
    expect(await hasUnsyncedChanges(db)).toBe(false);
    await db.close();
  });
});
