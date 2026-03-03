/**
 * Batch operation tests — regression tests for db.batch().
 *
 * Covers:
 * - Batch create, update, delete, destroyPermanently operations
 * - Collection change notifications after batch (regression: batch previously
 *   bypassed _notifyChange, so live queries / observeCount never updated)
 * - observeQuery / observeCount reactivity with batch operations
 * - Mixed-table batch operations notify all affected collections
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';

// ─── Schemas ───────────────────────────────────────────────────────────

const TodoSchema = m.model('todos', {
  title: m.text(),
  isCompleted: m.boolean().default(false),
  priority: m.number().default(0),
});

class Todo extends Model<typeof TodoSchema> {
  static schema = TodoSchema;
}

const TagSchema = m.model('tags', {
  name: m.text(),
});

class Tag extends Model<typeof TagSchema> {
  static schema = TagSchema;
}

// ─── Helpers ───────────────────────────────────────────────────────────

async function setup() {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: `batch-test-${Date.now()}` }),
    models: [Todo, Tag],
  });
  await db.initialize();
  return db;
}

/** Wait for async emissions (observeQuery/observeCount are async) */
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Database.batch()', () => {
  let db: Database;

  beforeEach(async () => {
    db = await setup();
  });

  afterEach(async () => {
    await db.close();
  });

  // ── Basic batch operations ─────────────────────────────────────────

  describe('batch destroyPermanently', () => {
    it('deletes multiple records atomically', async () => {
      // Create records one-by-one
      const ids: string[] = [];
      await db.write(async () => {
        for (let i = 0; i < 5; i++) {
          const todo = await db.get(Todo).create({ title: `Item ${i}` });
          ids.push(todo.id);
        }
      });

      expect(await db.get(Todo).count()).toBe(5);

      // Batch delete all
      await db.write(async () => {
        await db.batch(
          ids.map((id) => ({ type: 'destroyPermanently' as const, table: 'todos', id })),
        );
      });

      expect(await db.get(Todo).count()).toBe(0);
    });

    it('deletes a subset of records', async () => {
      const todos: Todo[] = [];
      await db.write(async () => {
        for (let i = 0; i < 10; i++) {
          todos.push(await db.get(Todo).create({ title: `Item ${i}`, isCompleted: i % 2 === 0 }));
        }
      });

      // Delete only completed (even-indexed)
      const completed = todos.filter((_, i) => i % 2 === 0);
      await db.write(async () => {
        await db.batch(
          completed.map((t) => ({ type: 'destroyPermanently' as const, table: 'todos', id: t.id })),
        );
      });

      const remaining = await db.get(Todo).fetch(db.get(Todo).query());
      expect(remaining).toHaveLength(5);
      // All remaining should be non-completed
      for (const r of remaining) {
        expect(r.getField('isCompleted')).toBe(false);
      }
    });
  });

  describe('batch with empty operations', () => {
    it('handles empty batch gracefully', async () => {
      await db.write(async () => {
        await db.batch([]);
      });
      // No error thrown
    });
  });

  // ── Collection change notifications (REGRESSION) ──────────────────

  describe('collection notifications after batch', () => {
    it('fires changes$ after batch destroyPermanently', async () => {
      const todo = await db.write(async () => {
        return db.get(Todo).create({ title: 'Watch me' });
      });

      const events: string[] = [];
      const unsub = db.get(Todo).changes$.subscribe((e) => events.push(e.type));

      await db.write(async () => {
        await db.batch([
          { type: 'destroyPermanently', table: 'todos', id: todo.id },
        ]);
      });

      expect(events.length).toBeGreaterThanOrEqual(1);
      unsub();
    });

    it('fires changes$ after batch with multiple operations', async () => {
      const todos: Todo[] = [];
      await db.write(async () => {
        for (let i = 0; i < 3; i++) {
          todos.push(await db.get(Todo).create({ title: `Item ${i}` }));
        }
      });

      const events: string[] = [];
      const unsub = db.get(Todo).changes$.subscribe((e) => events.push(e.type));

      await db.write(async () => {
        await db.batch(
          todos.map((t) => ({ type: 'destroyPermanently' as const, table: 'todos', id: t.id })),
        );
      });

      // At least one notification should have fired
      expect(events.length).toBeGreaterThanOrEqual(1);
      unsub();
    });

    it('notifies all affected collections in a multi-table batch', async () => {
      const todo = await db.write(async () => {
        return db.get(Todo).create({ title: 'A todo' });
      });
      const tag = await db.write(async () => {
        return db.get(Tag).create({ name: 'urgent' });
      });

      const todoEvents: string[] = [];
      const tagEvents: string[] = [];
      const unsub1 = db.get(Todo).changes$.subscribe((e) => todoEvents.push(e.type));
      const unsub2 = db.get(Tag).changes$.subscribe((e) => tagEvents.push(e.type));

      await db.write(async () => {
        await db.batch([
          { type: 'destroyPermanently', table: 'todos', id: todo.id },
          { type: 'destroyPermanently', table: 'tags', id: tag.id },
        ]);
      });

      expect(todoEvents.length).toBeGreaterThanOrEqual(1);
      expect(tagEvents.length).toBeGreaterThanOrEqual(1);

      unsub1();
      unsub2();
    });

    it('does not notify unaffected collections', async () => {
      const todo = await db.write(async () => {
        return db.get(Todo).create({ title: 'Only todos' });
      });

      const tagEvents: string[] = [];
      const unsub = db.get(Tag).changes$.subscribe((e) => tagEvents.push(e.type));

      await db.write(async () => {
        await db.batch([
          { type: 'destroyPermanently', table: 'todos', id: todo.id },
        ]);
      });

      expect(tagEvents).toHaveLength(0);
      unsub();
    });
  });

  // ── Live query reactivity with batch (REGRESSION) ─────────────────

  describe('observeQuery updates after batch', () => {
    it('observeQuery re-emits after batch destroyPermanently', async () => {
      await db.write(async () => {
        for (let i = 0; i < 5; i++) {
          await db.get(Todo).create({ title: `Item ${i}` });
        }
      });

      const snapshots: number[] = [];
      const unsub = db
        .get(Todo)
        .observeQuery(db.get(Todo).query())
        .subscribe((records) => {
          snapshots.push(records.length);
        });

      await tick();
      expect(snapshots.at(-1)).toBe(5);

      // Batch delete all
      const all = await db.get(Todo).fetch(db.get(Todo).query());
      await db.write(async () => {
        await db.batch(
          all.map((t) => ({ type: 'destroyPermanently' as const, table: 'todos', id: t.id })),
        );
      });

      await tick();
      expect(snapshots.at(-1)).toBe(0);

      unsub();
    });

    it('observeQuery re-emits after batch with partial delete', async () => {
      await db.write(async () => {
        for (let i = 0; i < 10; i++) {
          await db.get(Todo).create({ title: `Item ${i}`, isCompleted: i < 4 });
        }
      });

      const snapshots: number[] = [];
      const unsub = db
        .get(Todo)
        .observeQuery(db.get(Todo).query())
        .subscribe((records) => {
          snapshots.push(records.length);
        });

      await tick();
      expect(snapshots.at(-1)).toBe(10);

      // Delete only completed
      const completed = await db.get(Todo).fetch(
        db.get(Todo).query((qb) => qb.where('isCompleted', 'eq', true)),
      );
      await db.write(async () => {
        await db.batch(
          completed.map((t) => ({ type: 'destroyPermanently' as const, table: 'todos', id: t.id })),
        );
      });

      await tick();
      expect(snapshots.at(-1)).toBe(6);

      unsub();
    });
  });

  describe('observeCount updates after batch', () => {
    it('count updates to 0 after batch delete all', async () => {
      await db.write(async () => {
        for (let i = 0; i < 5; i++) {
          await db.get(Todo).create({ title: `Item ${i}` });
        }
      });

      const counts: number[] = [];
      const unsub = db
        .get(Todo)
        .observeCount()
        .subscribe((c) => {
          counts.push(c);
        });

      await tick();
      expect(counts.at(-1)).toBe(5);

      const all = await db.get(Todo).fetch(db.get(Todo).query());
      await db.write(async () => {
        await db.batch(
          all.map((t) => ({ type: 'destroyPermanently' as const, table: 'todos', id: t.id })),
        );
      });

      await tick();
      expect(counts.at(-1)).toBe(0);

      unsub();
    });

    it('filtered count updates after batch delete', async () => {
      await db.write(async () => {
        for (let i = 0; i < 10; i++) {
          await db.get(Todo).create({ title: `Item ${i}`, isCompleted: i % 3 === 0 });
        }
      });

      // Observe completed count
      const completedCounts: number[] = [];
      const unsub = db
        .get(Todo)
        .observeCount(db.get(Todo).query((qb) => qb.where('isCompleted', 'eq', true)))
        .subscribe((c) => {
          completedCounts.push(c);
        });

      await tick();
      const initialCompleted = completedCounts.at(-1)!;
      expect(initialCompleted).toBe(4); // indices 0, 3, 6, 9

      // Delete all completed
      const completed = await db.get(Todo).fetch(
        db.get(Todo).query((qb) => qb.where('isCompleted', 'eq', true)),
      );
      await db.write(async () => {
        await db.batch(
          completed.map((t) => ({ type: 'destroyPermanently' as const, table: 'todos', id: t.id })),
        );
      });

      await tick();
      expect(completedCounts.at(-1)).toBe(0);

      unsub();
    });

    it('total count updates after bulk insert followed by batch delete', async () => {
      // This simulates the exact demo app scenario:
      // 1. Bulk insert 500 records
      // 2. Observe count
      // 3. Batch delete completed records
      // 4. Count should update reactively

      await db.write(async () => {
        for (let i = 0; i < 20; i++) {
          await db.get(Todo).create({
            title: `Todo ${i}`,
            isCompleted: i % 3 === 0,
            priority: i % 5,
          });
        }
      });

      const totalCounts: number[] = [];
      const unsub = db
        .get(Todo)
        .observeCount()
        .subscribe((c) => totalCounts.push(c));

      await tick();
      expect(totalCounts.at(-1)).toBe(20);

      // Batch delete completed
      const completed = await db.get(Todo).fetch(
        db.get(Todo).query((qb) => qb.where('isCompleted', 'eq', true)),
      );
      expect(completed.length).toBe(7); // indices 0, 3, 6, 9, 12, 15, 18

      await db.write(async () => {
        await db.batch(
          completed.map((t) => ({ type: 'destroyPermanently' as const, table: 'todos', id: t.id })),
        );
      });

      await tick();
      expect(totalCounts.at(-1)).toBe(13);

      unsub();
    });
  });

  // ── Requires db.write() ───────────────────────────────────────────

  describe('write guard', () => {
    it('throws if batch called outside db.write()', async () => {
      await expect(
        db.batch([{ type: 'destroyPermanently', table: 'todos', id: 'fake' }]),
      ).rejects.toThrow('db.write()');
    });
  });
});
