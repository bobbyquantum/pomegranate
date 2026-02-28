/**
 * Web-native test suite — LokiAdapter as the web platform's native adapter.
 *
 * React Native Web uses LokiJS (in-memory) as its persistence layer.
 * This suite comprehensively validates Database ↔ LokiAdapter in a
 * browser-like environment (jsdom), proving the full stack works for
 * web deployments.
 *
 * Covers:
 *  - Environment verification (window, document, web APIs)
 *  - Full CRUD through Database → Collection → LokiAdapter
 *  - Batch operations at scale
 *  - All query operators in jsdom
 *  - Full-text search with pagination
 *  - Reactive observation (queries, counts, single records)
 *  - Sync roundtrip (push + pull + conflict resolution)
 *  - Write serialization / transaction safety
 *  - Schema versioning and migration
 *  - Database reset and re-initialization
 *  - Concurrent operations / stress testing
 *  - Error handling under web constraints
 *
 * @jest-environment jsdom
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import type { RawRecord } from '../schema/types';

// ─── Test Schemas ──────────────────────────────────────────────────────

const TaskSchema = m.model('tasks', {
  title: m.text(),
  body: m.text().default(''),
  done: m.boolean().default(false),
  priority: m.number().default(0),
  category: m.text().optional(),
});

class Task extends Model<typeof TaskSchema> {
  static schema = TaskSchema;
}

const ProjectSchema = m.model('projects', {
  name: m.text(),
  description: m.text().default(''),
  active: m.boolean().default(true),
});

class Project extends Model<typeof ProjectSchema> {
  static schema = ProjectSchema;
}

// ─── Helpers ───────────────────────────────────────────────────────────

let dbCounter = 0;

async function createDb() {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: `web-native-${++dbCounter}` }),
    models: [Task, Project],
  });
  await db.initialize();
  return db;
}

/** Wait for async emissions to propagate */
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Web-Native LokiAdapter Suite', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.close();
  });

  // ─── Environment Verification ────────────────────────────────────

  describe('Browser environment', () => {
    it('runs inside jsdom (window + document exist)', () => {
      expect(typeof globalThis.window).toBe('object');
      expect(typeof document).toBe('object');
      expect(typeof navigator).toBe('object');
    });

    it('has Web APIs available (setTimeout, Promise, queueMicrotask)', () => {
      expect(typeof setTimeout).toBe('function');
      expect(typeof Promise).toBe('function');
      expect(typeof queueMicrotask).toBe('function');
    });

    it('supports structuredClone or JSON round-trip', () => {
      // jsdom may or may not have structuredClone; JSON is always available
      const obj = { a: 1, b: [2, 3], c: null };
      const clone = JSON.parse(JSON.stringify(obj));
      expect(clone).toEqual(obj);
    });
  });

  // ─── Full CRUD ──────────────────────────────────────────────────────

  describe('CRUD through Database → Collection → LokiAdapter', () => {
    it('creates a record and retrieves it', async () => {
      const tasks = db.collection('tasks');

      const task = await db.write(async () => {
        return tasks.create({ title: 'Web CRUD', body: 'created in jsdom', priority: 5 });
      });

      expect(task.id).toBeDefined();
      expect(task.getField('title')).toBe('Web CRUD');
      expect(task.getField('body')).toBe('created in jsdom');
      expect(task.getField('priority')).toBe(5);
    });

    it('finds a record by ID', async () => {
      const tasks = db.collection('tasks');

      const created = await db.write(() => tasks.create({ title: 'Find me' }));
      const found = await tasks.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.getField('title')).toBe('Find me');
    });

    it('returns null for non-existent ID', async () => {
      const tasks = db.collection('tasks');
      const found = await tasks.findById('does-not-exist');
      expect(found).toBeNull();
    });

    it('updates a record', async () => {
      const tasks = db.collection('tasks');

      const task = await db.write(() => tasks.create({ title: 'Before' }));
      await db.write(() => task.update({ title: 'After' }));

      const refreshed = await tasks.findById(task.id);
      expect(refreshed!.getField('title')).toBe('After');
    });

    it('soft-deletes a record', async () => {
      const tasks = db.collection('tasks');

      const task = await db.write(() => tasks.create({ title: 'Delete me' }));
      await db.write(() => task.markAsDeleted());

      // Soft-deleted: excluded from default queries
      const qb = tasks.query();
      const results = await tasks.fetch(qb);
      expect(results).toHaveLength(0);

      // But still in the adapter with _status = 'deleted'
      const raw = await db._adapter.findById('tasks', task.id);
      expect(raw!._status).toBe('deleted');
    });

    it('permanently destroys a record', async () => {
      const tasks = db.collection('tasks');

      const task = await db.write(() => tasks.create({ title: 'Destroy me' }));
      await db.write(() => task.destroyPermanently());

      const raw = await db._adapter.findById('tasks', task.id);
      expect(raw).toBeNull();
    });

    it('prevents mutations outside db.write()', async () => {
      const tasks = db.collection('tasks');
      await expect(tasks.create({ title: 'Nope' })).rejects.toThrow(/write/i);
    });
  });

  // ─── Batch Operations ──────────────────────────────────────────────

  describe('Batch operations', () => {
    it('creates many records in a single write', async () => {
      const tasks = db.collection('tasks');

      await db.write(async () => {
        for (let i = 0; i < 50; i++) {
          await tasks.create({ title: `Task #${i}`, priority: i });
        }
      });

      const count = await tasks.count();
      expect(count).toBe(50);
    });

    it('mixes create, update, and delete in one batch', async () => {
      const tasks = db.collection('tasks');

      // Create initial records
      const [t1, t2, t3] = await db.write(async () => {
        const a = await tasks.create({ title: 'Keep' });
        const b = await tasks.create({ title: 'Update' });
        const c = await tasks.create({ title: 'Remove' });
        return [a, b, c];
      });

      // Mix of operations
      await db.write(async () => {
        await t2.update({ title: 'Updated' });
        await t3.markAsDeleted();
        await tasks.create({ title: 'New' });
      });

      const qb = tasks.query();
      const results = await tasks.fetch(qb);
      const titles = results.map((r) => r.getField('title')).sort();

      expect(titles).toEqual(['Keep', 'New', 'Updated']);
    });

    it('handles 500 records efficiently', async () => {
      const tasks = db.collection('tasks');
      const start = performance.now();

      await db.write(async () => {
        for (let i = 0; i < 500; i++) {
          await tasks.create({ title: `Bulk ${i}`, priority: i % 10 });
        }
      });

      const elapsed = performance.now() - start;
      const count = await tasks.count();
      expect(count).toBe(500);
      // Should complete in reasonable time (< 5s in jsdom)
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ─── Query Operators ───────────────────────────────────────────────

  describe('Query operators in web environment', () => {
    beforeEach(async () => {
      await db.write(async () => {
        const tasks = db.collection('tasks');
        await tasks.create({ title: 'Alpha', priority: 1, done: 0, category: 'work' });
        await tasks.create({ title: 'Beta', priority: 2, done: 1, category: 'personal' });
        await tasks.create({ title: 'Gamma', priority: 3, done: 0, category: 'work' });
        await tasks.create({ title: 'Delta', priority: 4, done: 1, category: null as any });
        await tasks.create({ title: 'Epsilon', priority: 5, done: 0, category: 'personal' });
      });
    });

    it('eq', async () => {
      const tasks = db.collection('tasks');
      const qb = tasks.query((q: any) => q.where('title', 'eq', 'Alpha'));
      const results = await tasks.fetch(qb);
      expect(results).toHaveLength(1);
      expect(results[0].getField('title')).toBe('Alpha');
    });

    it('neq', async () => {
      const tasks = db.collection('tasks');
      const qb = tasks.query((q: any) => q.where('title', 'neq', 'Alpha'));
      const results = await tasks.fetch(qb);
      expect(results).toHaveLength(4);
    });

    it('gt / gte / lt / lte', async () => {
      const tasks = db.collection('tasks');

      const gt3 = await tasks.fetch(tasks.query((q: any) => q.where('priority', 'gt', 3)));
      expect(gt3).toHaveLength(2); // Delta(4), Epsilon(5)

      const gte3 = await tasks.fetch(tasks.query((q: any) => q.where('priority', 'gte', 3)));
      expect(gte3).toHaveLength(3); // Gamma(3), Delta(4), Epsilon(5)

      const lt3 = await tasks.fetch(tasks.query((q: any) => q.where('priority', 'lt', 3)));
      expect(lt3).toHaveLength(2); // Alpha(1), Beta(2)

      const lte3 = await tasks.fetch(tasks.query((q: any) => q.where('priority', 'lte', 3)));
      expect(lte3).toHaveLength(3); // Alpha(1), Beta(2), Gamma(3)
    });

    it('in / notIn', async () => {
      const tasks = db.collection('tasks');

      const inResults = await tasks.fetch(
        tasks.query((q: any) => q.where('category', 'in', ['work', 'personal'])),
      );
      expect(inResults).toHaveLength(4); // All except Delta (null category)

      const notInResults = await tasks.fetch(
        tasks.query((q: any) => q.where('category', 'notIn', ['work'])),
      );
      // personal + null
      expect(notInResults.length).toBeGreaterThanOrEqual(2);
    });

    it('like (pattern matching)', async () => {
      const tasks = db.collection('tasks');

      const endsWith = await tasks.fetch(
        tasks.query((q: any) => q.where('title', 'like', '%lpha')),
      );
      expect(endsWith).toHaveLength(1);
      expect(endsWith[0].getField('title')).toBe('Alpha');

      const contains = await tasks.fetch(tasks.query((q: any) => q.where('title', 'like', '%eta')));
      expect(contains).toHaveLength(1);
    });

    it('between', async () => {
      const tasks = db.collection('tasks');
      const qb = tasks.query((q: any) => q.where('priority', 'between', [2, 4]));
      const results = await tasks.fetch(qb);
      expect(results).toHaveLength(3); // Beta(2), Gamma(3), Delta(4)
    });

    it('isNull / isNotNull', async () => {
      const tasks = db.collection('tasks');

      const nullCat = await tasks.fetch(
        tasks.query((q: any) => q.where('category', 'isNull', null)),
      );
      expect(nullCat).toHaveLength(1);
      expect(nullCat[0].getField('title')).toBe('Delta');

      const notNull = await tasks.fetch(
        tasks.query((q: any) => q.where('category', 'isNotNull', null)),
      );
      expect(notNull).toHaveLength(4);
    });

    it('boolean queries with normalization (true/false → 1/0)', async () => {
      const tasks = db.collection('tasks');

      // Boolean true should match stored value 1
      const doneTrue = await tasks.fetch(tasks.query((q: any) => q.where('done', 'eq', true)));
      expect(doneTrue).toHaveLength(2); // Beta(done=1), Delta(done=1)

      // Boolean false should match stored value 0
      const doneFalse = await tasks.fetch(tasks.query((q: any) => q.where('done', 'eq', false)));
      expect(doneFalse).toHaveLength(3);
    });

    it('AND conditions', async () => {
      const tasks = db.collection('tasks');
      const qb = tasks.query((q: any) => {
        q.where('category', 'eq', 'work');
        q.where('priority', 'gt', 1);
      });
      const results = await tasks.fetch(qb);
      expect(results).toHaveLength(1);
      expect(results[0].getField('title')).toBe('Gamma');
    });

    it('orderBy + limit + offset', async () => {
      const tasks = db.collection('tasks');
      const qb = tasks.query((q: any) => {
        q.orderBy('priority', 'desc');
        q.limit(2);
        q.offset(1);
      });
      const results = await tasks.fetch(qb);
      expect(results).toHaveLength(2);
      expect(results[0].getField('priority')).toBe(4);
      expect(results[1].getField('priority')).toBe(3);
    });

    it('count with conditions', async () => {
      const tasks = db.collection('tasks');
      const qb = tasks.query((q: any) => q.where('category', 'eq', 'work'));
      const count = await tasks.count(qb);
      expect(count).toBe(2);
    });

    it('empty query returns all non-deleted', async () => {
      const tasks = db.collection('tasks');
      const count = await tasks.count();
      expect(count).toBe(5);
    });
  });

  // ─── Full-Text Search ──────────────────────────────────────────────

  describe('Full-text search', () => {
    beforeEach(async () => {
      await db.write(async () => {
        const tasks = db.collection('tasks');
        await tasks.create({
          title: 'TypeScript Guide',
          body: 'Learn TS from scratch',
          priority: 1,
        });
        await tasks.create({ title: 'JavaScript Basics', body: 'JS fundamentals', priority: 2 });
        await tasks.create({ title: 'Python Tutorial', body: 'Snake language', priority: 3 });
        await tasks.create({
          title: 'React Native Web',
          body: 'Build with TypeScript',
          priority: 4,
        });
        await tasks.create({ title: 'Node.js Handbook', body: 'Server-side JS', priority: 5 });
      });
    });

    it('searches across specified fields', async () => {
      const tasks = db.collection('tasks');
      const result = await tasks.search({ term: 'typescript', fields: ['title', 'body'] });
      expect(result.total).toBe(2); // "TypeScript Guide" + "React Native Web" (body has TypeScript)
      expect(result.records).toHaveLength(2);
    });

    it('case-insensitive search', async () => {
      const tasks = db.collection('tasks');
      const result = await tasks.search({ term: 'TYPESCRIPT', fields: ['title'] });
      expect(result.total).toBe(1);
      expect(result.records[0].getField('title')).toBe('TypeScript Guide');
    });

    it('paginates search results', async () => {
      const tasks = db.collection('tasks');

      const page1 = await tasks.search({
        term: 'script',
        fields: ['title'],
        limit: 1,
        offset: 0,
      });
      expect(page1.records).toHaveLength(1);
      expect(page1.total).toBe(2);

      const page2 = await tasks.search({
        term: 'script',
        fields: ['title'],
        limit: 1,
        offset: 1,
      });
      expect(page2.records).toHaveLength(1);
      expect(page2.total).toBe(2);

      // Different records
      expect(page1.records[0].id).not.toBe(page2.records[0].id);
    });

    it('returns empty for no matches', async () => {
      const tasks = db.collection('tasks');
      const result = await tasks.search({ term: 'xyzzy', fields: ['title'] });
      expect(result.records).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ─── Reactive Observation ──────────────────────────────────────────

  describe('Reactive observation', () => {
    it('observeCount emits initial and subsequent values', async () => {
      const tasks = db.collection('tasks');
      const counts: number[] = [];

      const obs = tasks.observeCount();
      const unsub = obs.subscribe((n: number) => counts.push(n));

      await tick();
      expect(counts).toContain(0);

      await db.write(() => tasks.create({ title: 'One' }));
      await tick();
      expect(counts).toContain(1);

      await db.write(() => tasks.create({ title: 'Two' }));
      await tick();
      expect(counts).toContain(2);

      unsub();
    });

    it('observeQuery emits matching records reactively', async () => {
      const tasks = db.collection('tasks');
      const snapshots: any[][] = [];

      const qb = tasks.query((q: any) => q.where('priority', 'gte', 5));
      const obs = tasks.observeQuery(qb);
      const unsub = obs.subscribe((records: any) => snapshots.push(records));

      await tick();
      expect(snapshots.at(-1)).toHaveLength(0);

      await db.write(() => tasks.create({ title: 'High', priority: 10 }));
      await tick();
      expect(snapshots.at(-1)).toHaveLength(1);

      await db.write(() => tasks.create({ title: 'Low', priority: 1 }));
      await tick();
      // Low-priority shouldn't appear in results
      expect(snapshots.at(-1)).toHaveLength(1);

      await db.write(() => tasks.create({ title: 'Also high', priority: 7 }));
      await tick();
      expect(snapshots.at(-1)).toHaveLength(2);

      unsub();
    });

    it('observeById emits updates for a specific record', async () => {
      const tasks = db.collection('tasks');
      const emissions: any[] = [];

      const task = await db.write(() => tasks.create({ title: 'Observe me', priority: 0 }));

      const obs = tasks.observeById(task.id);
      const unsub = obs.subscribe((r: any) => emissions.push(r));

      await tick();
      expect(emissions.at(-1)?.getField('title')).toBe('Observe me');

      await db.write(() => task.update({ title: 'Changed' }));
      await tick();
      expect(emissions.at(-1)?.getField('title')).toBe('Changed');

      unsub();
    });

    it('observeById emits null when record is deleted', async () => {
      const tasks = db.collection('tasks');
      const emissions: any[] = [];

      const task = await db.write(() => tasks.create({ title: 'Will be deleted' }));

      const obs = tasks.observeById(task.id);
      const unsub = obs.subscribe((r: any) => emissions.push(r));
      await tick();

      await db.write(() => task.markAsDeleted());
      await tick();

      expect(emissions.at(-1)).toBeNull();
      unsub();
    });

    it('unsubscribe stops further emissions', async () => {
      const tasks = db.collection('tasks');
      const counts: number[] = [];

      const obs = tasks.observeCount();
      const unsub = obs.subscribe((n: number) => counts.push(n));

      await tick();
      unsub();

      const countBefore = counts.length;
      await db.write(() => tasks.create({ title: 'After unsub' }));
      await tick();

      // No new emissions after unsubscribe
      expect(counts.length).toBe(countBefore);
    });
  });

  // ─── Multi-Table Support ───────────────────────────────────────────

  describe('Multi-table operations', () => {
    it('operates on multiple tables independently', async () => {
      const tasks = db.collection('tasks');
      const projects = db.collection('projects');

      await db.write(async () => {
        await tasks.create({ title: 'Task A' });
        await tasks.create({ title: 'Task B' });
        await projects.create({ name: 'Project X' });
      });

      const taskCount = await tasks.count();
      const projectCount = await projects.count();

      expect(taskCount).toBe(2);
      expect(projectCount).toBe(1);
    });

    it('queries across tables do not interfere', async () => {
      const tasks = db.collection('tasks');
      const projects = db.collection('projects');

      await db.write(async () => {
        await tasks.create({ title: 'Same name', priority: 1 });
        await projects.create({ name: 'Same name' });
      });

      const taskResults = await tasks.fetch(tasks.query((q: any) => q.where('priority', 'eq', 1)));
      expect(taskResults).toHaveLength(1);

      const allProjects = await projects.fetch(projects.query());
      expect(allProjects).toHaveLength(1);
    });
  });

  // ─── Sync Roundtrip ───────────────────────────────────────────────

  describe('Sync roundtrip in web environment', () => {
    it('pushes local changes and pulls remote changes', async () => {
      const tasks = db.collection('tasks');

      // Create local record
      const task = await db.write(() => tasks.create({ title: 'Local task', priority: 1 }));

      let pushedChanges: any = null;

      await db.sync({
        pushChanges: async ({ changes }) => {
          pushedChanges = changes;
        },
        pullChanges: async () => ({
          changes: {
            tasks: {
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

      // Verify push payload
      expect(pushedChanges).not.toBeNull();
      expect(pushedChanges.tasks.created.length).toBe(1);
      expect(pushedChanges.tasks.created[0].title).toBe('Local task');

      // Verify remote record was pulled
      const remote = await db._adapter.findById('tasks', 'remote-1');
      expect(remote).not.toBeNull();
      expect(remote!.title).toBe('From server');
      expect(remote!.priority).toBe(99);
    });

    it('handles pull-only sync (no local changes)', async () => {
      await db.sync({
        pushChanges: async () => {},
        pullChanges: async () => ({
          changes: {
            tasks: {
              created: [
                {
                  id: 'pulled-1',
                  title: 'Pulled',
                  body: '',
                  done: 0,
                  priority: 0,
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
          timestamp: 1000,
        }),
      });

      const record = await db._adapter.findById('tasks', 'pulled-1');
      expect(record).not.toBeNull();
      expect(record!.title).toBe('Pulled');
    });

    it('marks pushed records as synced', async () => {
      const tasks = db.collection('tasks');

      await db.write(() => tasks.create({ title: 'Will sync' }));

      await db.sync({
        pushChanges: async () => {},
        pullChanges: async () => ({
          changes: {},
          timestamp: Date.now(),
        }),
      });

      // After sync, the record should be marked as synced
      const changes = await db._adapter.getLocalChanges(['tasks']);
      expect(changes.tasks.created).toHaveLength(0);
    });

    it('deletes are pushed and then permanently removed', async () => {
      const tasks = db.collection('tasks');

      const task = await db.write(() => tasks.create({ title: 'To be synced then deleted' }));

      // First sync to push the create
      await db.sync({
        pushChanges: async () => {},
        pullChanges: async () => ({ changes: {}, timestamp: 100 }),
      });

      // Now delete
      await db.write(() => task.markAsDeleted());

      let pushedDeletes: string[] = [];
      await db.sync({
        pushChanges: async ({ changes }) => {
          pushedDeletes = changes.tasks?.deleted ?? [];
        },
        pullChanges: async () => ({ changes: {}, timestamp: 200 }),
      });

      expect(pushedDeletes).toContain(task.id);

      // After sync, soft-deleted record should be permanently removed
      const raw = await db._adapter.findById('tasks', task.id);
      expect(raw).toBeNull();
    });
  });

  // ─── Write Serialization ──────────────────────────────────────────

  describe('Write serialization', () => {
    it('serializes concurrent writes', async () => {
      const tasks = db.collection('tasks');
      const order: number[] = [];

      const p1 = db.write(async () => {
        order.push(1);
        await tasks.create({ title: 'First' });
      });

      const p2 = db.write(async () => {
        order.push(2);
        await tasks.create({ title: 'Second' });
      });

      const p3 = db.write(async () => {
        order.push(3);
        await tasks.create({ title: 'Third' });
      });

      await Promise.all([p1, p2, p3]);

      expect(order).toEqual([1, 2, 3]);
      expect(await tasks.count()).toBe(3);
    });

    it('a failed write does not block subsequent writes', async () => {
      const tasks = db.collection('tasks');

      const failedWrite = db
        .write(async () => {
          throw new Error('Intentional failure');
        })
        .catch(() => {}); // swallow

      await failedWrite;

      // Next write should still work
      await db.write(() => tasks.create({ title: 'After failure' }));

      expect(await tasks.count()).toBe(1);
    });
  });

  // ─── Schema Version & Migration ───────────────────────────────────

  describe('Schema version and migration', () => {
    it('reports schema version', async () => {
      const version = await db._adapter.getSchemaVersion();
      expect(version).toBe(1);
    });

    it('creates a new table via migration', async () => {
      await db._adapter.migrate([
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [
            {
              type: 'createTable',
              schema: {
                name: 'comments',
                columns: [
                  { name: 'id', type: 'text' as any, isOptional: false, isIndexed: false },
                  { name: 'text', type: 'text' as any, isOptional: false, isIndexed: false },
                ],
              },
            },
          ],
        },
      ]);

      // Can insert into the new table directly via adapter
      await db._adapter.insert('comments', {
        id: 'c1',
        text: 'Hello',
        _status: 'created',
        _changed: '',
      } as RawRecord);
      const found = await db._adapter.findById('comments', 'c1');
      expect(found).not.toBeNull();
      expect(found!.text).toBe('Hello');
    });

    it('destroys a table via migration', async () => {
      await db._adapter.migrate([
        {
          fromVersion: 1,
          toVersion: 2,
          steps: [{ type: 'destroyTable', table: 'projects' }],
        },
      ]);

      await expect(db._adapter.findById('projects', 'anything')).rejects.toThrow(/not found/i);
    });
  });

  // ─── Reset & Re-initialization ────────────────────────────────────

  describe('Reset and re-initialization', () => {
    it('reset clears all data', async () => {
      const tasks = db.collection('tasks');

      await db.write(() => tasks.create({ title: 'Will be gone' }));
      expect(await tasks.count()).toBe(1);

      await db.reset();
      await db.initialize();

      expect(await tasks.count()).toBe(0);
    });

    it('database works normally after reset + re-init', async () => {
      await db.reset();
      await db.initialize();

      const tasks = db.collection('tasks');
      await db.write(() => tasks.create({ title: 'After reset' }));

      const results = await tasks.fetch(tasks.query());
      expect(results).toHaveLength(1);
      expect(results[0].getField('title')).toBe('After reset');
    });
  });

  // ─── Concurrent Operations ─────────────────────────────────────────

  describe('Concurrent operations & stress', () => {
    it('handles rapid sequential creates and queries', async () => {
      const tasks = db.collection('tasks');

      await db.write(async () => {
        for (let i = 0; i < 100; i++) {
          await tasks.create({ title: `Rapid ${i}`, priority: i % 5 });
        }
      });

      // Query immediately after
      const highPri = await tasks.fetch(tasks.query((q: any) => q.where('priority', 'eq', 4)));
      expect(highPri).toHaveLength(20);
    });

    it('interleaved reads and writes remain consistent', async () => {
      const tasks = db.collection('tasks');

      await db.write(async () => {
        await tasks.create({ title: 'Initial', priority: 0 });
      });

      // Read
      const before = await tasks.count();
      expect(before).toBe(1);

      // Write more
      await db.write(async () => {
        await tasks.create({ title: 'Added', priority: 1 });
      });

      // Read again
      const after = await tasks.count();
      expect(after).toBe(2);
    });

    it('multiple observers get consistent data', async () => {
      const tasks = db.collection('tasks');
      const observer1: number[] = [];
      const observer2: number[] = [];

      const obs = tasks.observeCount();
      const unsub1 = obs.subscribe((n: number) => observer1.push(n));
      const unsub2 = obs.subscribe((n: number) => observer2.push(n));

      await tick();

      await db.write(() => tasks.create({ title: 'Shared' }));
      await tick();

      // Both observers should have the same values
      expect(observer1).toEqual(observer2);
      expect(observer1).toContain(0);
      expect(observer1).toContain(1);

      unsub1();
      unsub2();
    });
  });

  // ─── Edge Cases & Error Handling ──────────────────────────────────

  describe('Edge cases and error handling', () => {
    it('handles empty string fields', async () => {
      const tasks = db.collection('tasks');

      const task = await db.write(() => tasks.create({ title: '', body: '', priority: 0 }));

      expect(task.getField('title')).toBe('');
      expect(task.getField('body')).toBe('');
    });

    it('handles records with null optional fields', async () => {
      const tasks = db.collection('tasks');

      const task = await db.write(() => tasks.create({ title: 'No category' }));

      expect(task.getField('category')).toBeNull();
    });

    it('handles unicode in text fields', async () => {
      const tasks = db.collection('tasks');

      const task = await db.write(() =>
        tasks.create({ title: '日本語テスト 🚀 émojis!', body: 'Ñoño café' }),
      );

      expect(task.getField('title')).toBe('日本語テスト 🚀 émojis!');
      expect(task.getField('body')).toBe('Ñoño café');
    });

    it('findByIdOrFail throws for missing records', async () => {
      const tasks = db.collection('tasks');
      await expect(tasks.findByIdOrFail('ghost')).rejects.toThrow(/not found/i);
    });

    it('accessing non-existent collection throws', () => {
      expect(() => db.collection('nonexistent')).toThrow();
    });

    it('double initialization is a no-op', async () => {
      // Should not throw
      await db.initialize();
      const tasks = db.collection('tasks');
      await db.write(() => tasks.create({ title: 'After double init' }));
      expect(await tasks.count()).toBe(1);
    });

    it('search with zero results returns empty array', async () => {
      const tasks = db.collection('tasks');
      const result = await tasks.search({ term: 'nothing', fields: ['title'] });
      expect(result.records).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ─── Database Events ──────────────────────────────────────────────

  describe('Database events', () => {
    it('emits write_started and write_completed events', async () => {
      const events: string[] = [];
      const unsub = db.events$.subscribe((e: any) => events.push(e.type));

      await db.write(async () => {
        const tasks = db.collection('tasks');
        await tasks.create({ title: 'Event test' });
      });

      expect(events).toContain('write_started');
      expect(events).toContain('write_completed');
      unsub();
    });

    it('emits reset event', async () => {
      const events: string[] = [];
      const unsub = db.events$.subscribe((e: any) => events.push(e.type));

      await db.reset();

      expect(events).toContain('reset');
      unsub();
    });
  });

  // ─── LokiAdapter Direct Access ────────────────────────────────────

  describe('LokiAdapter direct access (low-level)', () => {
    it('adapter is LokiAdapter instance', () => {
      expect(db._adapter).toBeInstanceOf(LokiAdapter);
    });

    it('batch supports all operation types', async () => {
      const adapter = db._adapter;

      await adapter.batch([
        {
          type: 'create',
          table: 'tasks',
          rawRecord: {
            id: 'raw-1',
            title: 'A',
            body: '',
            done: 0,
            priority: 0,
            category: null,
            _status: 'created',
            _changed: '',
          } as RawRecord,
        },
        {
          type: 'create',
          table: 'tasks',
          rawRecord: {
            id: 'raw-2',
            title: 'B',
            body: '',
            done: 0,
            priority: 0,
            category: null,
            _status: 'created',
            _changed: '',
          } as RawRecord,
        },
      ]);

      const r1 = await adapter.findById('tasks', 'raw-1');
      const r2 = await adapter.findById('tasks', 'raw-2');
      expect(r1!.title).toBe('A');
      expect(r2!.title).toBe('B');

      // Update + Delete in batch
      await adapter.batch([
        { type: 'update', table: 'tasks', rawRecord: { ...r1!, title: 'Updated A' } as RawRecord },
        { type: 'delete', table: 'tasks', id: 'raw-2' },
      ]);

      const r1After = await adapter.findById('tasks', 'raw-1');
      const r2After = await adapter.findById('tasks', 'raw-2');
      expect(r1After!.title).toBe('Updated A');
      expect(r2After!._status).toBe('deleted');

      // Destroy permanently
      await adapter.batch([{ type: 'destroyPermanently', table: 'tasks', id: 'raw-2' }]);
      expect(await adapter.findById('tasks', 'raw-2')).toBeNull();
    });

    it('getLocalChanges correctly categorizes records', async () => {
      const adapter = db._adapter;

      await adapter.batch([
        {
          type: 'create',
          table: 'tasks',
          rawRecord: { id: 'lc-1', title: 'C', _status: 'created', _changed: 'title' } as RawRecord,
        },
        {
          type: 'create',
          table: 'tasks',
          rawRecord: { id: 'lc-2', title: 'U', _status: 'updated', _changed: 'title' } as RawRecord,
        },
        {
          type: 'create',
          table: 'tasks',
          rawRecord: { id: 'lc-3', title: 'D', _status: 'deleted', _changed: '' } as RawRecord,
        },
        {
          type: 'create',
          table: 'tasks',
          rawRecord: { id: 'lc-4', title: 'S', _status: 'synced', _changed: '' } as RawRecord,
        },
      ]);

      const changes = await adapter.getLocalChanges(['tasks']);
      expect(changes.tasks.created).toHaveLength(1);
      expect(changes.tasks.created[0].id).toBe('lc-1');
      expect(changes.tasks.updated).toHaveLength(1);
      expect(changes.tasks.updated[0].id).toBe('lc-2');
      expect(changes.tasks.deleted).toEqual(['lc-3']);
    });

    it('applyRemoteChanges handles upsert', async () => {
      const adapter = db._adapter;

      await adapter.insert('tasks', {
        id: 'up-1',
        title: 'Original',
        _status: 'synced',
        _changed: '',
      } as RawRecord);

      await adapter.applyRemoteChanges({
        tasks: {
          created: [
            { id: 'up-1', title: 'From server', _status: 'synced', _changed: '' } as RawRecord,
          ],
          updated: [],
          deleted: [],
        },
      });

      const found = await adapter.findById('tasks', 'up-1');
      expect(found!.title).toBe('From server');
      expect(found!._status).toBe('synced');
    });

    it('markAsSynced sets _status to synced and clears _changed', async () => {
      const adapter = db._adapter;

      await adapter.insert('tasks', {
        id: 'ms-1',
        title: 'Dirty',
        _status: 'created',
        _changed: 'title',
      } as RawRecord);
      await adapter.markAsSynced('tasks', ['ms-1']);

      const found = await adapter.findById('tasks', 'ms-1');
      expect(found!._status).toBe('synced');
      expect(found!._changed).toBe('');
    });
  });
});
