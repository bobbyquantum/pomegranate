/**
 * Sync engine edge cases not covered by the main sync suites:
 *  - legacy lastPulledAt fallback for adapters without getMetadata/setMetadata
 *  - malformed metadata and pull results, non-Error failures, the `log` option
 *  - push results: rejectedIds / experimentalRejectedIds, sendCreatedAsUpdated
 *  - mark-as-synced guards (record changed in flight, table without collection)
 *  - migration-aware pull errors
 *  - onConflict with a `tables` subset, untouched remote records and remote deletes
 *  - turbo mode with parsed changes, without adapter support, non-Error failure
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import type { DatabaseConfig } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import type { StorageAdapter } from '../adapters/types';
import {
  performSync,
  getLastPulledAt,
  setLastPulledAt,
  getLastPulledSchemaVersion,
  hasUnsyncedChanges,
} from '../sync/sync';
import type { SyncLog, SyncPullParams, SyncPushPayload, SyncTableChanges } from '../sync/types';
import type { RawRecord } from '../schema/types';
import { logger } from '../utils';

// ─── Schema ─────────────────────────────────────────────────────────────

const TaskSchema = m.model('tasks', {
  title: m.text(),
  done: m.boolean().default(false),
  priority: m.number().default(0),
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

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * A StorageAdapter made of `base`'s bound methods, minus `hidden` ones, with
 * `overrides` on top. Lets a test pretend the adapter lacks an optional
 * capability or misbehaves in one specific call.
 */
function wrapAdapter(
  base: StorageAdapter,
  options: { hidden?: Array<keyof StorageAdapter>; overrides?: Partial<StorageAdapter> } = {},
): StorageAdapter {
  const wrapper: Record<string, unknown> = {};
  const hidden = new Set<string>(options.hidden);
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(base))) {
    const value = (base as unknown as Record<string, unknown>)[key];
    if (key === 'constructor' || typeof value !== 'function' || hidden.has(key)) continue;
    wrapper[key] = (value as (...args: unknown[]) => unknown).bind(base);
  }
  Object.assign(wrapper, options.overrides);
  return wrapper as unknown as StorageAdapter;
}

let counter = 0;
async function createDb(over: Partial<DatabaseConfig> = {}): Promise<Database> {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: `cov-sync-${counter++}` }),
    models: [Task, Project],
    ...over,
  });
  await db.initialize();
  return db;
}

const noPush = async () => {};
const emptyPull = (timestamp: number) => async () => ({ changes: {}, timestamp });
const table = (over: Partial<SyncTableChanges[string]> = {}) => ({
  created: [],
  updated: [],
  deleted: [],
  ...over,
});

async function createTask(db: Database, title: string, priority = 0): Promise<Task> {
  return db.write(() => db.get<Task>(Task).create({ title, priority }));
}

/** Push-first sync with an empty pull: marks everything local as synced. */
async function syncClean(db: Database, timestamp = 1000): Promise<void> {
  await performSync(db, { pullChanges: emptyPull(timestamp), pushChanges: noPush });
}

async function rawTask(db: Database, id: string): Promise<RawRecord | null> {
  return db._adapter.findById('tasks', id);
}

/** The stored `_status` of a task, as the adapter sees it (undefined when gone). */
async function statusOf(db: Database, id: string): Promise<string | undefined> {
  const raw = await rawTask(db, id);
  return raw?._status;
}

// ─── Legacy metadata fallback ───────────────────────────────────────────

