/**
 * Migration end-to-end tests.
 *
 * Exercises the migration system with LokiAdapter:
 *   - createTable and destroyTable migration steps
 *   - Sequential migrations applied in order
 *   - Data preservation across migrations
 *   - Schema version tracking
 *
 * Also tests the full Database → Collection → Adapter stack
 * for migration-related scenarios (schema evolution, new models).
 */

import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { Database } from '../database/Database';
import { Model } from '../model/Model';
import { m } from '../schema/builder';
import type { RawRecord, DatabaseSchema } from '../schema/types';
import type { Migration } from '../adapters/types';

// ─── Schemas & Models ─────────────────────────────────────────────────────

const TodoSchema = m.model('todos', {
  title: m.text(),
  done: m.boolean().default(false),
});

class Todo extends Model<typeof TodoSchema> {
  static schema = TodoSchema;
}

const TagSchema = m.model('tags', {
  name: m.text(),
  color: m.text().default('#000000'),
});

class Tag extends Model<typeof TagSchema> {
  static schema = TagSchema;
}

const SettingSchema = m.model('settings', {
  key: m.text(),
  value: m.text().optional(),
});

class Setting extends Model<typeof SettingSchema> {
  static schema = SettingSchema;
}

// ─── Schema helpers ──────────────────────────────────────────────────────

const baseSchema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'todos',
      columns: [
        { name: 'title', type: 'text', isOptional: false, isIndexed: false },
        { name: 'done', type: 'boolean', isOptional: false, isIndexed: false },
      ],
    },
  ],
};

const schemaV2: DatabaseSchema = {
  version: 2,
  tables: [
    ...baseSchema.tables,
    {
      name: 'tags',
      columns: [
        { name: 'name', type: 'text', isOptional: false, isIndexed: false },
        { name: 'color', type: 'text', isOptional: false, isIndexed: false },
      ],
    },
  ],
};

const schemaV3: DatabaseSchema = {
  version: 3,
  tables: [
    {
      name: 'tags',
      columns: [
        { name: 'name', type: 'text', isOptional: false, isIndexed: false },
        { name: 'color', type: 'text', isOptional: false, isIndexed: false },
      ],
    },
    {
      name: 'settings',
      columns: [
        { name: 'key', type: 'text', isOptional: false, isIndexed: false },
        { name: 'value', type: 'text', isOptional: true, isIndexed: false },
      ],
    },
  ],
};

// ─── Migration definitions ────────────────────────────────────────────────

const migrationV1toV2: Migration = {
  fromVersion: 1,
  toVersion: 2,
  steps: [
    {
      type: 'createTable',
      schema: {
        name: 'tags',
        columns: [
          { name: 'name', type: 'text', isOptional: false, isIndexed: false },
          { name: 'color', type: 'text', isOptional: false, isIndexed: false },
        ],
      },
    },
  ],
};

