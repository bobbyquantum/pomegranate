/**
 * Web Worker protocol tests.
 *
 * Exercises the LokiAdapter in worker mode using SynchronousWorker,
 * verifying the full message protocol (dispatch → execute → respond).
 */

import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { SynchronousWorker } from '../adapters/loki/worker/SynchronousWorker';
import type { DatabaseSchema, RawRecord } from '../schema/types';
import type { QueryDescriptor } from '../query/types';

const testSchema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'tasks',
      columns: [
        { name: 'id', type: 'text' as any, isOptional: false, isIndexed: false },
        { name: 'title', type: 'text' as any, isOptional: false, isIndexed: true },
        { name: 'done', type: 'boolean' as any, isOptional: false, isIndexed: false },
        { name: '_status', type: 'text' as any, isOptional: false, isIndexed: true },
        { name: '_changed', type: 'text' as any, isOptional: false, isIndexed: false },
      ],
    },
  ],
};

function makeRaw(id: string, title: string, done = false): RawRecord {
  return { id, title, done: done ? 1 : 0, _status: 'created', _changed: '' } as RawRecord;
}

function allQuery(table = 'tasks'): QueryDescriptor {
  return { table, conditions: [], orderBy: [], joins: [] };
}

describe('LokiAdapter (Worker mode via SynchronousWorker)', () => {
  let adapter: LokiAdapter;

  beforeEach(async () => {
    adapter = new LokiAdapter({
      databaseName: 'worker-test',
      worker: new SynchronousWorker(),
    });
    await adapter.initialize(testSchema);
  });

  afterEach(async () => {
    await adapter.close();
  });

  // ─── Basic CRUD ────────────────────────────────────────────────────

  it('inserts and finds records via worker', async () => {
    await adapter.insert('tasks', makeRaw('t1', 'Buy milk'));
    await adapter.insert('tasks', makeRaw('t2', 'Walk dog'));

    const results = await adapter.find(allQuery());
    expect(results).toHaveLength(2);
    expect(results.map((r: any) => r.title).sort()).toEqual(['Buy milk', 'Walk dog']);
  });

  it('finds by ID via worker', async () => {
    await adapter.insert('tasks', makeRaw('t1', 'Buy milk'));

    const found = await adapter.findById('tasks', 't1');
    expect(found).toBeTruthy();
    expect((found as any).title).toBe('Buy milk');

    const notFound = await adapter.findById('tasks', 'nonexistent');
    expect(notFound).toBeNull();
  });

  it('updates records via worker', async () => {
    await adapter.insert('tasks', makeRaw('t1', 'Buy milk'));
    await adapter.update('tasks', { ...makeRaw('t1', 'Buy oat milk'), done: 1 } as RawRecord);

    const found = await adapter.findById('tasks', 't1');
    expect((found as any).title).toBe('Buy oat milk');
    expect((found as any).done).toBe(1);
  });

  it('marks as deleted via worker', async () => {
    await adapter.insert('tasks', makeRaw('t1', 'Buy milk'));
    await adapter.markAsDeleted('tasks', 't1');

    const found = await adapter.findById('tasks', 't1');
    expect((found as any)._status).toBe('deleted');
  });

  it('destroys permanently via worker', async () => {
    await adapter.insert('tasks', makeRaw('t1', 'Buy milk'));
    await adapter.destroyPermanently('tasks', 't1');

    const found = await adapter.findById('tasks', 't1');
    expect(found).toBeNull();
  });

  // ─── Count ─────────────────────────────────────────────────────────

  it('counts records via worker', async () => {
    await adapter.insert('tasks', makeRaw('t1', 'A'));
    await adapter.insert('tasks', makeRaw('t2', 'B'));
    await adapter.insert('tasks', makeRaw('t3', 'C'));

    const total = await adapter.count(allQuery());
    expect(total).toBe(3);
  });

  // ─── Batch ─────────────────────────────────────────────────────────

  it('executes batch operations via worker', async () => {
    await adapter.batch([
      { type: 'create', table: 'tasks', rawRecord: makeRaw('t1', 'A') },
      { type: 'create', table: 'tasks', rawRecord: makeRaw('t2', 'B') },
      { type: 'create', table: 'tasks', rawRecord: makeRaw('t3', 'C') },
    ]);

    let results = await adapter.find(allQuery());
    expect(results).toHaveLength(3);

    await adapter.batch([
      { type: 'update', table: 'tasks', rawRecord: { ...makeRaw('t1', 'A updated') } as RawRecord },
      { type: 'destroyPermanently', table: 'tasks', id: 't2' },
    ]);

    results = await adapter.find(allQuery());
    expect(results).toHaveLength(2);
    expect(results.find((r: any) => r.id === 't1')).toBeTruthy();
    expect((results.find((r: any) => r.id === 't1') as any).title).toBe('A updated');
  });

  // ─── Query with conditions ─────────────────────────────────────────

  it('queries with conditions via worker', async () => {
    await adapter.insert('tasks', makeRaw('t1', 'A'));
    await adapter.insert('tasks', { ...makeRaw('t2', 'B'), done: 1 } as RawRecord);
    await adapter.insert('tasks', { ...makeRaw('t3', 'C'), done: 1 } as RawRecord);

    const doneQuery: QueryDescriptor = {
      table: 'tasks',
      conditions: [{ type: 'where', column: 'done', operator: 'eq', value: 1 }],
      orderBy: [],
      joins: [],
    };

    const results = await adapter.find(doneQuery);
    expect(results).toHaveLength(2);

    const count = await adapter.count(doneQuery);
    expect(count).toBe(2);
  });

  // ─── Sync helpers ──────────────────────────────────────────────────

  it('getLocalChanges works via worker', async () => {
    await adapter.insert('tasks', { ...makeRaw('t1', 'A'), _status: 'created' } as RawRecord);
    await adapter.insert('tasks', { ...makeRaw('t2', 'B'), _status: 'updated' } as RawRecord);

    const changes = await adapter.getLocalChanges(['tasks']);
    expect(changes.tasks.created).toHaveLength(1);
    expect(changes.tasks.updated).toHaveLength(1);
    expect(changes.tasks.deleted).toHaveLength(0);
  });

  it('markAsSynced works via worker', async () => {
    await adapter.insert('tasks', makeRaw('t1', 'A'));
    await adapter.markAsSynced('tasks', ['t1']);

    const found = await adapter.findById('tasks', 't1');
    expect((found as any)._status).toBe('synced');
  });

  // ─── Schema version ───────────────────────────────────────────────

  it('returns schema version via worker', async () => {
    const version = await adapter.getSchemaVersion();
    expect(version).toBe(1);
  });

  // ─── Reset ─────────────────────────────────────────────────────────

  it('resets the database via worker', async () => {
    await adapter.insert('tasks', makeRaw('t1', 'A'));
    await adapter.reset();

    // After reset, need to re-initialize
    await adapter.initialize(testSchema);
    const results = await adapter.find(allQuery());
    expect(results).toHaveLength(0);
  });

  // ─── Error propagation ────────────────────────────────────────────

  it('propagates errors from worker to main thread', async () => {
    await expect(adapter.update('tasks', makeRaw('nonexistent', 'X'))).rejects.toThrow(
      /Record not found/,
    );
  });

  // ─── Double initialize is idempotent ──────────────────────────────

  it('handles double initialize gracefully', async () => {
    // Already initialized in beforeEach — calling again should be a no-op
    await expect(adapter.initialize(testSchema)).resolves.not.toThrow();
  });
});
