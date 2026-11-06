/**
 * LokiExecutor paths the adapter-level suites do not reach:
 *  - initialize guards (double init, use before init, persisted instances)
 *  - persistence adapters: immediate vs auto save, load/save failures, reload
 *  - legacy `addColumn` migration defaults per SQL type, `addColumns` json/date
 *  - schema-version bookkeeping after reset()
 *  - boolean normalisation in `in` / `notIn`
 */

import { LokiExecutor } from '../adapters/loki/worker/LokiExecutor';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import type { DatabaseSchema, RawRecord } from '../schema/types';
import type { QueryDescriptor } from '../query/types';

type LokiCtor = Awaited<typeof import('lokijs')>['default'];

const schema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'tasks',
      columns: [
        { name: 'title', type: 'text', isOptional: false, isIndexed: true },
        { name: 'done', type: 'boolean', isOptional: false, isIndexed: false },
      ],
    },
  ],
};

const task = (id: string, over: Partial<RawRecord> = {}): RawRecord =>
  ({ id, title: id, done: 0, _status: 'synced', _changed: '', ...over }) as RawRecord;

const query = (over: Partial<QueryDescriptor>): QueryDescriptor => ({
  table: 'tasks',
  conditions: [],
  orderBy: [],
  joins: [],
  ...over,
});

let Loki: LokiCtor;
beforeAll(async () => {
  const lokijs = await import('lokijs');
  Loki = lokijs.default;
});

/** A LokiJS persistence adapter kept entirely in memory. */
function memoryPersistence(options: { loadError?: Error; saveError?: Error; initial?: string | null } = {}) {
  const saves: string[] = [];
  let stored: string | null = options.initial ?? null;
  return {
    saves,
    stored: () => stored,
    loadDatabase(_name: string, callback: (result: unknown) => void) {
      callback(options.loadError ?? stored);
    },
    saveDatabase(_name: string, data: string, callback: (error: unknown) => void) {
      if (options.saveError) {
        callback(options.saveError);
        return;
      }
      saves.push(data);
      stored = data;
      callback(null);
    },
  };
}

// ─── Initialisation ─────────────────────────────────────────────────────

describe('LokiExecutor initialisation', () => {
  it('refuses to work before initialize()', async () => {
    const executor = new LokiExecutor({ databaseName: 'uninit' });
    await expect(executor.find(query({}))).rejects.toThrow('Database not initialized');
    await expect(executor.getMetadata('x')).rejects.toThrow('Database not initialized');
  });

  it('falls back to a default Loki filename when the database name is empty', async () => {
    const executor = new LokiExecutor({ databaseName: '' });
    await executor.initialize(schema);
    expect((executor as unknown as { _db: { filename: string } })._db.filename).toBe('pomegranate.db');
    const named = new LokiExecutor({ databaseName: 'custom' });
    await named.initialize(schema);
    expect((named as unknown as { _db: { filename: string } })._db.filename).toBe('custom');
  });

  it('initialises once; a second call is a no-op', async () => {
    const executor = new LokiExecutor({ databaseName: 'twice' });
    await executor.initialize(schema);
    await executor.insert('tasks', task('t1'));
    await executor.initialize({ ...schema, version: 9 });
    expect(await executor.getSchemaVersion()).toBe(1);
    expect(await executor.findById('tasks', 't1')).toMatchObject({ id: 't1' });
  });

  it('adopts a provided Loki instance and keeps its stored schema version', async () => {
    const instance = new Loki('persisted');
    const meta = instance.addCollection('__pomegranate_metadata', { unique: ['key'] });
    meta.insert({ key: 'schema_version', value: '3' });
    instance.addCollection('tasks', { unique: ['id'] }).insert(task('old'));

    const executor = new LokiExecutor({ databaseName: 'persisted', lokiInstance: instance });
    await executor.initialize({ ...schema, version: 5 });
    expect(await executor.getSchemaVersion()).toBe(3);
    expect(await executor.findById('tasks', 'old')).toMatchObject({ id: 'old' });
  });

  it('treats a stored version of 0 as a fresh install and rewrites the version record', async () => {
    const instance = new Loki('zero');
    const meta = instance.addCollection('__pomegranate_metadata', { unique: ['key'] });
    meta.insert({ key: 'schema_version', value: '0' });

    const executor = new LokiExecutor({ databaseName: 'zero', lokiInstance: instance });
    await executor.initialize({ ...schema, version: 4 });
    expect(await executor.getSchemaVersion()).toBe(4);
    expect(meta.find({ key: 'schema_version' })).toHaveLength(1);
    expect(meta.findOne({ key: 'schema_version' })).toMatchObject({ value: '4' });
    expect(instance.getCollection('tasks')).not.toBeNull();
  });
});