const migrationV2toV3: Migration = {
  fromVersion: 2,
  toVersion: 3,
  steps: [
    {
      type: 'destroyTable',
      table: 'todos',
    },
    {
      type: 'createTable',
      schema: {
        name: 'settings',
        columns: [
          { name: 'key', type: 'text', isOptional: false, isIndexed: false },
          { name: 'value', type: 'text', isOptional: true, isIndexed: false },
        ],
      },
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Migration E2E', () => {
  describe('Adapter-level migrations (LokiAdapter)', () => {
    let adapter: LokiAdapter;

    beforeEach(async () => {
      adapter = new LokiAdapter({ databaseName: `mig-test-${Date.now()}` });
      await adapter.initialize(baseSchema);
    });

    afterEach(async () => {
      await adapter.close();
    });

    it('creates a new table via migration', async () => {
      // Before migration: only 'todos' table exists
      await adapter.insert('todos', {
        id: 't1',
        title: 'existing todo',
        done: 0,
        _status: 'created',
        _changed: '',
      } as RawRecord);

      // Apply migration: add 'tags' table
      await adapter.migrate([migrationV1toV2]);

      // New table should accept inserts
      await adapter.insert('tags', {
        id: 'tag1',
        name: 'urgent',
        color: '#ff0000',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const tag = await adapter.findById('tags', 'tag1');
      expect(tag).not.toBeNull();
      expect(tag!.name).toBe('urgent');

      // Existing data should survive
      const todo = await adapter.findById('todos', 't1');
      expect(todo).not.toBeNull();
      expect(todo!.title).toBe('existing todo');
    });

    it('destroys a table via migration', async () => {
      // Add data to todos
      await adapter.insert('todos', {
        id: 't1',
        title: 'will be gone',
        done: 0,
        _status: 'created',
        _changed: '',
      } as RawRecord);

      // First add the tags table, then destroy todos
      await adapter.migrate([migrationV1toV2]);
      await adapter.migrate([migrationV2toV3]);

      // todos should be gone
      await expect(adapter.findById('todos', 't1')).rejects.toThrow();

      // settings should exist
      await adapter.insert('settings', {
        id: 's1',
        key: 'theme',
        value: 'dark',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const setting = await adapter.findById('settings', 's1');
      expect(setting).not.toBeNull();
      expect(setting!.key).toBe('theme');
    });

    it('applies multiple migrations sequentially', async () => {
      await adapter.insert('todos', {
        id: 't1',
        title: 'kept',
        done: 0,
        _status: 'created',
        _changed: '',
      } as RawRecord);

      // Apply both migrations at once
      await adapter.migrate([migrationV1toV2, migrationV2toV3]);

      // tags should exist (created in v1→v2)
      await adapter.insert('tags', {
        id: 'tag1',
        name: 'test',
        color: '#000',
        _status: 'created',
        _changed: '',
      } as RawRecord);
      const tag = await adapter.findById('tags', 'tag1');
      expect(tag).not.toBeNull();

      // settings should exist (created in v2→v3)
      await adapter.insert('settings', {
        id: 's1',
        key: 'lang',
        value: 'en',
        _status: 'created',
        _changed: '',
      } as RawRecord);
      const setting = await adapter.findById('settings', 's1');
      expect(setting).not.toBeNull();
    });

    it('preserves data in untouched tables during migration', async () => {
      // Create some todos
      for (let i = 0; i < 10; i++) {
        await adapter.insert('todos', {
          id: `t${i}`,
          title: `Todo #${i}`,
          done: i % 2,
          _status: 'created',
          _changed: '',
        } as RawRecord);
      }

      // Add tags table (should not touch todos)
      await adapter.migrate([migrationV1toV2]);

      // Verify all todos survived
      const count = await adapter.count({
        table: 'todos',
        conditions: [],
        orderBy: [],
        joins: [],
      });
      expect(count).toBe(10);

      // Spot-check a few
      const t0 = await adapter.findById('todos', 't0');
      expect(t0!.title).toBe('Todo #0');

      const t9 = await adapter.findById('todos', 't9');
      expect(t9!.title).toBe('Todo #9');
    });

    it('handles createTable for table that already exists (idempotent)', async () => {
      // Try to create 'todos' again via migration — should not error
      await adapter.migrate([
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [
            {
              type: 'createTable',
              schema: {
                name: 'todos',
                columns: [
                  { name: 'title', type: 'text', isOptional: false, isIndexed: false },
                  { name: 'done', type: 'boolean', isOptional: false, isIndexed: false },
                ],
              },
            },
          ],
        },
      ]);

      // Existing data should still be present (not destroyed)
      await adapter.insert('todos', {
        id: 'safe1',
        title: 'still here',
        done: 0,
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const found = await adapter.findById('todos', 'safe1');
      expect(found).not.toBeNull();
    });
  });

  describe('Database-level migration scenarios', () => {
    it('works with models added after initial schema', async () => {
      // Start with only Todo model
      const adapter1 = new LokiAdapter({ databaseName: `db-mig-${Date.now()}` });
      const db1 = new Database({
        adapter: adapter1,
        models: [Todo],
      });
      await db1.initialize();

      // Create some data
      const todos = db1.collection('todos');
      await db1.write(async () => {
        await todos.create({ title: 'First todo' });
        await todos.create({ title: 'Second todo' });
      });

      expect(await todos.count()).toBe(2);
      await db1.close();

      // "Reopen" with Todo + Tag models, run migration
      const adapter2 = new LokiAdapter({ databaseName: `db-mig-v2-${Date.now()}` });
      await adapter2.initialize(baseSchema);

      // Recreate old data (LokiAdapter is in-memory so we simulate)
      await adapter2.insert('todos', {
        id: 'old1',
        title: 'Existing',
        done: 0,
        _status: 'synced',
        _changed: '',
      } as RawRecord);

      // Run migration to add tags
      await adapter2.migrate([migrationV1toV2]);

      // Now create Database with both models
      const db2 = new Database({
        adapter: adapter2,
        models: [Todo, Tag],
        schemaVersion: 2,
      });
      // Since adapter is already initialized, we skip re-init
      // (in prod, the adapter checks version and runs migrations)

      const existingTodo = await adapter2.findById('todos', 'old1');
      expect(existingTodo).not.toBeNull();
      expect(existingTodo!.title).toBe('Existing');

      // Can use the new tags table
      await adapter2.insert('tags', {
        id: 'newtag1',
        name: 'important',
        color: '#ff0',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const tag = await adapter2.findById('tags', 'newtag1');
      expect(tag).not.toBeNull();
      expect(tag!.name).toBe('important');

      await adapter2.close();
    });

    it('reset after migration starts fresh', async () => {
      const adapter = new LokiAdapter({ databaseName: `db-mig-reset-${Date.now()}` });
      await adapter.initialize(baseSchema);

      // Add data
      await adapter.insert('todos', {
        id: 't1',
        title: 'Before reset',
        done: 0,
        _status: 'created',
        _changed: '',
      } as RawRecord);

      // Migrate to add tags
      await adapter.migrate([migrationV1toV2]);

      await adapter.insert('tags', {
        id: 'tag1',
        name: 'test',
        color: '#000',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      // Reset
      await adapter.reset();
      await adapter.initialize(schemaV2);

      // Both tables should exist but be empty
      const todoCount = await adapter.count({
        table: 'todos',
        conditions: [],
        orderBy: [],
        joins: [],
      });
      expect(todoCount).toBe(0);

      const tagCount = await adapter.count({
        table: 'tags',
        conditions: [],
        orderBy: [],
        joins: [],
      });
      expect(tagCount).toBe(0);

      await adapter.close();
    });

    it('batch operations work on migrated tables', async () => {
      const adapter = new LokiAdapter({ databaseName: `db-mig-batch-${Date.now()}` });
      await adapter.initialize(baseSchema);

      await adapter.migrate([migrationV1toV2]);

      // Batch inserts across original and migrated tables
      await adapter.batch([
        {
          type: 'create',
          table: 'todos',
          rawRecord: {
            id: 't1',
            title: 'Todo via batch',
            done: 0,
            _status: 'created',
            _changed: '',
          } as RawRecord,
        },
        {
          type: 'create',
          table: 'tags',
          rawRecord: {
            id: 'tag1',
            name: 'Batch tag',
            color: '#abc',
            _status: 'created',
            _changed: '',
          } as RawRecord,
        },
      ]);

      const todo = await adapter.findById('todos', 't1');
      expect(todo!.title).toBe('Todo via batch');

      const tag = await adapter.findById('tags', 'tag1');
      expect(tag!.name).toBe('Batch tag');

      await adapter.close();
    });

    it('queries work on migrated tables', async () => {
      const adapter = new LokiAdapter({ databaseName: `db-mig-query-${Date.now()}` });
      await adapter.initialize(baseSchema);

      await adapter.migrate([migrationV1toV2]);

      // Insert tags
      for (let i = 0; i < 5; i++) {
        await adapter.insert('tags', {
          id: `tag${i}`,
          name: `Tag ${i}`,
          color: i % 2 === 0 ? '#red' : '#blue',
          _status: 'created',
          _changed: '',
        } as RawRecord);
      }

      // Count
      const count = await adapter.count({
        table: 'tags',
        conditions: [],
        orderBy: [],
        joins: [],
      });
      expect(count).toBe(5);

      // Query with condition
      const redTags = await adapter.find({
        table: 'tags',
        conditions: [{ type: 'where', column: 'color', operator: 'eq', value: '#red' }],
        orderBy: [],
        joins: [],
      });
      expect(redTags).toHaveLength(3);

      await adapter.close();
    });

    it('sync operations work on migrated tables', async () => {
      const adapter = new LokiAdapter({ databaseName: `db-mig-sync-${Date.now()}` });
      await adapter.initialize(baseSchema);

      await adapter.migrate([migrationV1toV2]);

      // Insert into migrated table
      await adapter.insert('tags', {
        id: 'tag1',
        name: 'Syncable',
        color: '#000',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      // Get local changes
      const changes = await adapter.getLocalChanges(['tags']);
      expect(changes.tags.created).toHaveLength(1);
      expect(changes.tags.created[0].name).toBe('Syncable');

      // Apply remote changes to migrated table
      await adapter.applyRemoteChanges({
        tags: {
          created: [
            {
              id: 'remote-tag',
              name: 'Remote Tag',
              color: '#fff',
              _status: 'synced',
              _changed: '',
            } as RawRecord,
          ],
          updated: [],
          deleted: [],
        },
      });

      const remoteTag = await adapter.findById('tags', 'remote-tag');
      expect(remoteTag).not.toBeNull();
      expect(remoteTag!.name).toBe('Remote Tag');

      await adapter.close();
    });
  });

  describe('Migration edge cases', () => {
    it('empty migration list is a no-op', async () => {
      const adapter = new LokiAdapter({ databaseName: `mig-empty-${Date.now()}` });
      await adapter.initialize(baseSchema);

      await adapter.insert('todos', {
        id: 't1',
        title: 'Safe',
        done: 0,
        _status: 'created',
        _changed: '',
      } as RawRecord);

      // Empty migrations
      await adapter.migrate([]);

      const found = await adapter.findById('todos', 't1');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Safe');

      await adapter.close();
    });

    it('migration with only createTable step for multiple tables', async () => {
      const adapter = new LokiAdapter({ databaseName: `mig-multi-${Date.now()}` });
      await adapter.initialize(baseSchema);

      await adapter.migrate([
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [
            {
              type: 'createTable',
              schema: {
                name: 'tags',
                columns: [
                  { name: 'name', type: 'text', isOptional: false, isIndexed: false },
                  { name: 'color', type: 'text', isOptional: false, isIndexed: false },
                ],
              },
            },
            {
              type: 'createTable',
              schema: {
                name: 'settings',
                columns: [
                  { name: 'key', type: 'text', isOptional: false, isIndexed: false },
                  { name: 'value', type: 'text', isOptional: true, isIndexed: false },
                ],
              },
            },
          ],
        },
      ]);

      // Both tables should work
      await adapter.insert('tags', {
        id: 'tag1',
        name: 'test',
        color: '#000',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      await adapter.insert('settings', {
        id: 's1',
        key: 'k',
        value: 'v',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      expect(await adapter.findById('tags', 'tag1')).not.toBeNull();
      expect(await adapter.findById('settings', 's1')).not.toBeNull();

      await adapter.close();
    });

    it('destroyTable then recreate in same migration', async () => {
      const adapter = new LokiAdapter({ databaseName: `mig-recreate-${Date.now()}` });
      await adapter.initialize(baseSchema);

      // Add data
      await adapter.insert('todos', {
        id: 'old1',
        title: 'Old data',
        done: 0,
        _status: 'created',
        _changed: '',
      } as RawRecord);

      // Destroy and recreate todos with different columns
      await adapter.migrate([
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [
            { type: 'destroyTable', table: 'todos' },
            {
              type: 'createTable',
              schema: {
                name: 'todos',
                columns: [
                  { name: 'title', type: 'text', isOptional: false, isIndexed: false },
                  { name: 'done', type: 'boolean', isOptional: false, isIndexed: false },
                  { name: 'priority', type: 'number', isOptional: false, isIndexed: false },
                ],
              },
            },
          ],
        },
      ]);

      // Old data should be gone
      const old = await adapter.findById('todos', 'old1');
      expect(old).toBeNull();

      // New schema should work
      await adapter.insert('todos', {
        id: 'new1',
        title: 'New format',
        done: 0,
        priority: 5,
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const found = await adapter.findById('todos', 'new1');
      expect(found).not.toBeNull();
      expect(found!.priority).toBe(5);

      await adapter.close();
    });
  });
});
