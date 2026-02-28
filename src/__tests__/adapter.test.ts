/**
 * Adapter tests — LokiAdapter.
 *
 * Tests StorageAdapter interface methods directly, covering:
 * - Batch operations
 * - Sync helpers (getLocalChanges, applyRemoteChanges, markAsSynced)
 * - Query operators (in, notIn, like, between, isNull, etc.)
 * - Migration support
 * - Error handling
 */

import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import type { DatabaseSchema, RawRecord } from '../schema/types';
import type { BatchOperation, QueryDescriptor, Condition } from '../query/types';

// ─── Test Schema ─────────────────────────────────────────────────────────

const testSchema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'items',
      columns: [
        { name: 'id', type: 'text' as any, isOptional: false, isIndexed: false },
        { name: 'title', type: 'text' as any, isOptional: false, isIndexed: true },
        { name: 'count', type: 'number' as any, isOptional: false, isIndexed: false },
        { name: 'active', type: 'boolean' as any, isOptional: false, isIndexed: false },
        { name: 'tag', type: 'text' as any, isOptional: true, isIndexed: false },
        { name: '_status', type: 'text' as any, isOptional: false, isIndexed: true },
        { name: '_changed', type: 'text' as any, isOptional: false, isIndexed: false },
      ],
    },
  ],
};

