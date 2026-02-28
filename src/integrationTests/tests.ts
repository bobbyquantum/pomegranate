/**
 * PomegranateDB integration tests — platform-agnostic.
 *
 * Exercises the full Database → Collection → Adapter stack.
 * Used by both the React Native Android and Expo test apps.
 */

import { describe, it, beforeEach, afterEach, expect } from './runner';
import { Database } from '../database/Database';
import { Model } from '../model/Model';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { m } from '../schema/builder';
import type { RawRecord } from '../schema/types';
import type { StorageAdapter } from '../adapters/types';

// ─── Schemas ───────────────────────────────────────────────────────────────

const TodoSchema = m.model('todos', {
  title: m.text(),
  body: m.text().default(''),
  done: m.boolean().default(false),
  priority: m.number().default(0),
  category: m.text().optional(),
});

class Todo extends Model<typeof TodoSchema> {
  static schema = TodoSchema;
}

const ProjectSchema = m.model('projects', {
  name: m.text(),
  active: m.boolean().default(true),
});

class Project extends Model<typeof ProjectSchema> {
  static schema = ProjectSchema;
}

// ─── Test Registration ─────────────────────────────────────────────────────

/**
 * Register all integration tests.
 * Call this before `runTests()`.
 *
 * @param createAdapter — factory for the adapter under test.
 *   Defaults to LokiAdapter (in-memory).
 */
