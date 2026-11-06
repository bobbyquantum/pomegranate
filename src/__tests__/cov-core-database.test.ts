/**
 * Database / Collection / Model paths not reached by the main suites:
 *  - migration chain validation on initialize (missing chain, downgrade,
 *    migration events, adapter failure), reset() then initialize()
 *  - re-entrant write(), batch notifications for records never loaded
 *  - Collection: findByIdOrFail, search ordering, live query cancelled before
 *    its first result, association resolution through an unregistered table,
 *    _update guards
 *  - Model: belongs_to fields via getField()/update()
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import type { DatabaseEvent } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import type { Migration, StorageAdapter } from '../adapters/types';
import type { CollectionChange } from '../collection/Collection';
import type { RawRecord } from '../schema/types';

type LokiCtor = Awaited<typeof import('lokijs')>['default'];

// ─── Schema ─────────────────────────────────────────────────────────────

const UserSchema = m.model('users', {
  name: m.text(),
});
class User extends Model<typeof UserSchema> {
  static schema = UserSchema;
}

const PostSchema = m.model('posts', {
  title: m.text(),
  views: m.number().default(0),
  author: m.belongsTo(() => UserSchema, { key: 'author_id' }),
});
class Post extends Model<typeof PostSchema> {
  static schema = PostSchema;
}

let Loki: LokiCtor;
beforeAll(async () => {
  const lokijs = await import('lokijs');
  Loki = lokijs.default;
});

let counter = 0;
async function createDb(): Promise<Database> {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: `cov-db-${counter++}` }),
    models: [User, Post],
  });
  await db.initialize();
  return db;
}

const migrationTo2: Migration = {
  fromVersion: 1,
  toVersion: 2,
  steps: [{ type: 'addColumns', table: 'posts', columns: [{ name: 'views', type: 'number', isOptional: false, isIndexed: false }] }],
};

// ─── Initialisation and migrations ──────────────────────────────────────

describe('Database.initialize() migrations', () => {
  it('refuses to open an older database without the migrations to upgrade it', async () => {
    const instance = new Loki('shared');
    const v1 = new Database({ adapter: new LokiAdapter({ databaseName: 'v1', lokiInstance: instance }), models: [User], schemaVersion: 1 });
    await v1.initialize();
    await v1.write(() => v1.get(User).create({ name: 'Ann' }));
    expect(v1.migrations).toEqual([]);

    const v2 = new Database({ adapter: new LokiAdapter({ databaseName: 'v2', lokiInstance: instance }), models: [User, Post], schemaVersion: 2 });
    await expect(v2.initialize()).rejects.toThrow(/Missing migrations between schema versions 1 and 2: 1 → 2/);
    expect(() => v2.get(User)).not.toThrow();
    await expect(v2.write(async () => {})).rejects.toThrow(/not initialized/);
  });

  it('runs the chain with migration events, then refuses a downgrade', async () => {
    const instance = new Loki('upgrade');
    const v1 = new Database({ adapter: new LokiAdapter({ databaseName: 'v1', lokiInstance: instance }), models: [User, Post], schemaVersion: 1 });
    await v1.initialize();
    const author = await v1.write(() => v1.get<User>(User).create({ name: 'Ann' }));
    await v1.write(() => v1.get(Post).create({ title: 'old post', author: author.id }));

    const events: string[] = [];
    const v2 = new Database({
      adapter: new LokiAdapter({ databaseName: 'v2', lokiInstance: instance }),
      models: [User, Post],
      schemaVersion: 2,
      migrations: [migrationTo2],
      migrationEvents: {
        onStart: (from, to) => events.push(`start ${from}->${to}`),
        onSuccess: (from, to) => events.push(`success ${from}->${to}`),
        onError: () => events.push('error'),
      },
    });
    await v2.initialize();
    expect(events).toEqual(['start 1->2', 'success 1->2']);
    expect(v2.migrations).toEqual([migrationTo2]);
    expect(await v2._adapter.getSchemaVersion()).toBe(2);
    const posts = await v2.get<Post>(Post).fetch(v2.get(Post).query());
    expect(posts.map((p) => p.getField('views'))).toEqual([0]);

    const v1Again = new Database({ adapter: new LokiAdapter({ databaseName: 'v1b', lokiInstance: instance }), models: [User, Post], schemaVersion: 1 });
    await expect(v1Again.initialize()).rejects.toThrow(/schema version 2 is newer than the app's schema version 1/);
  });

  it('reports a failing migration through onError and leaves the database uninitialised', async () => {
    const instance = new Loki('failing');
    const v1 = new Database({ adapter: new LokiAdapter({ databaseName: 'v1', lokiInstance: instance }), models: [User], schemaVersion: 1 });
    await v1.initialize();

    const base = new LokiAdapter({ databaseName: 'v2', lokiInstance: instance });
    const adapter: StorageAdapter = Object.assign(Object.create(base) as StorageAdapter, {
      migrate: async () => {
        throw new Error('ALTER failed');
      },
    });
    const seen: unknown[] = [];
    const v2 = new Database({
      adapter,
      models: [User],
      schemaVersion: 2,
      migrations: [{ fromVersion: 1, toVersion: 2, steps: [] }],
      migrationEvents: { onError: (error, from, to) => seen.push([String(error), from, to]) },
    });
    await expect(v2.initialize()).rejects.toThrow('ALTER failed');
    expect(seen).toEqual([['Error: ALTER failed', 1, 2]]);
    await expect(v2.write(async () => {})).rejects.toThrow(/not initialized/);
  });

  it('reset() drops the data and requires initialize() before use', async () => {
    const db = await createDb();
    const events: DatabaseEvent['type'][] = [];
    db.events$.subscribe((event) => events.push(event.type));
    events.length = 0; // drop the replayed 'initialized'
    const user = await db.write(() => db.get<User>(User).create({ name: 'Ann' }));

    await db.reset();
    expect(events).toEqual(['write_started', 'write_completed', 'reset']);
    await expect(db.write(async () => {})).rejects.toThrow(/not initialized/);
    expect(db.get(User)._peekCached(user.id)).toBeUndefined();

    await db.initialize();
    expect(events.at(-1)).toBe('initialized');
    expect(await db.get(User).count()).toBe(0);
    await db.write(() => db.get(User).create({ name: 'Bea' }));
    expect(await db.get(User).count()).toBe(1);
    await db.close();
  });
});

// ─── write() and batch() ────────────────────────────────────────────────

describe('Database.write() and batch()', () => {
  it('runs a nested write() inline within the outer transaction', async () => {
    const db = await createDb();
    const events: DatabaseEvent['type'][] = [];
    db.events$.subscribe((event) => events.push(event.type));
    events.length = 0; // drop the replayed 'initialized'

    const result = await db.write(async () => {
      const outer = await db.get<User>(User).create({ name: 'outer' });
      const inner = await db.write(() => db.get<User>(User).create({ name: 'inner' }));
      return [outer.id, inner.id];
    });
    expect(result).toHaveLength(2);
    expect(events).toEqual(['write_started', 'write_completed']);
    expect(await db.get(User).count()).toBe(2);
    await db.close();
  });

  it('notifies deletes of records that were never loaded with an id-only stub', async () => {
    const db = await createDb();
    await db._adapter.insert('users', { id: 'u1', name: 'Ann', _status: 'synced', _changed: '' } as RawRecord);
    await db._adapter.insert('users', { id: 'u2', name: 'Bea', _status: 'synced', _changed: '' } as RawRecord);
    await db._adapter.insert('users', { id: 'u3', name: 'Cat', _status: 'synced', _changed: '' } as RawRecord);
    const loaded = await db.get<User>(User).findByIdOrFail('u3');

    const changes: CollectionChange[] = [];
    db.get(User).changes$.subscribe((change) => changes.push(change));
    changes.length = 0; // drop any replayed last change
    await db.write(() =>
      db.batch([
        { type: 'delete', table: 'users', id: 'u1' },
        { type: 'destroyPermanently', table: 'users', id: 'u2' },
        { type: 'destroyPermanently', table: 'users', id: 'u3' },
        { type: 'update', table: 'users', rawRecord: { id: 'u1', name: 'Ann (deleted)', _status: 'deleted', _changed: '' } },
      ]),
    );

    expect(changes.map((c) => c.type)).toEqual(['deleted', 'deleted', 'deleted', 'updated']);
    expect(changes[0].record).toEqual({ id: 'u1' });
    expect(changes[0].record).not.toBeInstanceOf(Model);
    expect(changes[1].record).toEqual({ id: 'u2' });
    expect(changes[2].record).toBe(loaded);
    expect(changes[3].record).toBeInstanceOf(User);
    expect((changes[3].record as User).getField('name')).toBe('Ann (deleted)');
    expect(db.get(User)._peekCached('u3')).toBeUndefined();
    expect(await db._adapter.findById('users', 'u2')).toBeNull();
    await db.close();
  });
});

// ─── Collection ─────────────────────────────────────────────────────────

describe('Collection', () => {
  it('findByIdOrFail returns the record or throws', async () => {
    const db = await createDb();
    const user = await db.write(() => db.get<User>(User).create({ name: 'Ann' }));
    expect(await db.get<User>(User).findByIdOrFail(user.id)).toBe(user);
    await expect(db.get(User).findByIdOrFail('missing')).rejects.toThrow('Record not found: users/missing');
    await db.close();
  });

  it('search honours orderBy, paging and extra conditions', async () => {
    const db = await createDb();
    await db.write(async () => {
      await db.get(Post).create({ title: 'alpha post', views: 3 });
      await db.get(Post).create({ title: 'beta post', views: 1 });
      await db.get(Post).create({ title: 'gamma post', views: 2 });
      await db.get(Post).create({ title: 'unrelated', views: 9 });
    });
    const posts = db.get<Post>(Post);

    const byViews = await posts.search({ term: 'POST', fields: ['title'], orderBy: { views: 'desc' } });
    expect(byViews.total).toBe(3);
    expect(byViews.records.map((p) => p.getField('title'))).toEqual(['alpha post', 'gamma post', 'beta post']);

    const page = await posts.search({ term: 'post', fields: ['title'], orderBy: { title: 'asc' }, limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.records.map((p) => p.getField('title'))).toEqual(['beta post']);

    const filtered = await posts.search({ term: 'post', fields: ['title'], extend: (q) => q.where('views', 'gt', 1) });
    expect(filtered.records.map((p) => p.getField('title')).sort()).toEqual(['alpha post', 'gamma post']);
    await db.close();
  });

  it('does not emit from a live query that was unsubscribed before its first result', async () => {
    const db = await createDb();
    await db.write(() => db.get(User).create({ name: 'Ann' }));
    const emitted: unknown[] = [];
    const unsubscribe = db.get(User).observeQuery(db.get(User).query()).subscribe((users) => emitted.push(users));
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emitted).toEqual([]);

    const live: unknown[] = [];
    const stop = db.get(User).observeCount().subscribe((count) => live.push(count));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(live).toEqual([1]);
    stop();
    await db.close();
  });

  it('cannot resolve a nested on() through a table with no registered collection', async () => {
    const db = new Database({ adapter: new LokiAdapter({ databaseName: 'posts-only' }), models: [Post] });
    await db.initialize();
    const posts = db.get(Post);
    // The first hop comes from the schema relation even though User is not registered…
    expect(() => posts.query((q) => q.on('users', 'name', 'Ann'))).not.toThrow();
    // …but the inner builder has nowhere to look up users' associations.
    expect(() => posts.query((q) => q.on('users', (u) => u.on('posts', 'title', 'x')))).toThrow(
      'Cannot resolve association from "users" to "posts"',
    );
    await db.close();
  });

  it('_cacheRaw materialises a raw row into the cache, refreshing an existing instance', async () => {
    const db = await createDb();
    const users = db.get<User>(User);
    const raw = { id: 'u1', name: 'Ann', _status: 'synced', _changed: '' } as RawRecord;
    const first = users._cacheRaw(raw);
    expect(first).toBeInstanceOf(User);
    expect(users._peekCached('u1')).toBe(first);

    const second = users._cacheRaw({ ...raw, name: 'Ann B' });
    expect(second).toBe(first);
    expect(first.getField('name')).toBe('Ann B');
    await db.close();
  });

  it('_update requires a cached record and reports changed columns only when given', async () => {
    const db = await createDb();
    const user = await db.write(() => db.get<User>(User).create({ name: 'Ann' }));
    const changes: CollectionChange[] = [];
    db.get(User).changes$.subscribe((change) => changes.push(change));
    changes.length = 0; // drop the replayed 'created' change

    await db.get(User)._update(user.id, { name: 'Ann B' });
    expect(changes).toEqual([{ type: 'updated', record: user, columns: undefined }]);
    expect(await db._adapter.findById('users', user.id)).toMatchObject({ name: 'Ann B' });

    await db.get(User)._update(user.id, { name: 'Ann C' }, ['name']);
    expect(changes[1]).toEqual({ type: 'updated', record: user, columns: ['name'] });

    await expect(db.get(User)._update('ghost', { name: 'x' })).rejects.toThrow('Cannot update: record ghost not in cache');
    await db.close();
  });
});

// ─── Model ──────────────────────────────────────────────────────────────

describe('Model belongs_to fields', () => {
  it('reads and updates the foreign key through the relation field name', async () => {
    const db = await createDb();
    const [ann, bea] = await db.write(() =>
      Promise.all([db.get<User>(User).create({ name: 'Ann' }), db.get<User>(User).create({ name: 'Bea' })]),
    );
    const post = await db.write(() => db.get<Post>(Post).create({ title: 'Hello', author: ann.id }));
    expect(post.getField('author')).toBe(ann.id);
    expect(() => post.getField('editor')).toThrow('Unknown field "editor" on table "posts"');

    await db.write(() => post.update({ author: bea.id, title: 'Hello again' }));
    expect(post.getField('author')).toBe(bea.id);
    expect(post._rawRecord).toMatchObject({ author_id: bea.id, title: 'Hello again' });
    expect(post._rawRecord._changed.split(',').sort()).toEqual(['author_id', 'title']);
    expect(await db._adapter.findById('posts', post.id)).toMatchObject({ author_id: bea.id });

    await expect(db.write(() => post.update({ editor: ann.id }))).rejects.toThrow('Unknown field "editor" on table "posts"');
    await db.close();
  });
});
