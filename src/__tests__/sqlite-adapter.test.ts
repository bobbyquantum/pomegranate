/**
 * SQLiteAdapter tests backed by better-sqlite3.
 *
 * These tests exercise the real SQL adapter in Node so coverage reflects
 * actual adapter behavior instead of only the in-memory Loki path.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

import { SQLiteAdapter } from '../adapters/sqlite/SQLiteAdapter';
import type { SQLiteDriver } from '../adapters/sqlite/SQLiteAdapter';
import type { Migration } from '../adapters/types';
import type { BatchOperation, QueryDescriptor, SearchDescriptor } from '../query/types';
import type { DatabaseSchema, RawRecord } from '../schema/types';

const schema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'items',
      columns: [
        { name: 'title', type: 'text', isOptional: false, isIndexed: true },
        { name: 'body', type: 'text', isOptional: false, isIndexed: false },
        { name: 'count', type: 'number', isOptional: false, isIndexed: false },
        { name: 'active', type: 'boolean', isOptional: false, isIndexed: false },
        { name: 'tag', type: 'text', isOptional: true, isIndexed: true },
      ],
    },
  ],
};

function query(overrides: Partial<QueryDescriptor> = {}): QueryDescriptor {
  return {
    table: 'items',
    conditions: [],
    orderBy: [],
    joins: [],
    ...overrides,
  };
}

function search(overrides: Partial<SearchDescriptor> = {}): SearchDescriptor {
  return {
    table: 'items',
    term: '',
    fields: ['title', 'body'],
    conditions: [],
    orderBy: [],
    limit: 20,
    offset: 0,
    ...overrides,
  };
}

function raw(id: string, overrides: Partial<RawRecord> = {}): RawRecord {
  return {
    id,
    title: `Title ${id}`,
    body: `Body ${id}`,
    count: 0,
    active: 1,
    tag: null,
    _status: 'created',
    _changed: '',
    ...overrides,
  } as RawRecord;
}

type DriverState = {
  closeCalls: number;
  executeBatchCalls: number;
  executeBatchNoTxCalls: number;
  executeInTransactionCalls: number;
  statements: string[];
};

type TestDriver = SQLiteDriver & {
  readonly state: DriverState;
  rawQuery: (sql: string, bindings?: unknown[]) => Record<string, unknown>[];
};

function createTestDriver(options?: {
  enableBatch?: boolean;
  enableBatchNoTx?: boolean;
  failMetadataQuery?: boolean;
}): TestDriver {
  let db: BetterSqlite3.Database | null = null;
  const state: DriverState = {
    closeCalls: 0,
    executeBatchCalls: 0,
    executeBatchNoTxCalls: 0,
    executeInTransactionCalls: 0,
    statements: [],
  };

  const driver: TestDriver = {
    state,
    async open(name: string) {
      db = new BetterSqlite3(name);
    },
    async execute(sql: string, bindings: unknown[] = []) {
      state.statements.push(sql);
      db!.prepare(sql).run(...bindings);
    },
    async query(sql: string, bindings: unknown[] = []) {
      state.statements.push(sql);
      if (
        options?.failMetadataQuery &&
        sql.includes('__pomegranate_metadata') &&
        sql.includes('schema_version')
      ) {
        throw new Error('metadata unavailable');
      }
      return db!.prepare(sql).all(...bindings) as Record<string, unknown>[];
    },
    async executeInTransaction(fn: () => Promise<void>) {
      state.executeInTransactionCalls++;
      await driver.execute('BEGIN IMMEDIATE');
      try {
        await fn();
        await driver.execute('COMMIT');
      } catch (error) {
        try {
          await driver.execute('ROLLBACK');
        } catch {
          // Preserve the original error when rollback also fails.
        }
        throw error;
      }
    },
    async close() {
      state.closeCalls++;
      db?.close();
      db = null;
    },
    rawQuery(sql: string, bindings: unknown[] = []) {
      return db!.prepare(sql).all(...bindings) as Record<string, unknown>[];
    },
  };

  if (options?.enableBatch) {
    driver.executeBatch = async (commands) => {
      state.executeBatchCalls++;
      await driver.executeInTransaction(async () => {
        for (const [sql, bindings] of commands) {
          await driver.execute(sql, bindings);
        }
      });
    };
  }

  if (options?.enableBatchNoTx) {
    driver.executeBatchNoTx = async (commands) => {
      state.executeBatchNoTxCalls++;
      for (const [sql, bindings] of commands) {
        await driver.execute(sql, bindings);
      }
    };
  }

  return driver;
}

function tempDbPath(name: string): string {
  return path.join(os.tmpdir(), `pomegranate-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe('SQLiteAdapter', () => {
  describe('driver configuration', () => {
    it('throws when no driver is configured', async () => {
      const adapter = new SQLiteAdapter({ databaseName: ':memory:' });
      await expect(adapter.initialize(schema)).rejects.toThrow('No SQLite driver configured');
    });

    it('returns zero schema version if metadata query fails', async () => {
      const driver = createTestDriver({ failMetadataQuery: true });
      const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
      await expect(adapter.getSchemaVersion()).resolves.toBe(0);
    });
  });

  describe('initialization and schema versioning', () => {
    it('creates tables and stores the schema version', async () => {
      const driver = createTestDriver();
      const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });

      await adapter.initialize(schema);

      expect(await adapter.getSchemaVersion()).toBe(1);
      const tables = driver.rawQuery(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('items', '__pomegranate_metadata') ORDER BY name",
      );
      expect(tables.map((row) => row.name)).toEqual(['__pomegranate_metadata', 'items']);

      await adapter.close();
    });

    it('skips fresh-install table creation when metadata already exists', async () => {
      const databaseName = tempDbPath('reopen');

      const driver1 = createTestDriver();
      const adapter1 = new SQLiteAdapter({ databaseName, driver: driver1 });
      await adapter1.initialize(schema);
      await adapter1.insert('items', raw('persisted', { title: 'Persisted row' }));
      await adapter1.close();

      const driver2 = createTestDriver();
      const adapter2 = new SQLiteAdapter({ databaseName, driver: driver2 });
      await adapter2.initialize(schema);

      const found = await adapter2.findById('items', 'persisted');
      expect(found?.title).toBe('Persisted row');
      expect(await adapter2.getSchemaVersion()).toBe(1);

      await adapter2.close();
      fs.rmSync(databaseName, { force: true });
    });
  });

  describe('CRUD and querying', () => {
    let driver: TestDriver;
    let adapter: SQLiteAdapter;

    beforeEach(async () => {
      driver = createTestDriver();
      adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
      await adapter.initialize(schema);
    });

    afterEach(async () => {
      await adapter.close();
    });

    it('inserts, finds, counts, updates, soft-deletes, and destroys records', async () => {
      await adapter.insert('items', raw('a1', { title: 'Alpha', count: 1, tag: 'work' }));
      await adapter.insert('items', raw('a2', { title: 'Beta', count: 2, tag: 'home' }));

      expect(await adapter.count(query())).toBe(2);
      const alpha = await adapter.findById('items', 'a1');
      expect(alpha?.title).toBe('Alpha');

      const results = await adapter.find(
        query({
          conditions: [{ type: 'where', column: 'count', operator: 'gte', value: 2 }],
          orderBy: [{ column: 'count', order: 'desc' }],
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('a2');

      await adapter.update('items', raw('a2', {
        title: 'Beta updated',
        body: 'Updated body',
        count: 3,
        active: 0,
        tag: 'updated',
        _status: 'updated',
        _changed: 'title,body,count,active,tag',
      }));
      const updated = await adapter.findById('items', 'a2');
      expect(updated?.title).toBe('Beta updated');

      await adapter.markAsDeleted('items', 'a1');
      const deleted = await adapter.findById('items', 'a1');
      expect(deleted?._status).toBe('deleted');

      await adapter.destroyPermanently('items', 'a1');
      expect(await adapter.findById('items', 'a1')).toBeNull();
    });

    it('supports search, logical conditions, limit, and offset', async () => {
      await adapter.batch([
        { type: 'create', table: 'items', rawRecord: raw('s1', { title: 'TypeScript', body: 'Guide', tag: 'lang' }) },
        { type: 'create', table: 'items', rawRecord: raw('s2', { title: 'JavaScript', body: 'Basics', tag: 'lang' }) },
        { type: 'create', table: 'items', rawRecord: raw('s3', { title: 'Python', body: 'Scripting', tag: 'snake' }) },
      ]);

      const found = await adapter.find(
        query({
          conditions: [
            {
              type: 'or',
              conditions: [
                { type: 'where', column: 'title', operator: 'like', value: '%Script%' },
                { type: 'not', condition: { type: 'where', column: 'tag', operator: 'eq', value: 'snake' } },
              ],
            },
          ],
          orderBy: [{ column: 'title', order: 'asc' }],
          limit: 2,
          offset: 0,
        }),
      );
      expect(found).toHaveLength(2);

      const searchResults = await adapter.search(
        search({
          term: 'script',
          fields: ['title'],
          orderBy: [{ column: 'title', order: 'asc' }],
          limit: 1,
          offset: 1,
        }),
      );
      expect(searchResults.total).toBe(2);
      expect(searchResults.records).toHaveLength(1);
      expect(searchResults.records[0].title).toBe('TypeScript');
    });
  });

  describe('transactions and batch execution paths', () => {
    it('rolls back write transactions when the callback throws', async () => {
      const driver = createTestDriver();
      const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
      await adapter.initialize(schema);

      await expect(
        adapter.writeTransaction(async () => {
          await adapter.insert('items', raw('tx1'));
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(await adapter.count(query())).toBe(0);
      expect(driver.state.statements).toContain('ROLLBACK');

      await adapter.close();
    });

    it('allows nested write transactions without opening a second transaction', async () => {
      const driver = createTestDriver();
      const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
      await adapter.initialize(schema);

      await adapter.writeTransaction(async () => {
        await adapter.insert('items', raw('outer'));
        await adapter.writeTransaction(async () => {
          await adapter.insert('items', raw('inner'));
        });
      });

      expect(await adapter.count(query())).toBe(2);
      expect(driver.state.statements.filter((sql) => sql === 'BEGIN IMMEDIATE')).toHaveLength(1);

      await adapter.close();
    });

    it('uses executeBatch when available outside a write transaction', async () => {
      const driver = createTestDriver({ enableBatch: true });
      const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
      await adapter.initialize(schema);

      await adapter.batch([
        { type: 'create', table: 'items', rawRecord: raw('b1') },
        { type: 'create', table: 'items', rawRecord: raw('b2') },
      ]);

      expect(driver.state.executeBatchCalls).toBe(1);
      expect(await adapter.count(query())).toBe(2);

      await adapter.close();
    });

    it('uses executeBatchNoTx when already inside a write transaction', async () => {
      const driver = createTestDriver({ enableBatch: true, enableBatchNoTx: true });
      const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
      await adapter.initialize(schema);

      await adapter.writeTransaction(async () => {
        await adapter.batch([
          { type: 'create', table: 'items', rawRecord: raw('w1') },
          { type: 'create', table: 'items', rawRecord: raw('w2') },
        ]);
      });

      expect(driver.state.executeBatchNoTxCalls).toBe(1);
      expect(driver.state.executeBatchCalls).toBe(0);
      expect(await adapter.count(query())).toBe(2);

      await adapter.close();
    });

    it('falls back to executeInTransaction when native batching is unavailable', async () => {
      const driver = createTestDriver();
      const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
      await adapter.initialize(schema);

      const operations: BatchOperation[] = [
        { type: 'create', table: 'items', rawRecord: raw('f1') },
        { type: 'update', table: 'items', rawRecord: raw('f1', { title: 'Updated once', _status: 'updated', _changed: 'title' }) },
        { type: 'delete', table: 'items', id: 'f1' },
      ];

      await adapter.batch(operations);

      expect(driver.state.executeInTransactionCalls).toBe(1);
      const softDeleted = await adapter.findById('items', 'f1');
      expect(softDeleted?._status).toBe('deleted');

      await adapter.batch([{ type: 'destroyPermanently', table: 'items', id: 'f1' }]);
      expect(await adapter.findById('items', 'f1')).toBeNull();

      await adapter.close();
    });
  });

  describe('sync helpers and migrations', () => {
    let driver: TestDriver;
    let adapter: SQLiteAdapter;

    beforeEach(async () => {
      driver = createTestDriver();
      adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
      await adapter.initialize(schema);
    });

    afterEach(async () => {
      await adapter.close();
    });

    it('returns local changes and marks records as synced', async () => {
      await adapter.insert('items', raw('c1', { _status: 'created' }));
      await adapter.insert('items', raw('u1', { _status: 'updated' }));
      await adapter.insert('items', raw('d1', { _status: 'deleted' }));

      const changes = await adapter.getLocalChanges(['items']);
      expect(changes.items.created).toHaveLength(1);
      expect(changes.items.updated).toHaveLength(1);
      expect(changes.items.deleted).toEqual(['d1']);

      await adapter.markAsSynced('items', ['c1', 'u1']);
      await adapter.markAsSynced('items', []);

      const syncedCreated = await adapter.findById('items', 'c1');
      const syncedUpdated = await adapter.findById('items', 'u1');
      expect(syncedCreated?._status).toBe('synced');
      expect(syncedUpdated?._changed).toBe('');
    });

    it('applies remote creates, updates, upserts, and deletes', async () => {
      await adapter.insert('items', raw('existing', { title: 'Local', _status: 'updated', _changed: 'title' }));
      await adapter.insert('items', raw('remove-me', { title: 'To remove', _status: 'synced' }));

      await adapter.applyRemoteChanges({
        items: {
          created: [raw('new-remote', { title: 'Created remotely', _status: 'created', _changed: 'title' })],
          updated: [
            raw('existing', { title: 'Updated remotely', _status: 'updated', _changed: 'title' }),
            raw('upserted', { title: 'Inserted from update branch', _status: 'updated', _changed: 'title' }),
          ],
          deleted: ['remove-me'],
        },
      });

      const createdRemote = await adapter.findById('items', 'new-remote');
      const updatedRemote = await adapter.findById('items', 'existing');
      const upsertedRemote = await adapter.findById('items', 'upserted');
      expect(createdRemote?.title).toBe('Created remotely');
      expect(createdRemote?._status).toBe('synced');
      expect(updatedRemote?.title).toBe('Updated remotely');
      expect(upsertedRemote?.title).toBe('Inserted from update branch');
      expect(await adapter.findById('items', 'remove-me')).toBeNull();
    });

    it('runs createTable, addColumn, sql, and destroyTable migrations in order', async () => {
      const migrations: Migration[] = [
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [
            {
              type: 'createTable',
              schema: {
                name: 'notes',
                columns: [{ name: 'title', type: 'text', isOptional: false, isIndexed: false }],
              },
            },
            {
              type: 'addColumn',
              table: 'items',
              column: 'category',
              columnType: 'TEXT',
              isOptional: true,
            },
            {
              type: 'sql',
              query: "UPDATE \"items\" SET \"category\" = 'migrated' WHERE \"id\" IS NOT NULL",
            },
          ],
        },
        {
          fromVersion: 2,
          toVersion: 3,
          steps: [{ type: 'destroyTable', table: 'notes' }],
        },
      ];

      await adapter.insert('items', raw('m1'));
      await adapter.migrate(migrations);

      expect(await adapter.getSchemaVersion()).toBe(3);
      const columns = driver.rawQuery('PRAGMA table_info("items")');
      expect(columns.some((column) => column.name === 'category')).toBe(true);
      expect(driver.rawQuery('SELECT "category" FROM "items" WHERE "id" = ?', ['m1'])[0].category).toBe('migrated');

      const notesTable = driver.rawQuery(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='notes'",
      );
      expect(notesTable).toHaveLength(0);
    });
  });

  describe('reset and close', () => {
    it('drops user tables and allows re-initialization', async () => {
      const driver = createTestDriver();
      const adapter = new SQLiteAdapter({ databaseName: ':memory:', driver });
      await adapter.initialize(schema);
      await adapter.insert('items', raw('r1'));

      await adapter.reset();
      await adapter.initialize(schema);

      expect(await adapter.count(query())).toBe(0);
      await adapter.close();
      expect(driver.state.closeCalls).toBe(1);
    });
  });
});