function makeRaw(overrides: Partial<RawRecord> & { id: string; title: string }): RawRecord {
  return {
    count: 0,
    active: 1,
    tag: null,
    _status: 'created',
    _changed: '',
    ...overrides,
  } as RawRecord;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('LokiAdapter', () => {
  let adapter: LokiAdapter;

  beforeEach(async () => {
    adapter = new LokiAdapter({ databaseName: 'adapter-test' });
    await adapter.initialize(testSchema);
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('CRUD operations', () => {
    it('inserts and finds by ID', async () => {
      const raw = makeRaw({ id: 'a1', title: 'Alpha' });
      await adapter.insert('items', raw);

      const found = await adapter.findById('items', 'a1');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Alpha');
    });

    it('returns null for non-existent ID', async () => {
      const found = await adapter.findById('items', 'nonexistent');
      expect(found).toBeNull();
    });

    it('updates a record', async () => {
      const raw = makeRaw({ id: 'a1', title: 'Before' });
      await adapter.insert('items', raw);

      await adapter.update('items', { ...raw, title: 'After' } as RawRecord);

      const found = await adapter.findById('items', 'a1');
      expect(found!.title).toBe('After');
    });

    it('throws when updating non-existent record', async () => {
      await expect(adapter.update('items', makeRaw({ id: 'nope', title: 'X' }))).rejects.toThrow();
    });

    it('marks a record as deleted (soft delete)', async () => {
      await adapter.insert('items', makeRaw({ id: 'a1', title: 'Delete me' }));
      await adapter.markAsDeleted('items', 'a1');

      const found = await adapter.findById('items', 'a1');
      expect(found!._status).toBe('deleted');
    });

    it('permanently destroys a record', async () => {
      await adapter.insert('items', makeRaw({ id: 'a1', title: 'Destroy me' }));
      await adapter.destroyPermanently('items', 'a1');

      const found = await adapter.findById('items', 'a1');
      expect(found).toBeNull();
    });

    it('handles destroyPermanently on non-existent record gracefully', async () => {
      // Should not throw
      await adapter.destroyPermanently('items', 'nonexistent');
    });
  });

  describe('Batch operations', () => {
    it('executes mixed batch operations', async () => {
      // Create two records
      const ops: BatchOperation[] = [
        { type: 'create', table: 'items', rawRecord: makeRaw({ id: 'b1', title: 'First' }) },
        { type: 'create', table: 'items', rawRecord: makeRaw({ id: 'b2', title: 'Second' }) },
      ];
      await adapter.batch(ops);

      const r1 = await adapter.findById('items', 'b1');
      const r2 = await adapter.findById('items', 'b2');
      expect(r1!.title).toBe('First');
      expect(r2!.title).toBe('Second');

      // Update + Delete in batch
      const ops2: BatchOperation[] = [
        {
          type: 'update',
          table: 'items',
          rawRecord: { ...r1!, title: 'Updated First' } as RawRecord,
        },
        { type: 'delete', table: 'items', id: 'b2' },
      ];
      await adapter.batch(ops2);

      const r1After = await adapter.findById('items', 'b1');
      const r2After = await adapter.findById('items', 'b2');
      expect(r1After!.title).toBe('Updated First');
      expect(r2After!._status).toBe('deleted');
    });

    it('supports destroyPermanently in batch', async () => {
      await adapter.insert('items', makeRaw({ id: 'c1', title: 'Bye' }));

      await adapter.batch([{ type: 'destroyPermanently', table: 'items', id: 'c1' }]);

      const found = await adapter.findById('items', 'c1');
      expect(found).toBeNull();
    });
  });

  describe('Query operators', () => {
    beforeEach(async () => {
      await adapter.batch([
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({
            id: 'q1',
            title: 'Alpha',
            count: 10,
            active: 1,
            tag: 'a',
            _status: 'synced',
          }),
        },
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({
            id: 'q2',
            title: 'Beta',
            count: 20,
            active: 0,
            tag: 'b',
            _status: 'synced',
          }),
        },
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({
            id: 'q3',
            title: 'Gamma',
            count: 30,
            active: 1,
            tag: null,
            _status: 'synced',
          }),
        },
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({
            id: 'q4',
            title: 'Delta',
            count: 40,
            active: 0,
            tag: 'a',
            _status: 'synced',
          }),
        },
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({
            id: 'q5',
            title: 'Epsilon',
            count: 50,
            active: 1,
            tag: 'c',
            _status: 'synced',
          }),
        },
      ]);
    });

    function buildQuery(conditions: Condition[]): QueryDescriptor {
      return { table: 'items', conditions, orderBy: [], joins: [] };
    }

    it('where eq', async () => {
      const results = await adapter.find(
        buildQuery([{ type: 'where', column: 'title', operator: 'eq', value: 'Alpha' }]),
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('q1');
    });

    it('where neq', async () => {
      const results = await adapter.find(
        buildQuery([{ type: 'where', column: 'active', operator: 'neq', value: true }]),
      );
      expect(results).toHaveLength(2);
    });

    it('where gt / gte / lt / lte', async () => {
      const gt20 = await adapter.find(
        buildQuery([{ type: 'where', column: 'count', operator: 'gt', value: 20 }]),
      );
      expect(gt20).toHaveLength(3);

      const gte20 = await adapter.find(
        buildQuery([{ type: 'where', column: 'count', operator: 'gte', value: 20 }]),
      );
      expect(gte20).toHaveLength(4);

      const lt30 = await adapter.find(
        buildQuery([{ type: 'where', column: 'count', operator: 'lt', value: 30 }]),
      );
      expect(lt30).toHaveLength(2);

      const lte30 = await adapter.find(
        buildQuery([{ type: 'where', column: 'count', operator: 'lte', value: 30 }]),
      );
      expect(lte30).toHaveLength(3);
    });

    it('where in / notIn', async () => {
      const inResult = await adapter.find(
        buildQuery([{ type: 'where', column: 'tag', operator: 'in', value: ['a', 'c'] }]),
      );
      expect(inResult).toHaveLength(3);

      const notInResult = await adapter.find(
        buildQuery([{ type: 'where', column: 'tag', operator: 'notIn', value: ['a', 'c'] }]),
      );
      expect(notInResult).toHaveLength(2); // Beta (tag=b) and Gamma (tag=null)
    });

    it('where like', async () => {
      const results = await adapter.find(
        buildQuery([{ type: 'where', column: 'title', operator: 'like', value: '%lpha' }]),
      );
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Alpha');
    });

    it('where between', async () => {
      const results = await adapter.find(
        buildQuery([{ type: 'where', column: 'count', operator: 'between', value: [15, 35] }]),
      );
      expect(results).toHaveLength(2); // 20 and 30
    });

    it('where isNull / isNotNull', async () => {
      const nullResults = await adapter.find(
        buildQuery([{ type: 'where', column: 'tag', operator: 'isNull', value: null }]),
      );
      expect(nullResults).toHaveLength(1);
      expect(nullResults[0].id).toBe('q3');

      const notNullResults = await adapter.find(
        buildQuery([{ type: 'where', column: 'tag', operator: 'isNotNull', value: null }]),
      );
      expect(notNullResults).toHaveLength(4);
    });

    it('AND conditions', async () => {
      const results = await adapter.find(
        buildQuery([
          {
            type: 'and',
            conditions: [
              { type: 'where', column: 'active', operator: 'eq', value: true },
              { type: 'where', column: 'count', operator: 'gt', value: 20 },
            ],
          },
        ]),
      );
      expect(results).toHaveLength(2); // Gamma (30) and Epsilon (50)
    });

    it('OR conditions', async () => {
      const results = await adapter.find(
        buildQuery([
          {
            type: 'or',
            conditions: [
              { type: 'where', column: 'title', operator: 'eq', value: 'Alpha' },
              { type: 'where', column: 'title', operator: 'eq', value: 'Epsilon' },
            ],
          },
        ]),
      );
      expect(results).toHaveLength(2);
    });

    it('count with conditions', async () => {
      const count = await adapter.count(
        buildQuery([{ type: 'where', column: 'active', operator: 'eq', value: true }]),
      );
      expect(count).toBe(3);
    });

    it('count all', async () => {
      const count = await adapter.count(buildQuery([]));
      expect(count).toBe(5);
    });

    it('orderBy and limit/offset', async () => {
      const results = await adapter.find({
        table: 'items',
        conditions: [],
        orderBy: [{ column: 'count', order: 'desc' }],
        limit: 2,
        offset: 1,
        joins: [],
      });
      expect(results).toHaveLength(2);
      expect(results[0].count).toBe(40); // Delta
      expect(results[1].count).toBe(30); // Gamma
    });
  });

  describe('Search', () => {
    beforeEach(async () => {
      await adapter.batch([
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({ id: 's1', title: 'TypeScript Guide', count: 0, _status: 'synced' }),
        },
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({ id: 's2', title: 'JavaScript Basics', count: 0, _status: 'synced' }),
        },
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({ id: 's3', title: 'Python Tutorial', count: 0, _status: 'synced' }),
        },
      ]);
    });

    it('searches by term in specified fields', async () => {
      const result = await adapter.search({
        table: 'items',
        term: 'script',
        fields: ['title'],
        conditions: [],
        orderBy: [],
        limit: 50,
        offset: 0,
      });
      expect(result.records).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('returns total count separate from paginated results', async () => {
      const result = await adapter.search({
        table: 'items',
        term: 'script',
        fields: ['title'],
        conditions: [],
        orderBy: [],
        limit: 1,
        offset: 0,
      });
      expect(result.records).toHaveLength(1);
      expect(result.total).toBe(2);
    });
  });

  describe('Sync helpers', () => {
    it('getLocalChanges returns created/updated/deleted records', async () => {
      await adapter.batch([
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({ id: 'lc1', title: 'Created', _status: 'created' }),
        },
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({ id: 'lc2', title: 'Updated', _status: 'updated' }),
        },
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({ id: 'lc3', title: 'Deleted', _status: 'deleted' }),
        },
        {
          type: 'create',
          table: 'items',
          rawRecord: makeRaw({ id: 'lc4', title: 'Synced', _status: 'synced' }),
        },
      ]);

      const changes = await adapter.getLocalChanges(['items']);
      expect(changes.items.created).toHaveLength(1);
      expect(changes.items.created[0].id).toBe('lc1');
      expect(changes.items.updated).toHaveLength(1);
      expect(changes.items.updated[0].id).toBe('lc2');
      expect(changes.items.deleted).toEqual(['lc3']);
    });

    it('applyRemoteChanges creates, updates, and deletes', async () => {
      // Existing record
      await adapter.insert('items', makeRaw({ id: 'rc1', title: 'Existing', _status: 'synced' }));

      await adapter.applyRemoteChanges({
        items: {
          created: [makeRaw({ id: 'rc2', title: 'New from server' })],
          updated: [
            {
              ...makeRaw({ id: 'rc1', title: 'Updated from server' }),
              _status: 'synced',
            } as RawRecord,
          ],
          deleted: [],
        },
      });

      const rc1 = await adapter.findById('items', 'rc1');
      const rc2 = await adapter.findById('items', 'rc2');
      expect(rc1!.title).toBe('Updated from server');
      expect(rc2!.title).toBe('New from server');
      expect(rc2!._status).toBe('synced');
    });

    it('applyRemoteChanges handles upsert (created record already exists)', async () => {
      await adapter.insert('items', makeRaw({ id: 'dup1', title: 'Original' }));

      await adapter.applyRemoteChanges({
        items: {
          created: [makeRaw({ id: 'dup1', title: 'Server version' })],
          updated: [],
          deleted: [],
        },
      });

      const found = await adapter.findById('items', 'dup1');
      expect(found!.title).toBe('Server version');
      expect(found!._status).toBe('synced');
    });

    it('markAsSynced sets _status and clears _changed', async () => {
      await adapter.insert(
        'items',
        makeRaw({ id: 'ms1', title: 'Dirty', _status: 'created', _changed: 'title' }),
      );

      await adapter.markAsSynced('items', ['ms1']);

      const found = await adapter.findById('items', 'ms1');
      expect(found!._status).toBe('synced');
      expect(found!._changed).toBe('');
    });
  });

  describe('Schema version', () => {
    it('returns the schema version', async () => {
      const version = await adapter.getSchemaVersion();
      expect(version).toBe(1);
    });
  });

  describe('Migration', () => {
    it('creates a new table via migration', async () => {
      await adapter.migrate([
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [
            {
              type: 'createTable',
              schema: {
                name: 'new_items',
                columns: [{ name: 'id', type: 'text' as any, isOptional: false, isIndexed: false }],
              },
            },
          ],
        },
      ]);

      // Should be able to insert into the new table
      await adapter.insert('new_items', { id: 'ni1' } as RawRecord);
      const found = await adapter.findById('new_items', 'ni1');
      expect(found).not.toBeNull();
    });

    it('destroys a table via migration', async () => {
      // Items table exists from setup
      await adapter.migrate([
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [
            {
              type: 'destroyTable',
              table: 'items',
            },
          ],
        },
      ]);

      expect(() => adapter['_getCollection']('items')).toThrow();
    });
  });

  describe('Reset', () => {
    it('clears all data', async () => {
      await adapter.insert('items', makeRaw({ id: 'r1', title: 'Data' }));

      await adapter.reset();

      // After reset, we need to re-initialize
      await adapter.initialize(testSchema);

      const count = await adapter.count({
        table: 'items',
        conditions: [],
        orderBy: [],
        joins: [],
      });
      expect(count).toBe(0);
    });
  });

  describe('Error handling', () => {
    it('throws when accessing non-existent collection', async () => {
      await expect(adapter.findById('nonexistent', 'id')).rejects.toThrow('not found');
    });
  });
});
