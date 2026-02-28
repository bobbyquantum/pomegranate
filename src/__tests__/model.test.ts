/**
 * Model tests — unit tests for Model base class.
 *
 * Tests: getField, update, sync status tracking, writer, observe,
 * observeField, toPushPayload, readonly enforcement, _setRaw.
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';

// ─── Schema ────────────────────────────────────────────────────────────

const ArticleSchema = m.model('articles', {
  title: m.text(),
  body: m.text().default(''),
  views: m.number().default(0),
  published: m.boolean().default(false),
  category: m.text().optional(),
  createdAt: m.date('created_at').readonly(),
});

class Article extends Model<typeof ArticleSchema> {
  static schema = ArticleSchema;

  togglePublish = this.writer(async () => {
    const current = this.getField('published');
    await this.update({ published: !current });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────

async function setup() {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: 'model-test' }),
    models: [Article],
  });
  await db.initialize();
  return db;
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Model', () => {
  let db: Database;

  beforeEach(async () => {
    db = await setup();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('getField', () => {
    it('returns field values', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({
          title: 'Hello',
          body: 'World',
          views: 42,
          published: true,
          createdAt: new Date('2024-01-01'),
        });
      });

      expect(article.getField('title')).toBe('Hello');
      expect(article.getField('body')).toBe('World');
      expect(article.getField('views')).toBe(42);
      expect(article.getField('published')).toBe(true);
    });

    it('returns default values for unset fields', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Minimal', createdAt: new Date() });
      });

      expect(article.getField('body')).toBe('');
      expect(article.getField('views')).toBe(0);
      expect(article.getField('published')).toBe(false);
    });

    it('returns null for optional unset fields', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'No category', createdAt: new Date() });
      });

      expect(article.getField('category')).toBeNull();
    });

    it('throws for nonexistent fields', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Test', createdAt: new Date() });
      });

      expect(() => article.getField('nonexistent')).toThrow();
    });
  });

  describe('id and rawRecord', () => {
    it('has a generated UUID id', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Test', createdAt: new Date() });
      });

      expect(article.id).toBeDefined();
      expect(typeof article.id).toBe('string');
      expect(article.id.length).toBeGreaterThan(0);
    });

    it('exposes raw record', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Raw', createdAt: new Date() });
      });

      expect(article._rawRecord).toBeDefined();
      expect(article._rawRecord.id).toBe(article.id);
      expect(article._rawRecord.title).toBe('Raw');
    });
  });

  describe('update', () => {
    it('updates specified fields', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Before', createdAt: new Date() });
      });

      await db.write(async () => {
        await article.update({ title: 'After', views: 100 });
      });

      expect(article.getField('title')).toBe('After');
      expect(article.getField('views')).toBe(100);
    });

    it('rejects update outside db.write()', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Test', createdAt: new Date() });
      });

      await expect(article.update({ title: 'Nope' })).rejects.toThrow('db.write()');
    });

    it('rejects update of readonly fields', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Test', createdAt: new Date() });
      });

      await expect(
        db.write(async () => {
          await article.update({ createdAt: new Date() } as any);
        }),
      ).rejects.toThrow('readonly');
    });
  });

  describe('sync status tracking', () => {
    it('new records have _status = "created"', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'New', createdAt: new Date() });
      });

      expect(article.syncStatus).toBe('created');
      expect(article.changedFields).toBe('');
    });

    it('updating a "created" record keeps status as "created"', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'New', createdAt: new Date() });
      });

      await db.write(async () => {
        await article.update({ title: 'Still new' });
      });

      // Record was never synced, so it stays "created"
      expect(article.syncStatus).toBe('created');
    });

    it('updating a "synced" record changes status to "updated"', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Synced', createdAt: new Date() });
      });

      // Simulate sync
      article._setRaw({ _status: 'synced', _changed: '' } as any);

      await db.write(async () => {
        await article.update({ title: 'Modified' });
      });

      expect(article.syncStatus).toBe('updated');
      expect(article.changedFields).toContain('title');
    });

    it('tracks multiple changed fields', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Base', createdAt: new Date() });
      });

      article._setRaw({ _status: 'synced', _changed: '' } as any);

      await db.write(async () => {
        await article.update({ title: 'New title', views: 5 });
      });

      const changed = article.changedFields;
      expect(changed).toContain('title');
      expect(changed).toContain('views');
    });
  });

  describe('markAsDeleted', () => {
    it('soft-deletes the record', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Delete me', createdAt: new Date() });
      });

      await db.write(async () => {
        await article.markAsDeleted();
      });

      expect(article.syncStatus).toBe('deleted');
    });
  });

  describe('destroyPermanently', () => {
    it('permanently removes the record', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Destroy me', createdAt: new Date() });
      });
      const id = article.id;

      await db.write(async () => {
        await article.destroyPermanently();
      });

      const found = await db.get(Article).findById(id);
      expect(found).toBeNull();
    });
  });

  describe('writer', () => {
    it('creates a reusable writer method', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Test', published: false, createdAt: new Date() });
      });

      await db.write(async () => {
        await (article as any).togglePublish();
      });

      expect(article.getField('published')).toBe(true);
    });
  });

  describe('observe', () => {
    it('emits current record on subscribe', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Observable', createdAt: new Date() });
      });

      const values: any[] = [];
      const unsub = article.observe().subscribe((a) => values.push(a));

      expect(values.length).toBeGreaterThanOrEqual(1);
      expect(values[0].id).toBe(article.id);

      unsub();
    });

    it('emits on update', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Before', createdAt: new Date() });
      });

      const titles: string[] = [];
      const unsub = article.observe().subscribe((a) => {
        titles.push(a.getField('title') as string);
      });

      await db.write(async () => {
        await article.update({ title: 'After' });
      });

      expect(titles).toContain('Before');
      expect(titles).toContain('After');

      unsub();
    });
  });

  describe('observeField', () => {
    it('emits initial field value', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Watch this', createdAt: new Date() });
      });

      const values: unknown[] = [];
      const unsub = article.observeField('title').subscribe((v) => values.push(v));

      expect(values).toContain('Watch this');

      unsub();
    });

    it('emits when the observed field changes', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'V1', views: 0, createdAt: new Date() });
      });

      const titles: unknown[] = [];
      const unsub = article.observeField('title').subscribe((v) => titles.push(v));

      await db.write(async () => {
        await article.update({ title: 'V2' });
      });

      expect(titles).toContain('V1');
      expect(titles).toContain('V2');

      unsub();
    });

    it('does NOT emit when a different field changes', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Stable', views: 0, createdAt: new Date() });
      });

      const titles: unknown[] = [];
      const unsub = article.observeField('title').subscribe((v) => titles.push(v));

      await db.write(async () => {
        await article.update({ views: 99 }); // Different field
      });

      // Only initial value should be present
      expect(titles).toEqual(['Stable']);

      unsub();
    });
  });

  describe('toPushPayload', () => {
    it('strips internal sync fields', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Payload', createdAt: new Date() });
      });

      const payload = article.toPushPayload();
      expect(payload.id).toBe(article.id);
      expect(payload.title).toBe('Payload');
      expect(payload._status).toBeUndefined();
      expect(payload._changed).toBeUndefined();
    });
  });

  describe('_setRaw', () => {
    it('updates internal raw record', async () => {
      const article = await db.write(async () => {
        return db.get(Article).create({ title: 'Original', createdAt: new Date() });
      });

      article._setRaw({ title: 'Replaced' } as any);
      expect(article.getField('title')).toBe('Replaced');
    });
  });
});
