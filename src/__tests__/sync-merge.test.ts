/**
 * `applyRemoteChanges` merge semantics (WatermelonDB resolution), verified on
 * SQLiteAdapter, LokiAdapter (direct) and LokiAdapter (worker protocol).
 */

import { SQLiteAdapter } from '../adapters/sqlite/SQLiteAdapter';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { SynchronousWorker } from '../adapters/loki';
import type { StorageAdapter } from '../adapters/types';
import type { DatabaseSchema, RawRecord } from '../schema/types';
import { mergeRemoteIntoLocal, parseChangedColumns, remoteValuesToApply } from '../adapters/remoteMerge';
import { createBetterSqliteDriver } from './helpers/betterSqliteDriver';

const schema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'items',
      columns: [
        { name: 'title', type: 'text', isOptional: false, isIndexed: false },
        { name: 'body', type: 'text', isOptional: false, isIndexed: false },
        { name: 'count', type: 'number', isOptional: false, isIndexed: false },
      ],
    },
  ],
};

function raw(id: string, overrides: Partial<RawRecord> = {}): RawRecord {
  return {
    id,
    title: `title ${id}`,
    body: `body ${id}`,
    count: 1,
    _status: 'synced',
    _changed: '',
    ...overrides,
  } as RawRecord;
}

let counter = 0;
const factories: Array<[string, () => StorageAdapter]> = [
  ['SQLiteAdapter', () => new SQLiteAdapter({ databaseName: ':memory:', driver: createBetterSqliteDriver() })],
  ['LokiAdapter', () => new LokiAdapter({ databaseName: `merge-${counter++}` })],
  ['LokiAdapter (worker)', () => new LokiAdapter({ databaseName: `merge-w-${counter++}`, worker: new SynchronousWorker() })],
];

