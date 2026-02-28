/**
 * Collection tests — unit tests for Collection layer.
 *
 * Tests Collection methods directly: observeQuery, observeById,
 * observeCount, cache behavior, and internal notifications.
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';

// ─── Schema ────────────────────────────────────────────────────────────

const NoteSchema = m.model('notes', {
  title: m.text(),
  body: m.text().default(''),
  pinned: m.boolean().default(false),
  sortOrder: m.number().default(0),
});

class Note extends Model<typeof NoteSchema> {
  static schema = NoteSchema;
}

// ─── Helpers ───────────────────────────────────────────────────────────

async function setup() {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: 'collection-test' }),
    models: [Note],
  });
  await db.initialize();
  return db;
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Collection', () => {
  let db: Database;

  beforeEach(async () => {
    db = await setup();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('schema access', () => {
    it('exposes table name', () => {
      expect(db.get(Note).table).toBe('notes');
    });

    it('exposes schema object', () => {
      expect(db.get(Note).schema).toBeDefined();
      expect(db.get(Note).schema.table).toBe('notes');
    });
  });

  describe('cache behavior', () => {
    it('returns same instance for same ID on second findById', async () => {
      const note = await db.write(async () => {
        return db.get(Note).create({ title: 'Cached' });
      });

      const found1 = await db.get(Note).findById(note.id);
      const found2 = await db.get(Note).findById(note.id);
      expect(found1).toBe(found2); // Same object reference
    });

    it('returns same instance via query as via findById', async () => {
      const note = await db.write(async () => {
        return db.get(Note).create({ title: 'Cross-ref' });
      });

      const byId = await db.get(Note).findById(note.id);
      const byQuery = await db.get(Note).fetch(db.get(Note).query());
      const fromQuery = byQuery.find((n) => n.id === note.id);

      expect(byId).toBe(fromQuery); // Same cached instance
    });

    it('clears cache on _clearCache', async () => {
      const note = await db.write(async () => {
        return db.get(Note).create({ title: 'Clear me' });
      });

      const before = await db.get(Note).findById(note.id);
      db.get(Note)._clearCache();
      const after = await db.get(Note).findById(note.id);

      expect(before).not.toBe(after); // Different instances
      expect(before!.id).toBe(after!.id); // Same data
    });
  });

  describe('observeQuery', () => {
    it('emits initial results', async () => {
      await db.write(async () => {
        await db.get(Note).create({ title: 'A' });
        await db.get(Note).create({ title: 'B' });
      });

      const results: Note[][] = [];
      const unsub = db
        .get(Note)
        .observeQuery(db.get(Note).query())
        .subscribe((r) => {
          results.push(r);
        });

      // Wait for async emission
      await new Promise((r) => setTimeout(r, 50));

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.at(-1)).toHaveLength(2);

      unsub();
    });

    it('re-emits when collection changes', async () => {
      const results: Note[][] = [];
      const unsub = db
        .get(Note)
        .observeQuery(db.get(Note).query())
        .subscribe((r) => {
          results.push(r);
        });

      await new Promise((r) => setTimeout(r, 50));

      await db.write(async () => {
        await db.get(Note).create({ title: 'New' });
      });

      await new Promise((r) => setTimeout(r, 50));

      // Should have initial (0 records) then updated (1 record)
      const last = results.at(-1);
      expect(last).toHaveLength(1);

      unsub();
    });
  });

  describe('observeById', () => {
    it('emits initial record', async () => {
      const note = await db.write(async () => {
        return db.get(Note).create({ title: 'Watch me' });
      });

      const values: (Note | null)[] = [];
      const unsub = db
        .get(Note)
        .observeById(note.id)
        .subscribe((v) => {
          values.push(v);
        });

      await new Promise((r) => setTimeout(r, 50));

      expect(values.length).toBeGreaterThanOrEqual(1);
      expect(values.at(-1)!.id).toBe(note.id);

      unsub();
    });

    it('emits null when record is deleted', async () => {
      const note = await db.write(async () => {
        return db.get(Note).create({ title: 'Delete me' });
      });

      const values: (Note | null)[] = [];
      const unsub = db
        .get(Note)
        .observeById(note.id)
        .subscribe((v) => {
          values.push(v);
        });

      await new Promise((r) => setTimeout(r, 50));

      await db.write(async () => {
        await note.destroyPermanently();
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(values.at(-1)).toBeNull();

      unsub();
    });
  });

  describe('observeCount', () => {
    it('emits initial count', async () => {
      await db.write(async () => {
        await db.get(Note).create({ title: 'A' });
        await db.get(Note).create({ title: 'B' });
      });

      const counts: number[] = [];
      const unsub = db
        .get(Note)
        .observeCount()
        .subscribe((c) => {
          counts.push(c);
        });

      await new Promise((r) => setTimeout(r, 50));

      expect(counts.at(-1)).toBe(2);

      unsub();
    });

    it('updates when records are added', async () => {
      const counts: number[] = [];
      const unsub = db
        .get(Note)
        .observeCount()
        .subscribe((c) => {
          counts.push(c);
        });

      await new Promise((r) => setTimeout(r, 50));

      await db.write(async () => {
        await db.get(Note).create({ title: 'New' });
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(counts.at(-1)).toBe(1);

      unsub();
    });
  });

  describe('changes$', () => {
    it('emits created events', async () => {
      const events: string[] = [];
      const unsub = db.get(Note).changes$.subscribe((e) => events.push(e.type));

      await db.write(async () => {
        await db.get(Note).create({ title: 'New' });
      });

      expect(events).toContain('created');
      unsub();
    });

    it('emits updated events', async () => {
      const note = await db.write(async () => {
        return db.get(Note).create({ title: 'Original' });
      });

      const events: string[] = [];
      const unsub = db.get(Note).changes$.subscribe((e) => events.push(e.type));

      await db.write(async () => {
        await note.update({ title: 'Changed' });
      });

      expect(events).toContain('updated');
      unsub();
    });

    it('emits deleted events on markAsDeleted', async () => {
      const note = await db.write(async () => {
        return db.get(Note).create({ title: 'Bye' });
      });

      const events: string[] = [];
      const unsub = db.get(Note).changes$.subscribe((e) => events.push(e.type));

      await db.write(async () => {
        await note.markAsDeleted();
      });

      expect(events).toContain('deleted');
      unsub();
    });

    it('emits deleted events on destroyPermanently', async () => {
      const note = await db.write(async () => {
        return db.get(Note).create({ title: 'Bye forever' });
      });

      const events: string[] = [];
      const unsub = db.get(Note).changes$.subscribe((e) => events.push(e.type));

      await db.write(async () => {
        await note.destroyPermanently();
      });

      expect(events).toContain('deleted');
      unsub();
    });
  });

  describe('query builder integration', () => {
    beforeEach(async () => {
      await db.write(async () => {
        await db.get(Note).create({ title: 'A', pinned: true, sortOrder: 3 });
        await db.get(Note).create({ title: 'B', pinned: false, sortOrder: 1 });
        await db.get(Note).create({ title: 'C', pinned: true, sortOrder: 2 });
      });
    });

    it('query with builder callback filters results', async () => {
      const qb = db.get(Note).query((q) => q.where('pinned', 'eq', true));
      const pinned = await db.get(Note).fetch(qb);
      expect(pinned).toHaveLength(2);
    });

    it('query without callback returns all non-deleted', async () => {
      const all = await db.get(Note).fetch(db.get(Note).query());
      expect(all).toHaveLength(3);
    });

    it('count with query', async () => {
      const qb = db.get(Note).query((q) => q.where('pinned', 'eq', true));
      const count = await db.get(Note).count(qb);
      expect(count).toBe(2);
    });
  });
});
