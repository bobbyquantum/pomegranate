import { LokiExecutor } from '../LokiExecutor';
import type { Migration } from '../../../types';
import type { QueryDescriptor } from '../../../../query/types';
import type { DatabaseSchema, RawRecord, TableSchema } from '../../../../schema/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Loki = require('lokijs');

const baseSchema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'items',
      columns: [
        { name: 'id', type: 'text', isOptional: false, isIndexed: false },
        { name: 'title', type: 'text', isOptional: false, isIndexed: true },
        { name: 'done', type: 'boolean', isOptional: false, isIndexed: true },
        { name: 'priority', type: 'number', isOptional: false, isIndexed: true },
        { name: 'note', type: 'text', isOptional: true, isIndexed: false },
        { name: 'rating', type: 'number', isOptional: false, isIndexed: false },
        { name: '_status', type: 'text', isOptional: false, isIndexed: true },
        { name: '_changed', type: 'text', isOptional: false, isIndexed: false },
      ],
    },
  ],
};

const archiveSchema: TableSchema = {
  name: 'archive',
  columns: [
    { name: 'id', type: 'text', isOptional: false, isIndexed: false },
    { name: 'label', type: 'text', isOptional: false, isIndexed: true },
    { name: '_status', type: 'text', isOptional: false, isIndexed: true },
    { name: '_changed', type: 'text', isOptional: false, isIndexed: false },
  ],
};

function makeRecord(overrides: Partial<RawRecord> = {}): RawRecord {
  return {
    id: 'item-1',
    title: 'Alpha',
    done: 0,
    priority: 1,
    note: null,
    rating: 0,
    _status: 'created',
    _changed: '',
    ...overrides,
  } as RawRecord;
}

function query(conditions: QueryDescriptor['conditions'] = [], extras: Partial<QueryDescriptor> = {}): QueryDescriptor {
  return {
    table: 'items',
    conditions,
    orderBy: [],
    joins: [],
    ...extras,
  };
}

async function initializeExecutor(config: Record<string, unknown> = {}): Promise<LokiExecutor> {
  const executor = new LokiExecutor({
    databaseName: `loki-executor-${Math.random()}`,
    ...config,
  } as any);
  await executor.initialize(baseSchema);
  return executor;
}