// ─── Persistence ────────────────────────────────────────────────────────

describe('LokiExecutor persistence', () => {
  it('saves after every mutation by default and reloads from the saved snapshot', async () => {
    const persistence = memoryPersistence();
    const executor = new LokiExecutor({ databaseName: 'immediate', persistenceAdapter: persistence });
    await executor.initialize(schema);
    await executor.insert('tasks', task('t1'));
    await executor.setMetadata('pomegranate_last_pulled_at', '99');
    await executor.batch([{ type: 'update', table: 'tasks', rawRecord: task('t1', { title: 'renamed' }) }]);
    expect(persistence.saves).toHaveLength(3);
    await executor.close();

    const reloaded = new LokiExecutor({
      databaseName: 'immediate',
      persistenceAdapter: memoryPersistence({ initial: persistence.stored() }),
    });
    await reloaded.initialize({ ...schema, version: 2 });
    expect(await reloaded.getSchemaVersion()).toBe(1); // stored version wins: migration due
    expect(await reloaded.findById('tasks', 't1')).toMatchObject({ title: 'renamed' });
    expect(await reloaded.getMetadata('pomegranate_last_pulled_at')).toBe('99');
    await reloaded.close();
  });

  it('with saveStrategy "auto" leaves saving to the autosave timer and flushes on close()', async () => {
    const persistence = memoryPersistence();
    const executor = new LokiExecutor({
      databaseName: 'auto',
      persistenceAdapter: persistence,
      saveStrategy: 'auto',
      autosaveInterval: 20,
    });
    await executor.initialize(schema);
    const loki = (executor as unknown as { _db: { autosave: boolean } })._db;
    expect(loki.autosave).toBe(true);
    await executor.insert('tasks', task('t1'));
    await executor.setMetadata('k', 'v');
    expect(persistence.saves).toHaveLength(0); // the timer, not the mutation, saves
    await executor.close(); // Loki flushes a dirty database when closing
    expect(persistence.saves).toHaveLength(1);
    expect(persistence.stored()).toContain('"t1"');

    const defaultInterval = new LokiExecutor({
      databaseName: 'auto-default',
      persistenceAdapter: memoryPersistence(),
      saveStrategy: 'auto',
    });
    await defaultInterval.initialize(schema);
    expect((defaultInterval as unknown as { _db: { autosave: boolean } })._db.autosave).toBe(true);
    await defaultInterval.close();
  });

  it('propagates load and save failures', async () => {
    const failingLoad = new LokiExecutor({
      databaseName: 'corrupt',
      persistenceAdapter: memoryPersistence({ loadError: new Error('corrupt file') }),
    });
    await expect(failingLoad.initialize(schema)).rejects.toThrow('corrupt file');

    const failingSave = new LokiExecutor({
      databaseName: 'full',
      persistenceAdapter: memoryPersistence({ saveError: new Error('disk full') }),
    });
    await failingSave.initialize(schema);
    await expect(failingSave.insert('tasks', task('t1'))).rejects.toThrow('disk full');
    await failingSave.close();
  });
});

// ─── Migrations ─────────────────────────────────────────────────────────