describe('lastPulledAt without adapter metadata support', () => {
  it('stores the checkpoint as a metadata record and updates it on later syncs', async () => {
    const base = new LokiAdapter({ databaseName: 'legacy-meta' });
    const adapter = wrapAdapter(base, { hidden: ['getMetadata', 'setMetadata'] });
    const db = new Database({ adapter, models: [Task] });
    await db.initialize();

    expect(await getLastPulledAt(db)).toBeNull();
    await setLastPulledAt(db, 100); // first write: creates the record
    expect(await getLastPulledAt(db)).toBe(100);
    await setLastPulledAt(db, 200); // second write: create fails on the unique key → update
    expect(await getLastPulledAt(db)).toBe(200);

    const seen: Array<number | null> = [];
    await performSync(db, {
      pullChanges: async ({ lastPulledAt }) => {
        seen.push(lastPulledAt);
        return { changes: {}, timestamp: 300 };
      },
      pushChanges: noPush,
    });
    expect(seen).toEqual([200]);
    expect(await getLastPulledAt(db)).toBe(300);
    // The schema version checkpoint needs real metadata support.
    expect(await getLastPulledSchemaVersion(db)).toBeNull();
    await db.close();
  });

  it('treats a non-numeric or unreadable record as "never pulled"', async () => {
    const base = new LokiAdapter({ databaseName: 'legacy-meta-bad' });
    const adapter = wrapAdapter(base, { hidden: ['getMetadata', 'setMetadata'] });
    const db = new Database({ adapter, models: [Task] });
    await db.initialize();

    await setLastPulledAt(db, 100);
    await adapter.update('__pomegranate_metadata', {
      id: 'pomegranate_last_pulled_at',
      key: 'pomegranate_last_pulled_at',
      value: 'not a number',
    } as unknown as RawRecord);
    expect(await getLastPulledAt(db)).toBeNull();

    const broken = new Database({
      adapter: wrapAdapter(base, {
        hidden: ['getMetadata', 'setMetadata'],
        overrides: {
          findById: async () => {
            throw new Error('no metadata table');
          },
        },
      }),
      models: [Task],
    });
    expect(await getLastPulledAt(broken)).toBeNull();
    await db.close();
  });

  it('gives up quietly when neither create nor update can persist the checkpoint', async () => {
    const base = new LokiAdapter({ databaseName: 'legacy-meta-ro' });
    const adapter = wrapAdapter(base, {
      hidden: ['getMetadata', 'setMetadata'],
      overrides: {
        update: async () => {
          throw new Error('read-only');
        },
      },
    });
    const db = new Database({ adapter, models: [Task] });
    await db.initialize();

    await setLastPulledAt(db, 100);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(setLastPulledAt(db, 200)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Could not persist lastPulledAt timestamp');
    warn.mockRestore();
    expect(await getLastPulledAt(db)).toBe(100);
    await db.close();
  });
});

describe('malformed metadata', () => {
  it('ignores non-numeric lastPulledAt and non-positive schema versions', async () => {
    const db = await createDb();
    await db._adapter.setMetadata!('pomegranate_last_pulled_at', 'garbage');
    await db._adapter.setMetadata!('pomegranate_last_pulled_schema_version', '0');
    expect(await getLastPulledAt(db)).toBeNull();
    expect(await getLastPulledSchemaVersion(db)).toBeNull();

    const seen: SyncPullParams[] = [];
    const log: Partial<SyncLog> = {};
    await performSync(db, {
      pullChanges: async (params) => {
        seen.push(params);
        return { changes: {}, timestamp: 5 };
      },
      pushChanges: noPush,
      log,
    });
    expect(seen[0].lastPulledAt).toBeNull();
    expect(log.lastPulledAt).toBeNull();
    expect('lastPulledSchemaVersion' in log && log.lastPulledSchemaVersion).toBe(db.schemaVersion);
    await db.close();
  });
});

// ─── Pull result validation, failures, log option ───────────────────────

describe('pull result handling', () => {
  it('rejects a pull result without a numeric timestamp and records it in the log', async () => {
    const db = await createDb();
    const log: Partial<SyncLog> = {};
    await expect(
      performSync(db, { pullChanges: async () => ({ changes: {} }) as any, pushChanges: noPush, log }),
    ).rejects.toThrow(TypeError);
    expect(log.state).toBe('error');
    expect(log.error).toMatch(/no numeric "timestamp"/);
    expect(log.finishedAt).toBeGreaterThanOrEqual(log.startedAt!);
    await db.close();
  });

  it('accepts a pull result without a changes map', async () => {
    const db = await createDb();
    const log: Partial<SyncLog> = {};
    await performSync(db, { pullChanges: async () => ({ timestamp: 7 }) as any, pushChanges: noPush, log });
    expect(log).toMatchObject({ state: 'complete', phase: 'done', remoteChangeCount: 0, newLastPulledAt: 7 });
    expect(await getLastPulledAt(db)).toBe(7);
    await db.close();
  });

  it('stringifies non-Error failures for the log and the database event', async () => {
    const db = await createDb();
    const log: Partial<SyncLog> = {};
    const events: unknown[] = [];
    db.events$.subscribe((event) => events.push(event));
    await expect(
      db.sync({ pullChanges: () => Promise.reject('server said no'), pushChanges: noPush, log }),
    ).rejects.toBe('server said no');
    expect(log.error).toBe('server said no');
    expect(log.phase).toBe('failed: server said no');
    expect(events).toContainEqual({ type: 'sync_failed', error: 'server said no' });
    await db.close();
  });
});

// ─── Push results ───────────────────────────────────────────────────────

describe('push results', () => {
  it('treats an empty result object and empty rejection lists as "nothing rejected"', async () => {
    const db = await createDb();
    const a = await createTask(db, 'a');
    const log1: Partial<SyncLog> = {};
    await performSync(db, { pullChanges: emptyPull(1), pushChanges: async () => ({}), log: log1 });
    expect(log1.rejectedIds).toBeUndefined();
    expect(await statusOf(db, a.id)).toBe('synced');

    const b = await createTask(db, 'b');
    const log2: Partial<SyncLog> = {};
    await performSync(db, {
      pullChanges: emptyPull(2),
      pushChanges: async () => ({ rejectedIds: { tasks: [], projects: [] } }),
      log: log2,
    });
    expect(log2.rejectedIds).toBeUndefined();
    expect(await statusOf(db, b.id)).toBe('synced');
    await db.close();
  });

  it('leaves experimentalRejectedIds unsynced so they are pushed again', async () => {
    const db = await createDb();
    const kept = await createTask(db, 'kept');
    const rejected = await createTask(db, 'rejected');
    const log: Partial<SyncLog> = {};
    await performSync(db, {
      pullChanges: emptyPull(1),
      pushChanges: async () => ({ experimentalRejectedIds: { tasks: [rejected.id] } }),
      log,
    });
    expect(log.rejectedIds).toEqual({ tasks: [rejected.id] });
    expect(log.pushedTables).toEqual(['tasks']);
    expect(await statusOf(db, kept.id)).toBe('synced');
    expect(await statusOf(db, rejected.id)).toBe('created');
    expect(rejected.syncStatus).toBe('created');
    expect(kept.syncStatus).toBe('synced');

    const payloads: SyncPushPayload[] = [];
    await performSync(db, {
      pullChanges: emptyPull(2),
      pushChanges: async (payload) => {
        payloads.push(payload);
      },
    });
    expect(payloads[0].changes.tasks.created.map((r) => r.id)).toEqual([rejected.id]);
    await db.close();
  });

  it('keeps a rejected deletion as a pending delete', async () => {
    const db = await createDb();
    const task = await createTask(db, 'doomed');
    await syncClean(db);
    await db.write(() => task.markAsDeleted());

    await performSync(db, {
      pullChanges: emptyPull(2),
      pushChanges: async () => ({ rejectedIds: { tasks: [task.id] } }),
    });
    expect(await statusOf(db, task.id)).toBe('deleted');
    expect(await hasUnsyncedChanges(db, ['tasks'])).toBe(true);
    expect(await hasUnsyncedChanges(db, ['projects'])).toBe(false);

    await performSync(db, { pullChanges: emptyPull(3), pushChanges: noPush });
    expect(await rawTask(db, task.id)).toBeNull();
    expect(await hasUnsyncedChanges(db)).toBe(false);
    await db.close();
  });

  it('reports created records as updates with sendCreatedAsUpdated', async () => {
    const db = await createDb();
    const created = await createTask(db, 'new');
    const edited = await createTask(db, 'old');
    await syncClean(db);
    await db.write(() => edited.update({ title: 'old (edited)' }));
    const fresh = await createTask(db, 'fresh');

    const payloads: SyncPushPayload[] = [];
    await performSync(db, {
      pullChanges: emptyPull(2),
      pushChanges: async (payload) => {
        payloads.push(payload);
      },
      sendCreatedAsUpdated: true,
    });
    const tasks = payloads[0].changes.tasks;
    expect(tasks.created).toEqual([]);
    expect(tasks.updated.map((r) => r.id)).toEqual([fresh.id, edited.id]);
    expect(tasks.updated.every((r) => r._status === 'synced' && r._changed === '')).toBe(true);
    expect(await statusOf(db, created.id)).toBe('synced');
    await db.close();
  });
});

// ─── Marking pushed records as synced ───────────────────────────────────

describe('marking pushed records as synced', () => {
  it('does not mark a record whose row changed shape while the push was in flight', async () => {
    const base = new LokiAdapter({ databaseName: 'inflight-shape' });
    let calls = 0;
    const adapter = wrapAdapter(base, {
      overrides: {
        getLocalChanges: async (tables) => {
          const result = await base.getLocalChanges(tables);
          calls++;
          if (calls === 2) {
            // The second read is the post-push verification: hand back a row
            // with an extra column so it no longer equals the snapshot.
            result.tasks.created = result.tasks.created.map((raw) => ({ ...raw, extra: 1 }) as RawRecord);
          }
          return result;
        },
      },
    });
    const db = new Database({ adapter, models: [Task] });
    await db.initialize();
    const task = await createTask(db, 'moving target');
    await performSync(db, { pullChanges: emptyPull(1), pushChanges: noPush });
    expect(calls).toBe(2);
    expect(await statusOf(db, task.id)).toBe('created');
    await db.close();
  });

  it('does not mark anything when the table vanished from the post-push read', async () => {
    const base = new LokiAdapter({ databaseName: 'inflight-missing' });
    let calls = 0;
    const adapter = wrapAdapter(base, {
      overrides: {
        getLocalChanges: async (tables) => {
          const result = await base.getLocalChanges(tables);
          if (++calls === 2) delete result.tasks;
          return result;
        },
      },
    });
    const db = new Database({ adapter, models: [Task] });
    await db.initialize();
    const task = await createTask(db, 'gone');
    await performSync(db, { pullChanges: emptyPull(1), pushChanges: noPush });
    expect(await statusOf(db, task.id)).toBe('created');
    await db.close();
  });

  it('marks changes of a table that has no registered collection', async () => {
    const base = new LokiAdapter({ databaseName: 'ghost-table' });
    const ghost = {
      created: [{ id: 'g1', _status: 'created', _changed: '', name: 'x' } as unknown as RawRecord],
      updated: [],
      deleted: ['g2'],
    };
    const marked: Array<[string, string[]]> = [];
    const destroyed: Array<[string, string]> = [];
    const adapter = wrapAdapter(base, {
      overrides: {
        getLocalChanges: async (tables) => ({
          ...(await base.getLocalChanges(tables.filter((t) => t !== 'ghost'))),
          ghost,
        }),
        markAsSynced: async (t, ids) => {
          if (t === 'ghost') marked.push([t, ids]);
          else await base.markAsSynced(t, ids);
        },
        destroyPermanently: async (t, id) => {
          if (t === 'ghost') destroyed.push([t, id]);
          else await base.destroyPermanently(t, id);
        },
      },
    });
    const db = new Database({ adapter, models: [Task] });
    await db.initialize();
    const payloads: SyncPushPayload[] = [];
    const log: Partial<SyncLog> = {};
    await performSync(db, {
      pullChanges: emptyPull(1),
      pushChanges: async (payload) => {
        payloads.push(payload);
      },
      log,
    });
    expect(payloads[0].changes.ghost.created[0]).toMatchObject({ id: 'g1', _status: 'synced' });
    expect(marked).toEqual([['ghost', ['g1']]]);
    expect(destroyed).toEqual([['ghost', 'g2']]);
    expect(log.localChangeCount).toBe(2);
    expect(log.pushedTables).toBeUndefined(); // only configured tables are reported
    await db.close();
  });
});

// ─── Migration-aware pulls ──────────────────────────────────────────────

describe('migration-aware pull errors', () => {
  it('rejects migrationsEnabledAtVersion above the schema version', async () => {
    const db = await createDb({ schemaVersion: 2 });
    await syncClean(db);
    await expect(
      performSync(db, { pullChanges: emptyPull(2), pushChanges: noPush, migrationsEnabledAtVersion: 5 }),
    ).rejects.toThrow('migrationsEnabledAtVersion (5) is greater than the schema version (2).');
    await db.close();
  });

  it('assumes migrationsEnabledAtVersion when no schema version was recorded, and needs the migrations', async () => {
    const db = await createDb({ schemaVersion: 3 });
    await db._adapter.setMetadata!('pomegranate_last_pulled_at', '1000');
    expect(db.migrations).toEqual([]);
    await expect(
      performSync(db, { pullChanges: emptyPull(2), pushChanges: noPush, migrationsEnabledAtVersion: 1 }),
    ).rejects.toThrow(/Missing migrations between schema versions 1 and 3 — cannot sync/);

    const migrated = await createDb({
      schemaVersion: 3,
      migrations: [
        { fromVersion: 1, toVersion: 2, steps: [{ type: 'addColumn', table: 'tasks', column: 'priority', columnType: 'REAL' }] },
        { fromVersion: 2, toVersion: 3, steps: [{ type: 'createTable', schema: { name: 'projects', columns: [] } }] },
      ],
    });
    await migrated._adapter.setMetadata!('pomegranate_last_pulled_at', '1000');
    const seen: SyncPullParams[] = [];
    await performSync(migrated, {
      pullChanges: async (params) => {
        seen.push(params);
        return { changes: {}, timestamp: 2000 };
      },
      pushChanges: noPush,
      migrationsEnabledAtVersion: 1,
    });
    expect(seen[0].migration).toEqual({ from: 1, tables: ['projects'], columns: [{ table: 'tasks', columns: ['priority'] }] });
    await db.close();
    await migrated.close();
  });
});

// ─── onConflict ─────────────────────────────────────────────────────────

describe('onConflict', () => {
  it('push-first with a tables subset: resolves edited records, leaves other tables and untouched ids alone', async () => {
    const db = await createDb();
    const edited = await createTask(db, 'local title', 1);
    await syncClean(db);
    await db.write(() => edited.update({ title: 'local edit' }));

    const seen: Array<[RawRecord, RawRecord]> = [];
    const log: Partial<SyncLog> = {};
    await performSync(db, {
      tables: ['tasks'],
      onConflict: (local, merged) => {
        seen.push([local, merged]);
        return { ...merged, title: `${local.title} + ${merged.title}` };
      },
      pullChanges: async () => ({
        timestamp: 2,
        changes: {
          tasks: table({
            updated: [{ id: edited.id, title: 'server edit', done: true, priority: 9 } as unknown as RawRecord],
            created: [{ id: 'server-only', title: 'untouched', done: false, priority: 0 } as unknown as RawRecord],
          }),
          projects: table({ created: [{ id: 'p1', name: 'Proj' } as unknown as RawRecord] }),
        },
      }),
      pushChanges: noPush,
      log,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toMatchObject({ id: edited.id, title: 'local edit', _status: 'updated' });
    // Push-first: the local edit was already pushed, so the merge input is the remote record.
    expect(seen[0][1]).toMatchObject({ id: edited.id, title: 'server edit', priority: 9 });
    expect(await rawTask(db, edited.id)).toMatchObject({
      title: 'local edit + server edit',
      priority: 9,
      _status: 'synced',
      _changed: '',
    });
    expect(await rawTask(db, 'server-only')).toMatchObject({ title: 'untouched', _status: 'synced' });
    expect(await db._adapter.findById('projects', 'p1')).toMatchObject({ name: 'Proj' });
    expect(log.resolvedConflicts).toBe(1);
    expect(log.pushedTables).toEqual(['tasks']);
    await db.close();
  });

  it('pull-first: a remote record that is also remotely deleted is not resolved, resolved ones are pushed', async () => {
    const db = await createDb();
    const edited = await createTask(db, 'keep me', 1);
    const doomed = await createTask(db, 'doomed', 2);
    await syncClean(db);
    await db.write(async () => {
      await edited.update({ title: 'local edit' });
      await doomed.update({ title: 'local edit on doomed' });
    });

    const seen: RawRecord[] = [];
    const payloads: SyncPushPayload[] = [];
    const log: Partial<SyncLog> = {};
    await performSync(db, {
      pullFirst: true,
      onConflict: (local, merged) => {
        seen.push(local);
        return { ...merged, priority: 100 };
      },
      pullChanges: async () => ({
        timestamp: 2,
        changes: {
          tasks: table({
            updated: [
              { id: edited.id, title: 'server edit', done: true, priority: 9 } as unknown as RawRecord,
              { id: doomed.id, title: 'server edit', done: false, priority: 9 } as unknown as RawRecord,
            ],
            deleted: [doomed.id],
          }),
          projects: table({ created: [{ id: 'p1', name: 'Proj' } as unknown as RawRecord] }),
        },
      }),
      pushChanges: async (payload) => {
        payloads.push(payload);
      },
      log,
    });

    expect(seen.map((r) => r.id)).toEqual([edited.id]);
    expect(await rawTask(db, doomed.id)).toBeNull();
    expect(log.resolvedConflicts).toBe(1);
    // Pull-first keeps the local status so the resolved record goes out in the push...
    const pushed = payloads[0].changes.tasks.updated;
    expect(pushed.map((r) => r.id)).toEqual([edited.id]);
    // `done` came from the server (stored as 0/1), `priority` from onConflict, `title` is the local edit.
    expect(pushed[0]).toMatchObject({ title: 'local edit', done: 1, priority: 100 });
    // ...after which it is synced.
    expect(await rawTask(db, edited.id)).toMatchObject({ priority: 100, _status: 'synced', _changed: '' });
    await db.close();
  });
});

// ─── Turbo ──────────────────────────────────────────────────────────────

describe('unsafeTurbo', () => {
  it('applies parsed changes the regular way when the server returns them', async () => {
    const db = await createDb();
    const log: Partial<SyncLog> = {};
    await performSync(db, {
      unsafeTurbo: true,
      pullChanges: async () => ({
        timestamp: 10,
        changes: {
          tasks: table({ created: [{ id: 't1', title: 'turbo', done: false, priority: 1, extra: 'x' } as unknown as RawRecord] }),
          unknown_table: table({ created: [{ id: 'u' } as unknown as RawRecord] }),
        },
      }),
      pushChanges: noPush,
      log,
    });
    expect(log).toMatchObject({ state: 'complete', remoteChangeCount: 1, newLastPulledAt: 10, migration: null });
    expect(log.turbo).toBeUndefined();
    const raw = await rawTask(db, 't1');
    expect(raw).toMatchObject({ title: 'turbo', _status: 'synced' });
    expect(raw && 'extra' in raw).toBe(false);
    expect(await getLastPulledAt(db)).toBe(10);
    await db.close();
  });

  it('tolerates parsed results without a changes map', async () => {
    const db = await createDb();
    await performSync(db, {
      unsafeTurbo: true,
      pullChanges: async () => ({ timestamp: 11 }) as any,
      pushChanges: noPush,
    });
    expect(await getLastPulledAt(db)).toBe(11);
    await db.close();
  });

  it('fails when the adapter cannot import a payload', async () => {
    const base = new LokiAdapter({ databaseName: 'no-turbo' });
    const db = new Database({ adapter: wrapAdapter(base, { hidden: ['applySyncJson'] }), models: [Task] });
    await db.initialize();
    const log: Partial<SyncLog> = {};
    await expect(
      performSync(db, { unsafeTurbo: true, pullChanges: async () => ({ syncJson: '{}' }), pushChanges: noPush, log }),
    ).rejects.toThrow(/does not support turbo sync/);
    expect(log.state).toBe('error');
    expect(await getLastPulledAt(db)).toBeNull();
    await db.close();
  });

  it('stringifies non-Error failures', async () => {
    const db = await createDb();
    const log: Partial<SyncLog> = {};
    await expect(
      performSync(db, { unsafeTurbo: true, pullChanges: () => Promise.reject('offline'), pushChanges: noPush, log }),
    ).rejects.toBe('offline');
    expect(log.error).toBe('offline');
    expect(log.phase).toBe('failed: offline');
    await db.close();
  });
});