describe('LokiExecutor', () => {
  it('reuses a supplied Loki instance and existing schema metadata', async () => {
    const loki = new Loki('existing-loki.db');
    const meta = loki.addCollection('__pomegranate_metadata', { unique: ['key'] });
    meta.insert({ key: 'schema_version', value: '3' });
    loki.addCollection('items', {
      unique: ['id'],
      indices: ['_status', 'title', 'done', 'priority'],
    });

    const executor = new LokiExecutor({
      databaseName: 'existing-loki.db',
      lokiInstance: loki,
    });

    await executor.initialize({ ...baseSchema, version: 3 });
    await executor.insert('items', makeRecord({ id: 'existing-item' }));

    expect(await executor.getSchemaVersion()).toBe(3);
    await expect(executor.findById('items', 'existing-item')).resolves.toMatchObject({
      id: 'existing-item',
    });

    await executor.close();
  });

  it('saves immediately only when persistence is configured for immediate mode', async () => {
    const immediateLoki = new Loki('immediate-save.db');
    const immediateSpy = jest
      .spyOn(immediateLoki, 'saveDatabase')
      .mockImplementation((callback?: (err: unknown) => void) => callback?.(null));

    const immediateExecutor = await initializeExecutor({
      databaseName: 'immediate-save.db',
      lokiInstance: immediateLoki,
      persistenceAdapter: {},
    });

    await immediateExecutor.insert('items', makeRecord({ id: 'saved-now' }));
    expect(immediateSpy).toHaveBeenCalled();

    const autoLoki = new Loki('auto-save.db');
    const autoSpy = jest
      .spyOn(autoLoki, 'saveDatabase')
      .mockImplementation((callback?: (err: unknown) => void) => callback?.(null));

    const autoExecutor = await initializeExecutor({
      databaseName: 'auto-save.db',
      lokiInstance: autoLoki,
      persistenceAdapter: {},
      saveStrategy: 'auto',
      autosaveInterval: 1000,
    });

    await autoExecutor.insert('items', makeRecord({ id: 'saved-later' }));
    expect(autoSpy).not.toHaveBeenCalled();

    await immediateExecutor.close();
    await autoExecutor.close();
  });

  it('supports complex query operators and search filters', async () => {
    const executor = await initializeExecutor();

    await executor.batch([
      { type: 'create', table: 'items', rawRecord: makeRecord({ id: 'a', title: 'Alpha', done: 1, priority: 1, note: null, rating: 1 }) },
      { type: 'create', table: 'items', rawRecord: makeRecord({ id: 'b', title: 'Beta', done: 0, priority: 2, note: 'memo', rating: 5 }) },
      { type: 'create', table: 'items', rawRecord: makeRecord({ id: 'c', title: 'Gamma', done: 1, priority: 3, note: 'misc', rating: 9 }) },
      { type: 'create', table: 'items', rawRecord: makeRecord({ id: 'd', title: 'Delta_1', done: 0, priority: 4, note: null, rating: 3 }) },
    ]);

    await expect(
      executor.find(
        query([
          { type: 'where', column: 'done', operator: 'eq', value: true },
          { type: 'where', column: 'priority', operator: 'gte', value: 3 },
        ]),
      ),
    ).resolves.toHaveLength(1);

    await expect(
      executor.find(
        query([
          {
            type: 'or',
            conditions: [
              { type: 'where', column: 'title', operator: 'like', value: 'Al%' },
              { type: 'where', column: 'title', operator: 'like', value: 'Delta_1' },
            ],
          },
        ]),
      ),
    ).resolves.toHaveLength(2);

    await expect(
      executor.find(
        query([
          {
            type: 'not',
            condition: { type: 'where', column: 'title', operator: 'like', value: 'Be%' },
          },
        ]),
      ),
    ).resolves.toHaveLength(3);

    await expect(
      executor.find(query([{ type: 'where', column: 'priority', operator: 'between', value: [2, 4] }])),
    ).resolves.toHaveLength(3);

    await expect(
      executor.find(query([{ type: 'where', column: 'done', operator: 'in', value: [true] }])),
    ).resolves.toHaveLength(2);

    await expect(
      executor.find(query([{ type: 'where', column: 'done', operator: 'notIn', value: [true] }])),
    ).resolves.toHaveLength(2);

    await expect(
      executor.find(query([{ type: 'where', column: 'note', operator: 'isNull', value: null }])),
    ).resolves.toHaveLength(2);

    await expect(
      executor.find(query([{ type: 'where', column: 'note', operator: 'isNotNull', value: null }])),
    ).resolves.toHaveLength(2);

    await expect(
      executor.find(query([{ type: 'where', column: 'title', operator: 'notLike', value: 'Ga%' }])),
    ).resolves.toHaveLength(3);

    const searched = await executor.search({
      table: 'items',
      term: 'a',
      fields: ['title', 'note'],
      conditions: [{ type: 'where', column: 'priority', operator: 'gt', value: 1 }],
      orderBy: [{ column: 'priority', order: 'desc' }],
      offset: 1,
      limit: 2,
    });

    expect(searched.total).toBe(3);
    expect(searched.records).toHaveLength(2);
    expect(searched.records[0].id).toBe('c');

    await expect(
      executor.count(query([{ type: 'where', column: 'priority', operator: 'lt', value: 4 }])),
    ).resolves.toBe(3);

    await expect(
      executor.count(query([{ type: 'where', column: 'priority', operator: 'lte', value: 2 }])),
    ).resolves.toBe(2);

    await executor.close();
  });

  it('throws for unsupported query conditions and operators', async () => {
    const executor = await initializeExecutor();

    await expect(
      executor.find(query([{ type: 'where', column: 'title', operator: 'bogus', value: 'x' } as any])),
    ).rejects.toThrow('Unknown operator');

    await expect(
      executor.find(query([{ type: 'mystery', column: 'title' } as any])),
    ).rejects.toThrow('Unknown condition type');

    await executor.close();
  });

  it('applies createTable, addColumn, sql, and destroyTable migrations', async () => {
    const executor = await initializeExecutor();

    await executor.batch([
      { type: 'create', table: 'items', rawRecord: makeRecord({ id: 'a', title: 'Alpha', note: null, done: 1, priority: 1 }) },
      { type: 'create', table: 'items', rawRecord: makeRecord({ id: 'b', title: 'Beta', note: 'memo', done: 1, priority: 2 }) },
    ]);

    const migrations: Migration[] = [
      {
        fromVersion: 2,
        toVersion: 3,
        steps: [
          { type: 'createTable', schema: archiveSchema },
          { type: 'destroyTable', table: 'archive' },
        ],
      },
      {
        fromVersion: 1,
        toVersion: 2,
        steps: [
          { type: 'addColumn', table: 'items', column: 'flag', columnType: 'boolean' },
          { type: 'addColumn', table: 'items', column: 'visits', columnType: 'number' },
          { type: 'addColumn', table: 'items', column: 'alias', columnType: 'string' },
          { type: 'addColumn', table: 'items', column: 'optional_text', columnType: 'string', isOptional: true },
          { type: 'sql', query: 'UPDATE "items" SET "alias" = \'it\'\'s live\'' },
          { type: 'sql', query: 'UPDATE "items" SET "optional_text" = null WHERE "note" IS NULL' },
          { type: 'sql', query: 'UPDATE "items" SET "flag" = true WHERE "title" = \'Alpha\'' },
          { type: 'sql', query: 'UPDATE "items" SET "priority" = 9 WHERE "title" != \'Beta\'' },
        ],
      },
      {
        fromVersion: 0,
        toVersion: 1,
        steps: [{ type: 'addColumn', table: 'items', column: 'skipped', columnType: 'string' }],
      },
      {
        fromVersion: 3,
        toVersion: 4,
        steps: [
          { type: 'sql', query: 'UPDATE "items" SET "done" = false WHERE "note" IS NOT NULL' },
          { type: 'sql', query: 'UPDATE "items" SET "rating" = 4.5 WHERE "title" <> \'Beta\'' },
        ],
      },
    ];

    await executor.migrate(migrations);

    const alpha = await executor.findById('items', 'a');
    const beta = await executor.findById('items', 'b');

    expect(await executor.getSchemaVersion()).toBe(4);
    expect(alpha).toMatchObject({
      alias: "it's live",
      optional_text: null,
      flag: true,
      visits: 0,
      priority: 9,
      rating: 4.5,
    });
    expect(beta).toMatchObject({
      alias: "it's live",
      optional_text: null,
      flag: 0,
      visits: 0,
      done: false,
    });

    await expect(executor.find({ table: 'archive', conditions: [], orderBy: [], joins: [] })).rejects.toThrow(
      'Collection "archive" not found',
    );

    await executor.close();
  });

  it('rejects unsupported migration SQL literals and WHERE clauses', async () => {
    const executor = await initializeExecutor();

    await expect(
      executor.migrate([
        { fromVersion: 1, toVersion: 2, steps: [{ type: 'sql', query: 'DELETE FROM "items"' }] },
      ]),
    ).rejects.toThrow('Unsupported Loki migration SQL');

    await expect(
      executor.migrate([
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [{ type: 'sql', query: 'UPDATE "items" SET "title" = CURRENT_TIMESTAMP' }],
        },
      ]),
    ).rejects.toThrow('Unsupported Loki migration SQL literal');

    await expect(
      executor.migrate([
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [{ type: 'sql', query: 'UPDATE "items" SET "title" = \'x\' WHERE "title" > 1' }],
        },
      ]),
    ).rejects.toThrow('Unsupported Loki migration WHERE clause');

    await executor.close();
  });

  it('applies remote changes, skips missing deletes, and tolerates reset/close before initialize', async () => {
    const freshExecutor = new LokiExecutor({ databaseName: 'fresh-before-init' });
    await expect(freshExecutor.reset()).resolves.toBeUndefined();
    await expect(freshExecutor.close()).resolves.toBeUndefined();

    const executor = await initializeExecutor();

    await executor.batch([
      { type: 'create', table: 'items', rawRecord: makeRecord({ id: 'local-created', title: 'Local created', _status: 'created' }) },
      { type: 'create', table: 'items', rawRecord: makeRecord({ id: 'local-updated', title: 'Local updated', _status: 'updated' }) },
      { type: 'create', table: 'items', rawRecord: makeRecord({ id: 'to-delete', title: 'Delete me', _status: 'synced' }) },
    ]);

    await executor.applyRemoteChanges({
      items: {
        created: [
          makeRecord({ id: 'local-created', title: 'Remote created overwrite', _status: 'created' }),
          makeRecord({ id: 'remote-created', title: 'Remote created insert', _status: 'created' }),
        ],
        updated: [
          makeRecord({ id: 'local-updated', title: 'Remote updated overwrite', _status: 'updated' }),
          makeRecord({ id: 'remote-updated', title: 'Remote updated insert', _status: 'updated' }),
        ],
        deleted: ['to-delete', 'missing-id'],
      },
    });

    await executor.markAsSynced('items', ['local-created', 'missing-id']);

    expect(await executor.findById('items', 'to-delete')).toBeNull();
    expect(await executor.findById('items', 'remote-created')).toMatchObject({ _status: 'synced' });
    expect(await executor.findById('items', 'remote-updated')).toMatchObject({ _status: 'synced' });
    expect(await executor.findById('items', 'local-created')).toMatchObject({
      title: 'Remote created overwrite',
      _status: 'synced',
      _changed: '',
    });

    await executor.reset();
    await executor.initialize(baseSchema);
    await expect(executor.find(query())).resolves.toHaveLength(0);

    await executor.close();
  });
});