describe('LokiExecutor migrations', () => {
  it('fills legacy addColumn steps with a default derived from the SQL type', async () => {
    const executor = new LokiExecutor({ databaseName: 'legacy-columns' });
    await executor.initialize(schema);
    await executor.insert('tasks', task('t1'));

    const types: Array<[string, string, boolean?]> = [
      ['c_bool', 'bool'],
      ['c_boolean', 'BOOLEAN'],
      ['c_date', 'date'],
      ['c_datetime', 'DateTime'],
      ['c_float', 'float'],
      ['c_int', 'int'],
      ['c_integer', ' INTEGER '],
      ['c_number', 'number'],
      ['c_numeric', 'numeric'],
      ['c_real', 'REAL'],
      ['c_string', 'string'],
      ['c_text', 'TEXT'],
      ['c_optional', 'INTEGER', true],
    ];
    await executor.migrate([
      {
        fromVersion: 1,
        toVersion: 2,
        steps: types.map(([column, columnType, isOptional]) => ({
          type: 'addColumn' as const,
          table: 'tasks',
          column,
          columnType,
          isOptional,
        })),
      },
    ]);

    expect(await executor.getSchemaVersion()).toBe(2);
    expect(await executor.findById('tasks', 't1')).toMatchObject({
      c_bool: 0,
      c_boolean: 0,
      c_date: 0,
      c_datetime: 0,
      c_float: 0,
      c_int: 0,
      c_integer: 0,
      c_number: 0,
      c_numeric: 0,
      c_real: 0,
      c_string: '',
      c_text: '',
      c_optional: null,
    });
    // Rows inserted after the migration are not touched again.
    await executor.insert('tasks', task('t2', { c_int: 7 } as Partial<RawRecord>));
    await executor.migrate([{ fromVersion: 2, toVersion: 3, steps: [{ type: 'addColumn', table: 'tasks', column: 'c_int', columnType: 'int' }] }]);
    expect(await executor.findById('tasks', 't2')).toMatchObject({ c_int: 7 });
  });

  it('fills addColumns steps per schema type, including json and date', async () => {
    const executor = new LokiExecutor({ databaseName: 'schema-columns' });
    await executor.initialize(schema);
    await executor.insert('tasks', task('t1'));
    await executor.migrate([
      {
        fromVersion: 1,
        toVersion: 2,
        steps: [
          {
            type: 'addColumns',
            table: 'tasks',
            columns: [
              { name: 'payload', type: 'json', isOptional: false, isIndexed: false },
              { name: 'due', type: 'date', isOptional: false, isIndexed: false },
              { name: 'count', type: 'number', isOptional: false, isIndexed: false },
              { name: 'flag', type: 'boolean', isOptional: false, isIndexed: false },
              { name: 'label', type: 'text', isOptional: false, isIndexed: false },
              { name: 'note', type: 'text', isOptional: true, isIndexed: false },
            ],
          },
        ],
      },
    ]);
    expect(await executor.findById('tasks', 't1')).toMatchObject({
      payload: '',
      due: 0,
      count: 0,
      flag: 0,
      label: '',
      note: null,
    });
  });

  it('recreates the schema version record when migrating after a reset', async () => {
    const adapter = new LokiAdapter({ databaseName: 'reset-migrate' });
    await adapter.initialize(schema);
    await adapter.insert('tasks', task('t1'));
    await adapter.reset();
    expect(await adapter.findById('tasks', 't1')).toBeNull();

    await adapter.migrate([{ fromVersion: 1, toVersion: 2, steps: [] }]);
    expect(await adapter.getSchemaVersion()).toBe(2);
    await adapter.setMetadata('k', 'v');
    expect(await adapter.getMetadata('k')).toBe('v');
    await adapter.close();
  });
});

// ─── Query translation ──────────────────────────────────────────────────

describe('LokiExecutor boolean normalisation', () => {
  it('matches boolean lists in `in` / `notIn` against the stored 0/1', async () => {
    const adapter = new LokiAdapter({ databaseName: 'bool-in' });
    await adapter.initialize(schema);
    await adapter.batch([
      { type: 'create', table: 'tasks', rawRecord: task('yes', { done: 1 }) },
      { type: 'create', table: 'tasks', rawRecord: task('no', { done: 0 }) },
    ]);
    const ids = async (q: QueryDescriptor) => {
      const rows = await adapter.find(q);
      return rows.map((r) => r.id).sort();
    };

    expect(await ids(query({ conditions: [{ type: 'where', column: 'done', operator: 'in', value: [true] }] }))).toEqual(['yes']);
    expect(await ids(query({ conditions: [{ type: 'where', column: 'done', operator: 'notIn', value: [true] }] }))).toEqual(['no']);
    expect(await ids(query({ conditions: [{ type: 'where', column: 'done', operator: 'in', value: [false, 'x'] }] }))).toEqual(['no']);
    expect(await ids(query({ conditions: [{ type: 'where', column: 'done', operator: 'notIn', value: [false, true] }] }))).toEqual([]);
    expect(
      await ids(query({ conditions: [{ type: 'not', condition: { type: 'where', column: 'done', operator: 'in', value: [true] } }] })),
    ).toEqual(['no']);
    await adapter.close();
  });
});
