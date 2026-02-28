/**
 * Sync engine tests.
 *
 * Tests the full sync cycle: push local changes, pull remote changes,
 * conflict resolution, and lastPulledAt tracking.
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { performSync } from '../sync/sync';
import type { SyncConfig, SyncPullResult, SyncTableChanges, SyncPushPayload } from '../sync/types';
import type { RawRecord } from '../schema/types';

// ─── Test Schema ─────────────────────────────────────────────────────────

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
  color: m.text().default('blue'),
});

class Project extends Model<typeof ProjectSchema> {
  static schema = ProjectSchema;
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function createSyncDb() {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: 'sync-test.db' }),
    models: [Task, Project],
  });
  await db.initialize();
  return db;
}

function emptyChanges(): SyncTableChanges {
  return {};
}

function emptyTableChanges() {
  return { created: [], updated: [], deleted: [] as string[] };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Sync Engine', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createSyncDb();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Push local changes', () => {
    it('pushes newly created records', async () => {
      // Create a task
      await db.write(async () => {
        await db.get(Task).create({ title: 'Buy groceries', done: false });
      });

      let pushedChanges: SyncTableChanges | null = null;

      const config: SyncConfig = {
        pushChanges: async (payload: SyncPushPayload) => {
          pushedChanges = payload.changes;
        },
        pullChanges: async () => ({
          changes: emptyChanges(),
          timestamp: 1000,
        }),
      };

      await performSync(db, config);

      expect(pushedChanges).not.toBeNull();
      expect(pushedChanges!['tasks']).toBeDefined();
      expect(pushedChanges!['tasks'].created).toHaveLength(1);
      expect(pushedChanges!['tasks'].created[0].title).toBe('Buy groceries');
    });

    it('pushes updated records', async () => {
      const task = await db.write(async () => {
        return db.get(Task).create({ title: 'Buy groceries' });
      });

      // Simulate that this record was synced
      task._setRaw({ _status: 'synced', _changed: '' } as any);
      await db._adapter.update('tasks', {
        ...task._rawRecord,
        _status: 'synced',
        _changed: '',
      } as RawRecord);

      // Now update it
      await db.write(async () => {
        await task.update({ title: 'Buy organic groceries' });
      });

      let pushedChanges: SyncTableChanges | null = null;

      const config: SyncConfig = {
        pushChanges: async (payload) => {
          pushedChanges = payload.changes;
        },
        pullChanges: async () => ({
          changes: emptyChanges(),
          timestamp: 1000,
        }),
      };

      await performSync(db, config);

      expect(pushedChanges!['tasks'].updated).toHaveLength(1);
      expect(pushedChanges!['tasks'].updated[0].title).toBe('Buy organic groceries');
    });

    it('pushes deleted record IDs', async () => {
      const task = await db.write(async () => {
        return db.get(Task).create({ title: 'Ephemeral task' });
      });

      // Sync it first
      task._setRaw({ _status: 'synced', _changed: '' } as any);
      await db._adapter.update('tasks', {
        ...task._rawRecord,
        _status: 'synced',
        _changed: '',
      } as RawRecord);

      // Now soft-delete
      await db.write(async () => {
        await task.markAsDeleted();
      });

      let pushedChanges: SyncTableChanges | null = null;

      const config: SyncConfig = {
        pushChanges: async (payload) => {
          pushedChanges = payload.changes;
        },
        pullChanges: async () => ({
          changes: emptyChanges(),
          timestamp: 1000,
        }),
      };

      await performSync(db, config);

      expect(pushedChanges!['tasks'].deleted).toContain(task.id);
    });

    it('marks pushed records as synced', async () => {
      const task = await db.write(async () => {
        return db.get(Task).create({ title: 'Sync me' });
      });

      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async () => ({
          changes: emptyChanges(),
          timestamp: 1000,
        }),
      };

      expect(task.syncStatus).toBe('created');
      await performSync(db, config);

      // After sync, the adapter should have marked the record as synced
      const raw = await db._adapter.findById('tasks', task.id);
      expect(raw!._status).toBe('synced');
    });

    it('permanently removes locally-deleted records after push', async () => {
      const task = await db.write(async () => {
        return db.get(Task).create({ title: 'Delete me' });
      });
      const taskId = task.id;

      // Sync it, then delete it
      task._setRaw({ _status: 'synced', _changed: '' } as any);
      await db._adapter.update('tasks', {
        ...task._rawRecord,
        _status: 'synced',
        _changed: '',
      } as RawRecord);
      await db.write(async () => {
        await task.markAsDeleted();
      });

      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async () => ({
          changes: emptyChanges(),
          timestamp: 1000,
        }),
      };

      await performSync(db, config);

      // Record should be permanently removed
      const raw = await db._adapter.findById('tasks', taskId);
      expect(raw).toBeNull();
    });

    it('does not push when there are no local changes', async () => {
      let pushCalled = false;

      const config: SyncConfig = {
        pushChanges: async () => {
          pushCalled = true;
        },
        pullChanges: async () => ({
          changes: emptyChanges(),
          timestamp: 1000,
        }),
      };

      await performSync(db, config);
      expect(pushCalled).toBe(false);
    });

    it('strips _status and _changed from push payload', async () => {
      await db.write(async () => {
        await db.get(Task).create({ title: 'Check payload' });
      });

      let pushedRecord: RawRecord | null = null;

      const config: SyncConfig = {
        pushChanges: async (payload) => {
          pushedRecord = payload.changes['tasks']?.created?.[0] ?? null;
        },
        pullChanges: async () => ({
          changes: emptyChanges(),
          timestamp: 1000,
        }),
      };

      await performSync(db, config);

      // _status and _changed should be sanitized (set to synced/'')
      expect(pushedRecord).not.toBeNull();
      expect(pushedRecord!._status).toBe('synced');
      expect(pushedRecord!._changed).toBe('');
    });
  });

  describe('Pull remote changes', () => {
    it('applies remotely created records', async () => {
      const remoteTask: RawRecord = {
        id: 'remote-1',
        title: 'Remote task',
        done: false,
        priority: 1,
        _status: 'synced',
        _changed: '',
      };

      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async () => ({
          changes: {
            tasks: {
              created: [remoteTask],
              updated: [],
              deleted: [],
            },
          },
          timestamp: 2000,
        }),
      };

      await performSync(db, config);

      const found = await db._adapter.findById('tasks', 'remote-1');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Remote task');
      expect(found!._status).toBe('synced');
    });

    it('applies remotely updated records', async () => {
      // Create a local synced record
      const task = await db.write(async () => {
        return db.get(Task).create({ title: 'Original' });
      });
      const taskId = task.id;

      // Mark as synced
      await db._adapter.update('tasks', {
        ...task._rawRecord,
        _status: 'synced',
        _changed: '',
      } as RawRecord);

      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async () => ({
          changes: {
            tasks: {
              created: [],
              updated: [
                {
                  id: taskId,
                  title: 'Updated remotely',
                  done: false,
                  priority: 0,
                  _status: 'synced',
                  _changed: '',
                },
              ],
              deleted: [],
            },
          },
          timestamp: 2000,
        }),
      };

      await performSync(db, config);

      const found = await db._adapter.findById('tasks', taskId);
      expect(found!.title).toBe('Updated remotely');
    });

    it('applies remotely deleted records', async () => {
      const task = await db.write(async () => {
        return db.get(Task).create({ title: 'Will be deleted remotely' });
      });
      const taskId = task.id;

      await db._adapter.update('tasks', {
        ...task._rawRecord,
        _status: 'synced',
        _changed: '',
      } as RawRecord);

      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async () => ({
          changes: {
            tasks: {
              created: [],
              updated: [],
              deleted: [taskId],
            },
          },
          timestamp: 2000,
        }),
      };

      await performSync(db, config);

      const found = await db._adapter.findById('tasks', taskId);
      expect(found).toBeNull();
    });
  });

  describe('Conflict resolution', () => {
    it('calls onConflict when both local and remote modified a record', async () => {
      const task = await db.write(async () => {
        return db.get(Task).create({ title: 'Base title' });
      });
      const taskId = task.id;

      // Mark as synced, then update locally
      task._setRaw({ ...task._rawRecord, _status: 'synced', _changed: '' } as any);
      await db._adapter.update('tasks', {
        ...task._rawRecord,
        _status: 'synced',
        _changed: '',
      } as RawRecord);

      await db.write(async () => {
        await task.update({ title: 'Local edit' });
      });

      let conflictCalled = false;

      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async () => ({
          changes: {
            tasks: {
              created: [],
              updated: [
                {
                  id: taskId,
                  title: 'Remote edit',
                  done: true,
                  priority: 5,
                  _status: 'synced',
                  _changed: '',
                },
              ],
              deleted: [],
            },
          },
          timestamp: 2000,
        }),
        onConflict: (local, remote) => {
          conflictCalled = true;
          // Merge: keep local title, take remote done/priority
          return {
            ...remote,
            title: local.title,
          } as RawRecord;
        },
      };

      await performSync(db, config);

      expect(conflictCalled).toBe(true);
      const found = await db._adapter.findById('tasks', taskId);
      expect(found!.title).toBe('Local edit');
      expect(found!.done).toBe(true);
      expect(found!.priority).toBe(5);
    });

    it('uses server version when no onConflict handler', async () => {
      const task = await db.write(async () => {
        return db.get(Task).create({ title: 'Base' });
      });
      const taskId = task.id;

      task._setRaw({ ...task._rawRecord, _status: 'synced', _changed: '' } as any);
      await db._adapter.update('tasks', {
        ...task._rawRecord,
        _status: 'synced',
        _changed: '',
      } as RawRecord);

      await db.write(async () => {
        await task.update({ title: 'Local' });
      });

      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async () => ({
          changes: {
            tasks: {
              created: [],
              updated: [
                {
                  id: taskId,
                  title: 'Server wins',
                  done: false,
                  priority: 0,
                  _status: 'synced',
                  _changed: '',
                },
              ],
              deleted: [],
            },
          },
          timestamp: 2000,
        }),
        // No onConflict — server version is applied as-is
      };

      await performSync(db, config);

      const found = await db._adapter.findById('tasks', taskId);
      expect(found!.title).toBe('Server wins');
    });
  });

  describe('Multi-table sync', () => {
    it('syncs changes across multiple tables', async () => {
      await db.write(async () => {
        await db.get(Task).create({ title: 'New task' });
        await db.get(Project).create({ name: 'New project' });
      });

      let pushedTables: string[] = [];

      const config: SyncConfig = {
        pushChanges: async (payload) => {
          pushedTables = Object.keys(payload.changes).filter(
            (t) => payload.changes[t].created.length > 0,
          );
        },
        pullChanges: async () => ({
          changes: {
            tasks: {
              created: [
                {
                  id: 'remote-task-1',
                  title: 'Remote task',
                  done: false,
                  priority: 0,
                  _status: 'synced',
                  _changed: '',
                },
              ],
              updated: [],
              deleted: [],
            },
            projects: {
              created: [
                {
                  id: 'remote-proj-1',
                  name: 'Remote project',
                  color: 'red',
                  _status: 'synced',
                  _changed: '',
                },
              ],
              updated: [],
              deleted: [],
            },
          },
          timestamp: 3000,
        }),
      };

      await performSync(db, config);

      expect(pushedTables).toContain('tasks');
      expect(pushedTables).toContain('projects');

      const remoteTask = await db._adapter.findById('tasks', 'remote-task-1');
      const remoteProj = await db._adapter.findById('projects', 'remote-proj-1');
      expect(remoteTask).not.toBeNull();
      expect(remoteProj).not.toBeNull();
    });

    it('syncs only specified tables when tables option is set', async () => {
      await db.write(async () => {
        await db.get(Task).create({ title: 'Task' });
        await db.get(Project).create({ name: 'Project' });
      });

      let pushedTables: string[] = [];

      const config: SyncConfig = {
        tables: ['tasks'], // Only sync tasks
        pushChanges: async (payload) => {
          pushedTables = Object.keys(payload.changes);
        },
        pullChanges: async () => ({
          changes: emptyChanges(),
          timestamp: 3000,
        }),
      };

      await performSync(db, config);

      expect(pushedTables).toContain('tasks');
      expect(pushedTables).not.toContain('projects');
    });
  });

  describe('lastPulledAt tracking', () => {
    it('passes null for first sync', async () => {
      let receivedLastPulledAt: number | null = 'UNSET' as any;

      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async ({ lastPulledAt }) => {
          receivedLastPulledAt = lastPulledAt;
          return { changes: emptyChanges(), timestamp: 1000 };
        },
      };

      await performSync(db, config);
      expect(receivedLastPulledAt).toBeNull();
    });

    it('passes previous timestamp on subsequent syncs', async () => {
      const timestamps: (number | null)[] = [];

      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async ({ lastPulledAt }) => {
          timestamps.push(lastPulledAt);
          return { changes: emptyChanges(), timestamp: 1000 };
        },
      };

      await performSync(db, config);
      await performSync(db, config);

      expect(timestamps[0]).toBeNull(); // First sync
      expect(timestamps[1]).toBe(1000); // Second sync uses previous timestamp
    });
  });

  describe('Error handling', () => {
    it('propagates push errors', async () => {
      await db.write(async () => {
        await db.get(Task).create({ title: 'Will fail to push' });
      });

      const config: SyncConfig = {
        pushChanges: async () => {
          throw new Error('Network error');
        },
        pullChanges: async () => ({
          changes: emptyChanges(),
          timestamp: 1000,
        }),
      };

      await expect(performSync(db, config)).rejects.toThrow('Network error');
    });

    it('propagates pull errors', async () => {
      const config: SyncConfig = {
        pushChanges: async () => {},
        pullChanges: async () => {
          throw new Error('Server down');
        },
      };

      await expect(performSync(db, config)).rejects.toThrow('Server down');
    });
  });
});