export function registerTests(
  createAdapter: () => StorageAdapter = () => new LokiAdapter({ databaseName: 'integration-test' }),
) {
  let db: Database;

  // ─── Database Lifecycle ──────────────────────────────────────────────

  describe('Database lifecycle', () => {
    it('initializes cleanly', async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
      expect(db.tables).toHaveLength(2);
    });

    afterEach(async () => {
      await db.close();
    });
  });

  // ─── CRUD ────────────────────────────────────────────────────────────

  describe('CRUD operations', () => {
    beforeEach(async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
    });

    afterEach(async () => {
      await db.close();
    });

    it('creates a record', async () => {
      const todos = db.collection('todos');
      const todo = await db.write(() => todos.create({ title: 'Hello from native', priority: 5 }));
      expect(todo.id).toBeTruthy();
      expect(todo.getField('title')).toBe('Hello from native');
      expect(todo.getField('priority')).toBe(5);
    });

    it('finds a record by ID', async () => {
      const todos = db.collection('todos');
      const created = await db.write(() => todos.create({ title: 'Find me' }));
      const found = await todos.findById(created.id);
      expect(found).toBeNotNull();
      expect(found!.getField('title')).toBe('Find me');
    });

    it('returns null for missing ID', async () => {
      const todos = db.collection('todos');
      const found = await todos.findById('nonexistent');
      expect(found).toBeNull();
    });

    it('updates a record', async () => {
      const todos = db.collection('todos');
      const todo = await db.write(() => todos.create({ title: 'Before' }));
      await db.write(() => todo.update({ title: 'After' }));
      const refreshed = await todos.findById(todo.id);
      expect(refreshed!.getField('title')).toBe('After');
    });

    it('soft-deletes a record', async () => {
      const todos = db.collection('todos');
      const todo = await db.write(() => todos.create({ title: 'Delete me' }));
      await db.write(() => todo.markAsDeleted());
      const count = await todos.count();
      expect(count).toBe(0); // excluded from default query
    });

    it('permanently destroys a record', async () => {
      const todos = db.collection('todos');
      const todo = await db.write(() => todos.create({ title: 'Destroy me' }));
      await db.write(() => todo.destroyPermanently());
      const raw = await db._adapter.findById('todos', todo.id);
      expect(raw).toBeNull();
    });
  });

  // ─── Batch ───────────────────────────────────────────────────────────

  describe('Batch operations', () => {
    beforeEach(async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
    });

    afterEach(async () => {
      await db.close();
    });

    it('creates many records in one write', async () => {
      const todos = db.collection('todos');
      await db.write(async () => {
        for (let i = 0; i < 100; i++) {
          await todos.create({ title: `Batch #${i}`, priority: i % 5 });
        }
      });
      const count = await todos.count();
      expect(count).toBe(100);
    });

    it('handles mixed create/update/delete', async () => {
      const todos = db.collection('todos');
      const [a, b, c] = await db.write(async () => {
        const x = await todos.create({ title: 'Keep' });
        const y = await todos.create({ title: 'Update' });
        const z = await todos.create({ title: 'Delete' });
        return [x, y, z];
      });

      await db.write(async () => {
        await b.update({ title: 'Updated' });
        await c.markAsDeleted();
      });

      const results = await todos.fetch(todos.query());
      expect(results).toHaveLength(2);
    });
  });

  // ─── Queries ─────────────────────────────────────────────────────────

  describe('Query operators', () => {
    beforeEach(async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
      await db.write(async () => {
        const todos = db.collection('todos');
        await todos.create({ title: 'Alpha', priority: 1, done: 0, category: 'work' });
        await todos.create({ title: 'Beta', priority: 2, done: 1, category: 'personal' });
        await todos.create({ title: 'Gamma', priority: 3, done: 0, category: 'work' });
        await todos.create({ title: 'Delta', priority: 4, done: 1, category: null as any });
        await todos.create({ title: 'Epsilon', priority: 5, done: 0, category: 'personal' });
      });
    });

    afterEach(async () => {
      await db.close();
    });

    it('eq', async () => {
      const todos = db.collection('todos');
      const qb = todos.query((q: any) => q.where('title', 'eq', 'Alpha'));
      const results = await todos.fetch(qb);
      expect(results).toHaveLength(1);
      expect(results[0].getField('title')).toBe('Alpha');
    });

    it('gt / gte / lt / lte', async () => {
      const todos = db.collection('todos');
      const gt3 = await todos.fetch(todos.query((q: any) => q.where('priority', 'gt', 3)));
      expect(gt3).toHaveLength(2);
      const lte3 = await todos.fetch(todos.query((q: any) => q.where('priority', 'lte', 3)));
      expect(lte3).toHaveLength(3);
    });

    it('like', async () => {
      const todos = db.collection('todos');
      const results = await todos.fetch(todos.query((q: any) => q.where('title', 'like', '%lpha')));
      expect(results).toHaveLength(1);
    });

    it('isNull / isNotNull', async () => {
      const todos = db.collection('todos');
      const nullCat = await todos.fetch(
        todos.query((q: any) => q.where('category', 'isNull', null)),
      );
      expect(nullCat).toHaveLength(1);
      expect(nullCat[0].getField('title')).toBe('Delta');
    });

    it('orderBy + limit + offset', async () => {
      const todos = db.collection('todos');
      const qb = todos.query((q: any) => {
        q.orderBy('priority', 'desc');
        q.limit(2);
        q.offset(1);
      });
      const results = await todos.fetch(qb);
      expect(results).toHaveLength(2);
      expect(results[0].getField('priority')).toBe(4);
    });

    it('count with conditions', async () => {
      const todos = db.collection('todos');
      const qb = todos.query((q: any) => q.where('category', 'eq', 'work'));
      const count = await todos.count(qb);
      expect(count).toBe(2);
    });
  });

  // ─── Search ──────────────────────────────────────────────────────────

  describe('Full-text search', () => {
    beforeEach(async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
      await db.write(async () => {
        const todos = db.collection('todos');
        await todos.create({ title: 'TypeScript Guide', body: 'Learn TS', priority: 1 });
        await todos.create({ title: 'JavaScript Basics', body: 'JS 101', priority: 2 });
        await todos.create({ title: 'Python Tutorial', body: 'Snakes', priority: 3 });
      });
    });

    afterEach(async () => {
      await db.close();
    });

    it('searches by term', async () => {
      const todos = db.collection('todos');
      const result = await todos.search({ term: 'script', fields: ['title'] });
      expect(result.total).toBe(2);
      expect(result.records).toHaveLength(2);
    });

    it('paginates results', async () => {
      const todos = db.collection('todos');
      const page1 = await todos.search({ term: 'script', fields: ['title'], limit: 1, offset: 0 });
      expect(page1.records).toHaveLength(1);
      expect(page1.total).toBe(2);
    });
  });

  // ─── Reactive Observation ────────────────────────────────────────────

  describe('Reactive observation', () => {
    beforeEach(async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
    });

    afterEach(async () => {
      await db.close();
    });

    it('observeCount emits updates', async () => {
      const todos = db.collection('todos');
      const counts: number[] = [];
      const obs = todos.observeCount();
      const unsub = obs.subscribe((n: number) => counts.push(n));

      await new Promise((r) => setTimeout(r, 50));
      expect(counts).toContain(0);

      await db.write(() => todos.create({ title: 'One' }));
      await new Promise((r) => setTimeout(r, 50));
      expect(counts).toContain(1);

      unsub();
    });
  });

  // ─── Sync ────────────────────────────────────────────────────────────

  describe('Sync roundtrip', () => {
    beforeEach(async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
    });

    afterEach(async () => {
      await db.close();
    });

    it('pushes local changes and pulls remote', async () => {
      const todos = db.collection('todos');
      await db.write(() => todos.create({ title: 'Local', priority: 1 }));

      let pushed: any = null;
      await db.sync({
        pushChanges: async ({ changes }) => {
          pushed = changes;
        },
        pullChanges: async () => ({
          changes: {
            todos: {
              created: [
                {
                  id: 'remote-1',
                  title: 'From server',
                  body: '',
                  done: 0,
                  priority: 99,
                  category: null,
                  _status: 'synced',
                  _changed: '',
                } as unknown as RawRecord,
              ],
              updated: [],
              deleted: [],
            },
            projects: { created: [], updated: [], deleted: [] },
          },
          timestamp: Date.now(),
        }),
      });

      expect(pushed).toBeNotNull();
      expect(pushed.todos.created).toHaveLength(1);

      const remote = await db._adapter.findById('todos', 'remote-1');
      expect(remote).toBeNotNull();
      expect(remote!.title).toBe('From server');
    });

    it('marks pushed records as synced', async () => {
      const todos = db.collection('todos');
      await db.write(() => todos.create({ title: 'Will sync' }));

      await db.sync({
        pushChanges: async () => {},
        pullChanges: async () => ({ changes: {}, timestamp: Date.now() }),
      });

      const changes = await db._adapter.getLocalChanges(['todos']);
      expect(changes.todos.created).toHaveLength(0);
    });
  });

  // ─── Multi-table ─────────────────────────────────────────────────────

  describe('Multi-table', () => {
    beforeEach(async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
    });

    afterEach(async () => {
      await db.close();
    });

    it('operates on tables independently', async () => {
      const todos = db.collection('todos');
      const projects = db.collection('projects');

      await db.write(async () => {
        await todos.create({ title: 'Task A' });
        await todos.create({ title: 'Task B' });
        await projects.create({ name: 'Project X' });
      });

      expect(await todos.count()).toBe(2);
      expect(await projects.count()).toBe(1);
    });
  });

  // ─── Reset ───────────────────────────────────────────────────────────

  describe('Reset', () => {
    beforeEach(async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
    });

    afterEach(async () => {
      await db.close();
    });

    it('clears all data on reset', async () => {
      const todos = db.collection('todos');
      await db.write(() => todos.create({ title: 'Gone' }));
      expect(await todos.count()).toBe(1);

      await db.reset();
      await db.initialize();
      expect(await todos.count()).toBe(0);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────

  describe('Edge cases', () => {
    beforeEach(async () => {
      db = new Database({
        adapter: createAdapter(),
        models: [Todo, Project],
      });
      await db.initialize();
    });

    afterEach(async () => {
      await db.close();
    });

    it('handles unicode text', async () => {
      const todos = db.collection('todos');
      const todo = await db.write(() =>
        todos.create({ title: '日本語テスト 🚀', body: 'Ñoño café' }),
      );
      expect(todo.getField('title')).toBe('日本語テスト 🚀');
      expect(todo.getField('body')).toBe('Ñoño café');
    });

    it('write serialization', async () => {
      const todos = db.collection('todos');
      const order: number[] = [];

      const p1 = db.write(async () => {
        order.push(1);
        await todos.create({ title: '1' });
      });
      const p2 = db.write(async () => {
        order.push(2);
        await todos.create({ title: '2' });
      });
      const p3 = db.write(async () => {
        order.push(3);
        await todos.create({ title: '3' });
      });

      await Promise.all([p1, p2, p3]);
      expect(order).toEqual([1, 2, 3]);
      expect(await todos.count()).toBe(3);
    });
  });
}