describe.each(factories)('%s applyRemoteChanges', (_name, make) => {
  let adapter: StorageAdapter;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    adapter = make();
    await adapter.initialize(schema);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    await adapter.close();
  });

  it('inserts unknown records as synced, from both created and updated', async () => {
    await adapter.applyRemoteChanges({
      items: {
        created: [raw('c1', { _status: 'created', _changed: 'title' })],
        updated: [raw('u1', { _status: 'updated', _changed: 'title' })],
        deleted: [],
      },
    });
    expect(await adapter.findById('items', 'c1')).toMatchObject({ title: 'title c1', _status: 'synced', _changed: '' });
    expect(await adapter.findById('items', 'u1')).toMatchObject({ title: 'title u1', _status: 'synced', _changed: '' });
  });

  it('overwrites synced records', async () => {
    await adapter.insert('items', raw('s1', { title: 'old', count: 1 }));
    await adapter.applyRemoteChanges({
      items: { created: [], updated: [raw('s1', { title: 'new', count: 2 })], deleted: [] },
    });
    expect(await adapter.findById('items', 's1')).toMatchObject({ title: 'new', count: 2, _status: 'synced', _changed: '' });
  });

  it('keeps the locally changed columns of an updated record and leaves it pending', async () => {
    await adapter.insert('items', raw('m1', { title: 'local title', body: 'local body', count: 1, _status: 'updated', _changed: 'title,count' }));
    await adapter.applyRemoteChanges({
      items: { created: [], updated: [raw('m1', { title: 'remote title', body: 'remote body', count: 99 })], deleted: [] },
    });
    expect(await adapter.findById('items', 'm1')).toMatchObject({
      title: 'local title',
      count: 1,
      body: 'remote body',
      _status: 'updated',
      _changed: 'title,count',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('merges into a locally created record on an id collision and warns', async () => {
    await adapter.insert('items', raw('x1', { title: 'mine', body: 'mine', _status: 'created', _changed: 'title' }));
    await adapter.applyRemoteChanges({
      items: { created: [raw('x1', { title: 'theirs', body: 'theirs' })], updated: [], deleted: [] },
    });
    expect(await adapter.findById('items', 'x1')).toMatchObject({
      title: 'mine',
      body: 'theirs',
      _status: 'created',
      _changed: 'title',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('collides with a locally created record'));
  });

  it('ignores remote rows for locally deleted records', async () => {
    await adapter.insert('items', raw('d1', { title: 'gone', _status: 'deleted' }));
    await adapter.applyRemoteChanges({
      items: { created: [raw('d1', { title: 'resurrected?' })], updated: [raw('d1', { title: 'still?' })], deleted: [] },
    });
    expect(await adapter.findById('items', 'd1')).toMatchObject({ title: 'gone', _status: 'deleted' });
  });

  it('removes remotely deleted records regardless of local status', async () => {
    await adapter.insert('items', raw('r1', { _status: 'updated', _changed: 'title' }));
    await adapter.insert('items', raw('r2', { _status: 'created' }));
    await adapter.insert('items', raw('r3', { _status: 'synced' }));
    await adapter.applyRemoteChanges({ items: { created: [], updated: [], deleted: ['r1', 'r2', 'r3', 'missing'] } });
    expect(await adapter.findById('items', 'r1')).toBeNull();
    expect(await adapter.findById('items', 'r2')).toBeNull();
    expect(await adapter.findById('items', 'r3')).toBeNull();
  });

  it('handles the same id appearing in created and updated', async () => {
    await adapter.applyRemoteChanges({
      items: { created: [raw('dup', { title: 'first' })], updated: [raw('dup', { title: 'second' })], deleted: [] },
    });
    expect(await adapter.findById('items', 'dup')).toMatchObject({ title: 'second', _status: 'synced' });
  });
});

describe('SQLiteAdapter sync-state lookup', () => {
  it('reads local state in one chunked query per ≤500 ids, inside the transaction', async () => {
    const driver = createBetterSqliteDriver();
    const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
    await adapter.initialize(schema);
    for (let i = 0; i < 5; i++) {
      await adapter.insert('items', raw(`pre${i}`, { _status: 'updated', _changed: 'title' }));
    }
    driver.statements.length = 0;

    const created = Array.from({ length: 1200 }, (_, i) => raw(`r${i}`));
    const updated = Array.from({ length: 5 }, (_, i) => raw(`pre${i}`, { title: 'remote' }));
    await adapter.applyRemoteChanges({ items: { created, updated, deleted: [] } });

    const lookups = driver.statements.filter((s) => s.startsWith('SELECT "id", "_status", "_changed" FROM "items"'));
    expect(lookups).toHaveLength(3); // 1205 ids → 500 + 500 + 205
    for (const sql of lookups) {
      expect((sql.match(/\?/g) ?? []).length).toBeLessThanOrEqual(500);
    }
    expect(driver.statements.filter((s) => s.startsWith('SELECT "_status"'))).toHaveLength(0);
    expect(await adapter.count({ table: 'items', conditions: [], orderBy: [], joins: [] })).toBe(1205);
    expect(await adapter.findById('items', 'pre0')).toMatchObject({ title: 'title pre0', _status: 'updated' });
    await adapter.close();
  });
});

describe('remoteMerge helpers', () => {
  it('parses _changed and applies only unchanged columns', () => {
    expect([...parseChangedColumns('a,b,,c')]).toEqual(['a', 'b', 'c']);
    expect([...parseChangedColumns('')]).toEqual([]);
    expect([...parseChangedColumns(null)]).toEqual([]);

    const remote = raw('1', { title: 'R', body: 'RB', count: 5, _status: 'created', _changed: 'zzz' });
    expect(remoteValuesToApply(remote, 'title')).toEqual({ id: '1', body: 'RB', count: 5 });

    const local = raw('1', { title: 'L', body: 'LB', count: 1, _status: 'updated', _changed: 'title' });
    expect(mergeRemoteIntoLocal(local, remote)).toEqual({
      id: '1',
      title: 'L',
      body: 'RB',
      count: 5,
      _status: 'updated',
      _changed: 'title',
    });
  });
});
