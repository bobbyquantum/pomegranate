/**
 * Integration tests — Database + LokiAdapter.
 *
 * Tests the full stack: Database → Collection → Model → LokiAdapter.
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import type { ModelSchema } from '../schema/types';

// ─── Test Schemas ──────────────────────────────────────────────────────────

const UserSchema = m.model('users', {
  name: m.text(),
  email: m.text().indexed(),
  age: m.number().optional(),
});

class User extends Model<typeof UserSchema> {
  static schema = UserSchema;
}

const PostSchema = m.model('posts', {
  title: m.text(),
  body: m.text(),
  status: m.text().default('draft').indexed(),
  views: m.number().default(0),
  isPinned: m.boolean().default(false),
  createdAt: m.date('created_at').readonly(),
  author: m.belongsTo('users', { key: 'author_id' }),
  comments: m.hasMany('comments', { foreignKey: 'post_id' }),
});

class Post extends Model<typeof PostSchema> {
  static schema = PostSchema;

  publish = this.writer(async () => {
    await this.update({ status: 'published' });
  });
}

// Type assertion helper for writer methods
type PostWithWriter = Post & { publish: () => Promise<void> };

const CommentSchema = m.model('comments', {
  body: m.text(),
  postId: m.text('post_id').indexed(),
});

class Comment extends Model<typeof CommentSchema> {
  static schema = CommentSchema;
}

// ─── Test helpers ──────────────────────────────────────────────────────────

async function createTestDb() {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: 'test.db' }),
    models: [User, Post, Comment],
  });
  await db.initialize();
  return db;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Database + LokiAdapter Integration', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Database initialization', () => {
    it('initializes without errors', () => {
      expect(db).toBeDefined();
      expect(db.tables).toContain('users');
      expect(db.tables).toContain('posts');
      expect(db.tables).toContain('comments');
    });

    it('requires initialization before operations', async () => {
      const uninitDb = new Database({
        adapter: new LokiAdapter({ databaseName: 'uninit.db' }),
        models: [User],
      });

      await expect(uninitDb.write(async () => {})).rejects.toThrow('not initialized');
    });
  });

  describe('Collection access', () => {
    it('gets a collection by model class', () => {
      const users = db.get(User);
      expect(users).toBeDefined();
      expect(users.table).toBe('users');
    });

    it('gets a collection by table name', () => {
      const posts = db.collection('posts');
      expect(posts).toBeDefined();
      expect(posts.table).toBe('posts');
    });

    it('throws on unknown collection', () => {
      expect(() => db.collection('nonexistent')).toThrow();
    });
  });

  describe('CRUD operations', () => {
    it('creates a record', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.getField('name')).toBe('Alice');
      expect(user.getField('email')).toBe('alice@example.com');
      expect(user.syncStatus).toBe('created');
    });

    it('creates a record with default values', async () => {
      const post = await db.write(async () => {
        return db.get(Post).create({
          title: 'Test',
          body: 'Body',
          createdAt: new Date(),
        });
      });

      expect(post.getField('status')).toBe('draft');
      expect(post.getField('views')).toBe(0);
      expect(post.getField('isPinned')).toBe(false);
    });

    it('creates a record with optional field left null', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Bob', email: 'bob@example.com' });
      });

      expect(user.getField('age')).toBeNull();
    });

    it('updates a record', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      await db.write(async () => {
        await user.update({ name: 'Alicia' });
      });

      expect(user.getField('name')).toBe('Alicia');
    });

    it('rejects update outside of db.write()', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      await expect(user.update({ name: 'Alicia' })).rejects.toThrow('db.write()');
    });

    it('rejects update of readonly fields', async () => {
      const post = await db.write(async () => {
        return db.get(Post).create({
          title: 'Test',
          body: 'Body',
          createdAt: new Date(),
        });
      });

      await expect(
        db.write(async () => {
          await post.update({ createdAt: new Date() } as any);
        }),
      ).rejects.toThrow('readonly');
    });

    it('finds a record by ID', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      const found = await db.get(User).findById(user.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(user.id);
    });

    it('returns null for nonexistent ID', async () => {
      const found = await db.get(User).findById('nonexistent');
      expect(found).toBeNull();
    });

    it('findByIdOrFail throws for nonexistent ID', async () => {
      await expect(db.get(User).findByIdOrFail('nonexistent')).rejects.toThrow();
    });

    it('soft-deletes a record', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      await db.write(async () => {
        await user.markAsDeleted();
      });

      expect(user.syncStatus).toBe('deleted');
    });

    it('permanently destroys a record', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });
      const userId = user.id;

      await db.write(async () => {
        await user.destroyPermanently();
      });

      const found = await db.get(User).findById(userId);
      expect(found).toBeNull();
    });
  });

  describe('Querying', () => {
    beforeEach(async () => {
      await db.write(async () => {
        const users = db.get(User);
        await users.create({ name: 'Alice', email: 'alice@example.com', age: 30 });
        await users.create({ name: 'Bob', email: 'bob@example.com', age: 25 });
        await users.create({ name: 'Charlie', email: 'charlie@example.com', age: 35 });
      });
    });

    it('fetches all records', async () => {
      const users = await db.get(User).fetch(db.get(User).query());
      expect(users).toHaveLength(3);
    });

    it('filters with where clause', async () => {
      const qb = db.get(User).query((q) => {
        q.where('name', 'eq', 'Alice');
      });
      const users = await db.get(User).fetch(qb);
      expect(users).toHaveLength(1);
      expect(users[0].getField('name')).toBe('Alice');
    });

    it('counts records', async () => {
      const count = await db.get(User).count();
      expect(count).toBe(3);
    });

    it('fetches with limit', async () => {
      const qb = db.get(User).query().limit(2);
      const users = await db.get(User).fetch(qb);
      expect(users).toHaveLength(2);
    });

    it('excludes soft-deleted records by default', async () => {
      const users = await db.get(User).fetch(db.get(User).query());
      const alice = users.find((u) => u.getField('name') === 'Alice')!;

      await db.write(async () => {
        await alice.markAsDeleted();
      });

      const remaining = await db.get(User).fetch(db.get(User).query());
      expect(remaining).toHaveLength(2);
      expect(remaining.every((u) => u.getField('name') !== 'Alice')).toBe(true);
    });
  });

  describe('Search', () => {
    beforeEach(async () => {
      await db.write(async () => {
        const posts = db.get(Post);
        await posts.create({ title: 'TypeScript Basics', body: 'Learn TS', status: 'published' });
        await posts.create({
          title: 'React Hooks',
          body: 'useState explained',
          status: 'published',
        });
        await posts.create({
          title: 'Advanced TypeScript',
          body: 'Generics and more',
          status: 'draft',
        });
      });
    });

    it('searches by term across fields', async () => {
      const result = await db.get(Post).search({
        term: 'TypeScript',
        fields: ['title', 'body'],
      });

      expect(result.records).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('searches with additional filter', async () => {
      const result = await db.get(Post).search({
        term: 'TypeScript',
        fields: ['title'],
        extend: (qb) => {
          qb.where('status', 'eq', 'published');
        },
      });

      expect(result.records).toHaveLength(1);
    });

    it('supports pagination', async () => {
      const result = await db.get(Post).search({
        term: 'TypeScript',
        fields: ['title'],
        limit: 1,
        offset: 0,
      });

      expect(result.records).toHaveLength(1);
      expect(result.total).toBe(2);
    });
  });

  describe('Writer pattern', () => {
    it('model writer method works inside db.write', async () => {
      const post = await db.write(async () => {
        return db.get(Post).create({
          title: 'Draft Post',
          body: 'Content',
          status: 'draft',
        });
      });

      await db.write(async () => {
        await (post as any).publish();
      });

      expect(post.getField('status')).toBe('published');
    });

    it('serializes concurrent writes', async () => {
      const order: number[] = [];

      const p1 = db.write(async () => {
        order.push(1);
        await db.get(User).create({ name: 'A', email: 'a@test.com' });
        order.push(2);
      });

      const p2 = db.write(async () => {
        order.push(3);
        await db.get(User).create({ name: 'B', email: 'b@test.com' });
        order.push(4);
      });

      await Promise.all([p1, p2]);

      // Writes should be serialized
      expect(order).toEqual([1, 2, 3, 4]);
    });
  });

  describe('Observable / Reactivity', () => {
    it('emits when record changes', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      const names: string[] = [];
      user.observe().subscribe((u) => {
        names.push(u.getField('name') as string);
      });

      await db.write(async () => {
        await user.update({ name: 'Alicia' });
      });

      expect(names).toContain('Alice');
      expect(names).toContain('Alicia');
    });

    it('observeField only fires when the specific field changes', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      const emails: unknown[] = [];
      user.observeField('email').subscribe((v) => emails.push(v));

      await db.write(async () => {
        await user.update({ name: 'Alicia' }); // should NOT trigger email observer
      });

      // Only the initial value should be present
      expect(emails).toEqual(['alice@example.com']);
    });

    it('collection changes$ emits on create', async () => {
      const events: string[] = [];
      db.get(User).changes$.subscribe((change) => {
        events.push(change.type);
      });

      await db.write(async () => {
        await db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      expect(events).toContain('created');
    });
  });

  describe('Change tracking for sync', () => {
    it('new records have _status = "created"', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      expect(user.syncStatus).toBe('created');
    });

    it('updated synced records get _status = "updated"', async () => {
      const user = await db.write(async () => {
        return db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      // Simulate syncing by directly setting _status
      user._setRaw({ _status: 'synced', _changed: '' } as any);

      await db.write(async () => {
        await user.update({ name: 'Alicia' });
      });

      expect(user.syncStatus).toBe('updated');
      expect(user.changedFields).toContain('name');
    });
  });

  describe('Database reset', () => {
    it('clears all data', async () => {
      await db.write(async () => {
        await db.get(User).create({ name: 'Alice', email: 'alice@example.com' });
      });

      await db.reset();

      // After reset, the adapter is reset but we need to re-initialize
      // to use it again. Collections should be empty.
      await db.initialize();
      const count = await db.get(User).count();
      expect(count).toBe(0);
    });
  });
});
