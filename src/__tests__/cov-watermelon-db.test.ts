/**
 * Coverage tests for the WatermelonDB compatibility layer's database-backed
 * classes: compat `Database` (adapter validation, derived model schemas,
 * read()/write() writer interface, withChangesForTables lifecycle),
 * `Collection` (find/findAndObserve/changes error and cancellation paths,
 * non-compat model classes, createFromDirtyRaw), `Model` / `Relation`
 * (accessors, nested mutators, patch-object update, relation switching)
 * and `synchronize()` option validation.
 */

import { Model as CoreModel, createRawRecord } from '../model/Model';
import type { ModelSchema } from '../schema/types';
import {
  m,
  Model,
  Q,
  Database,
  LokiJSAdapter,
  appSchema,
  tableSchema,
  synchronize,
  hasUnsyncedChanges,
  SyncLogger,
} from '../watermelon';
import type { Associations, CollectionChangeSet, Relation, WatermelonObservable } from '../watermelon';

// ─── Models ─────────────────────────────────────────────────────────────────

const OwnerSchema = m.model('owners', { name: m.text('name') });
class Owner extends Model<typeof OwnerSchema> {
  static schema = OwnerSchema;
  static table = 'owners';
  static associations: Associations = {
    items: { type: 'has_many', foreignKey: 'owner_id' },
  };
  get name(): string { return this.getField('name') as string; }
  set name(value: string) { this.setField('name', value); }
}

const ItemSchema = m.model('items', {
  title: m.text('title'),
  count: m.number('count'),
  ownerId: m.text('owner_id').optional().indexed(),
});
class Item extends Model<typeof ItemSchema> {
  static schema = ItemSchema;
  static table = 'items';
  static associations: Associations = {
    owners: { type: 'belongs_to', key: 'owner_id' },
  };
  get title(): string { return this.getField('title') as string; }
  set title(value: string) { this.setField('title', value); }
  get count(): number { return this.getField('count') as number; }
  set count(value: number) { this.setField('count', value); }
  get ownerId(): string | null { return this.getField('ownerId') as string | null; }
  set ownerId(value: string | null) { this.setField('ownerId', value); }
  get owner(): Relation<Owner> { return this.relation<Owner>('owners', 'owner_id'); }
}

/**
 * A schema built by hand (not via `m.model`) whose belongs_to relation has
 * no backing column — `m.belongsTo` always adds one, so this is the only way
 * to reach the relation-only branches of `setField` and `Relation`.
 */
const HandSchema = Object.freeze<ModelSchema>({
  table: 'hand_items',
  fields: {},
  columns: [
    { fieldName: 'label', columnName: 'label', type: 'text', isReadonly: false, isOptional: false, isIndexed: false },
  ],
  relations: [
    { fieldName: 'owner', kind: 'belongs_to', foreignKey: 'owner_id', _relatedSchemaThunk: () => OwnerSchema },
    { fieldName: 'items', kind: 'has_many', foreignKey: 'hand_item_id', _relatedSchemaThunk: () => ItemSchema },
  ],
});
class HandItem extends Model {
  static schema = HandSchema;
  static table = 'hand_items';
}

const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({ name: 'owners', columns: [{ name: 'name', type: 'string' }] }),
    tableSchema({
      name: 'items',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'count', type: 'number' },
        { name: 'owner_id', type: 'string', isOptional: true, isIndexed: true },
      ],
    }),
    tableSchema({ name: 'hand_items', columns: [{ name: 'label', type: 'string' }] }),
  ],
});

function createDatabase(adapter = new LokiJSAdapter({ schema, dbName: `cov-db-${Math.random()}` })): Database {
  return new Database({ adapter, modelClasses: [Owner, Item, HandItem] });
}

/** A database whose initialisation fails. */
function createBrokenDatabase(onSetUpError?: (error: unknown) => void): Database {
  const adapter = new LokiJSAdapter({ schema, dbName: `cov-broken-${Math.random()}`, onSetUpError });
  jest.spyOn(adapter.pomegranate, 'initialize').mockRejectedValue(new Error('open failed'));
  return createDatabase(adapter);
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor: timed out');
    await tick(5);
  }
}

interface Collected<T> {
  values: T[];
  errors: unknown[];
  completed: number;
  unsubscribe: () => void;
}

function collect<T>(observable: WatermelonObservable<T>): Collected<T> {
  const out: Collected<T> = { values: [], errors: [], completed: 0, unsubscribe: () => {} };
  const subscription = observable.subscribe({
    next: (v) => out.values.push(v),
    error: (e) => out.errors.push(e),
    complete: () => out.completed++,
  });
  out.unsubscribe = () => subscription.unsubscribe();
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Database
// ═══════════════════════════════════════════════════════════════════════════

describe('Database', () => {
  it('validates the adapter and the model classes', () => {
    expect(() => new Database({ adapter: undefined as never, modelClasses: [] }))
      .toThrow(/adapter created with SQLiteAdapter or LokiJSAdapter/);
    expect(() => new Database({ adapter: null as never, modelClasses: [] })).toThrow(/SQLiteAdapter or LokiJSAdapter/);

    class NoTable extends Model {}
    expect(() => new Database({
      adapter: new LokiJSAdapter({ schema, dbName: 'cov-notable' }),
      modelClasses: [NoTable],
    })).toThrow(/Model class NoTable declares neither static schema nor static table/);

    class Ghost extends Model { static table = 'ghosts'; }
    expect(() => new Database({
      adapter: new LokiJSAdapter({ schema, dbName: 'cov-ghost' }),
      modelClasses: [Ghost],
    })).toThrow(/Model class Ghost has table "ghosts" which is not in appSchema/);
  });

  it('exposes collections and rejects unknown tables', () => {
    const db = createDatabase();
    expect(db.get('items').table).toBe('items');
    expect(db.get('items').db).toBe(db);
    expect(db.get('items').schema).toBe(ItemSchema);
    expect(db.collections.get('owners').modelClass).toBe(Owner);
    expect(() => db.get('nope')).toThrow(/No collection registered for table "nope"/);
    expect(db.schema).toBe(schema);
    expect(db.compatAdapter.pomegranate).toBe(db.adapter);
  });

  it('read() and write() hand the writer interface to the callback', async () => {
    const db = createDatabase();
    const created = await db.write(async (writer) =>
      writer.callWriter(() => db.get<Item>('items').create((i) => { i.title = 'w'; i.count = 1; })));
    expect(created.title).toBe('w');
    const found = await db.read(async (reader) => reader.callReader(() => db.get<Item>('items').find(created.id)));
    expect(found).toBe(created);
    // read() does not open a writer
    await expect(db.read(() => db.get<Item>('items').create())).rejects.toThrow(/must be called inside db\.write\(\)/);
    await db.pomegranate.close();
  });

  it('reports set-up failures through onSetUpError and every operation', async () => {
    const onSetUpError = jest.fn();
    const db = createBrokenDatabase(onSetUpError);
    await expect(db.ready).rejects.toThrow('open failed');
    expect(onSetUpError).toHaveBeenCalledWith(expect.objectContaining({ message: 'open failed' }));
    await expect(db.write(async () => 1)).rejects.toThrow('open failed');
    await expect(db.get<Item>('items').find('x')).rejects.toThrow('open failed');
    await expect(db.get<Item>('items').query().fetch()).rejects.toThrow('open failed');

    const tables = collect(db.withChangesForTables(['items']));
    const changes = collect(db.get<Item>('items').changes);
    const byId = collect(db.get<Item>('items').findAndObserve('x'));
    await waitFor(() => tables.errors.length === 1 && changes.errors.length === 1 && byId.errors.length === 1);
    expect(String(tables.errors[0])).toMatch(/open failed/);
    expect(String(changes.errors[0])).toMatch(/open failed/);
    expect(String(byId.errors[0])).toMatch(/open failed/);
    expect(tables.values).toEqual([]);
  });

  it('withChangesForTables emits null first, then per-record changes across tables', async () => {
    const db = createDatabase();
    const out = collect(db.withChangesForTables(['items', 'owners']));
    await waitFor(() => out.values.length === 1);
    expect(out.values[0]).toBeNull();

    const { owner, item } = await db.write(async () => {
      const owner = await db.get<Owner>('owners').create((o) => { o.name = 'o'; });
      const item = await db.get<Item>('items').create((i) => { i.title = 't'; i.count = 0; i.ownerId = owner.id; });
      return { owner, item };
    });
    await waitFor(() => out.values.length === 3);
    await db.write(async () => {
      await item.update((i) => { i.count = 2; });
      await owner.markAsDeleted();
      await item.destroyPermanently();
    });
    await waitFor(() => out.values.length === 6);
    const types = out.values.slice(1).map((set) => (set as CollectionChangeSet[])[0].type);
    expect(types).toEqual(['created', 'created', 'updated', 'destroyed', 'destroyed']);
    expect((out.values[4] as CollectionChangeSet[])[0].record).toBe(owner);
    out.unsubscribe();

    await db.write(() => db.get<Owner>('owners').create((o) => { o.name = 'after' ; }));
    await tick();
    expect(out.values).toHaveLength(6);
    await db.pomegranate.close();
  });

  it('withChangesForTables / changes / findAndObserve ignore subscriptions cancelled before ready', async () => {
    const db = createDatabase();
    const tables = collect(db.withChangesForTables(['items']));
    const changes = collect(db.get<Item>('items').changes);
    const byId = collect(db.get<Item>('items').findAndObserve('missing'));
    tables.unsubscribe();
    changes.unsubscribe();
    byId.unsubscribe();
    await db.ready;
    await db.write(() => db.get<Item>('items').create((i) => { i.title = 'x'; i.count = 0; }));
    await tick();
    expect(tables.values).toEqual([]);
    expect(changes.values).toEqual([]);
    expect(byId.values).toEqual([]);
    expect(byId.errors).toEqual([]);
    await db.pomegranate.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Collection
// ═══════════════════════════════════════════════════════════════════════════

describe('Collection', () => {
  let db: Database;
  beforeEach(() => {
    db = createDatabase();
  });
  afterEach(async () => {
    await db.pomegranate.close();
  });

  it('find() rejects for missing and deleted records', async () => {
    await expect(db.get<Item>('items').find('nope')).rejects.toThrow(/Record nope not found in items/);
    const item = await db.write(() => db.get<Item>('items').create((i) => { i.title = 'gone'; i.count = 0; }));
    expect(await db.get<Item>('items').find(item.id)).toBe(item);
    await db.write(() => item.markAsDeleted());
    expect(item.syncStatus).toBe('deleted');
    await expect(db.get<Item>('items').find(item.id)).rejects.toThrow(/not found/);
  });

  it('findAndObserve() errors for a missing record and completes when the record is deleted', async () => {
    const missing = collect(db.get<Item>('items').findAndObserve('ghost'));
    await waitFor(() => missing.errors.length === 1);
    expect(String(missing.errors[0])).toMatch(/Record ghost not found in items/);
    expect(missing.values).toEqual([]);

    const item = await db.write(() => db.get<Item>('items').create((i) => { i.title = 'live'; i.count = 0; }));
    const out = collect(db.get<Item>('items').findAndObserve(item.id));
    // The core replays the collection's last change on subscribe, so the
    // first value may arrive twice; only the record identity matters here.
    await waitFor(() => out.values.length > 0);
    await tick(20);
    expect(out.values.every((r) => r === item)).toBe(true);
    const seen = out.values.length;
    await db.write(() => item.update((i) => { i.count = 1; }));
    await waitFor(() => out.values.length > seen);
    expect(out.values.at(-1)!.count).toBe(1);
    await db.write(() => item.markAsDeleted());
    await waitFor(() => out.completed === 1);
    expect(out.errors).toEqual([]);
    const total = out.values.length;
    out.unsubscribe();
    expect(out.values).toHaveLength(total);
  });

  it('changes emits created / updated / destroyed change sets', async () => {
    const out = collect(db.get<Item>('items').changes);
    await tick();
    const item = await db.write(() => db.get<Item>('items').create((i) => { i.title = 'c'; i.count = 0; }));
    await db.write(() => item.update({ count: 3 }));
    await db.write(() => item.markAsDeleted());
    await waitFor(() => out.values.length === 3);
    expect(out.values.map((set) => set[0].type)).toEqual(['created', 'updated', 'destroyed']);
    expect(out.values.every((set) => set[0].record === item)).toBe(true);
    out.unsubscribe();
  });

  it('rejects model classes that do not extend the compat Model', async () => {
    const PlainSchema = m.model('plain', { label: m.text('label') });
    class Plain extends CoreModel<typeof PlainSchema> {
      static schema = PlainSchema;
    }
    const plainDb = new Database({
      adapter: new LokiJSAdapter({
        schema: appSchema({
          version: 1,
          tables: [tableSchema({ name: 'plain', columns: [{ name: 'label', type: 'string' }] })],
        }),
        dbName: `cov-plain-${Math.random()}`,
      }),
      modelClasses: [Plain as never],
    });
    await expect(plainDb.write(() => plainDb.get('plain').create()))
      .rejects.toThrow(/Model class for table "plain" must extend Model from 'pomegranate-db\/watermelon'/);
    expect(() => plainDb.get('plain').prepareCreate()).toThrow(/must extend Model/);
    await plainDb.pomegranate.close();
  });

  it('createFromDirtyRaw() persists a sanitised raw inside write() only', async () => {
    await expect(db.get<Item>('items').createFromDirtyRaw({ title: 'x' }))
      .rejects.toThrow(/Collection\.createFromDirtyRaw\(\) must be called inside db\.write\(\)/);
    const item = await db.write(() =>
      db.get<Item>('items').createFromDirtyRaw({ id: 'dirty-1', title: 'dirty', count: 'NaN', owner_id: null, extra: 1 }));
    expect(item.id).toBe('dirty-1');
    expect(item._preparedState).toBeNull();
    expect(item._raw).toEqual({ id: 'dirty-1', _status: 'created', _changed: '', title: 'dirty', count: 0, owner_id: null });
    expect(await db.get<Item>('items').find('dirty-1')).toBe(item);
    expect(await db.get<Item>('items').query(Q.where('count', 0)).fetchCount()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Model & Relation
// ═══════════════════════════════════════════════════════════════════════════

describe('Model', () => {
  let db: Database;
  let owner: Owner;
  let item: Item;
  beforeEach(async () => {
    db = createDatabase();
    ({ owner, item } = await db.write(async () => {
      const owner = await db.get<Owner>('owners').create((o) => { o.name = 'Ann'; });
      const item = await db.get<Item>('items').create((i) => { i.title = 'one'; i.count = 1; i.ownerId = owner.id; });
      return { owner, item };
    }));
  });
  afterEach(async () => {
    await db.pomegranate.close();
  });

  it('exposes WatermelonDB accessors', () => {
    expect(item.asModel).toBe(item);
    expect(item.table).toBe('items');
    expect(item.database).toBe(db);
    expect(item.collections.get('owners')).toBe(db.get('owners'));
    expect(item.collection).toBe(db.get('items'));
    expect(item._raw.title).toBe('one');
    expect(item.syncStatus).toBe('created');
    expect(item._preparedState).toBeNull();
  });

  it('throws when a record is not attached to a compat Database', () => {
    const detached = new Item({ table: 'items' } as never, createRawRecord(ItemSchema, { title: 'd', count: 0 }));
    expect(detached.table).toBe('items');
    expect(() => detached.database).toThrow(/Record of table "items" is not attached to a pomegranate-db\/watermelon Database/);
    expect(() => detached.collections).toThrow(/not attached/);
  });

  it('guards setField and rejects nested or asynchronous prepare mutators', async () => {
    expect(() => { item.title = 'outside'; }).toThrow(/Cannot modify a record outside of update\(\)\/create\(\)/);
    await expect(item.update((i) => { i.count = 2; })).rejects.toThrow(/Model\.update\(\) must be called inside db\.write\(\)/);

    await db.write(async () => {
      await expect(item.update(async (i) => {
        await i.update(() => {});
      })).rejects.toThrow(/Nested update\(\)\/create\(\) on the same record is not supported/);
      await expect(item.update((i) => {
        i.prepareUpdate(() => {});
      })).rejects.toThrow(/Nested update\(\)\/create\(\)/);
      await expect(item.update((i) => i.setField('nope', 1))).rejects.toThrow(/Unknown field "nope" on table "items"/);
      expect(item._preparedState).toBeNull();
    });
    expect(() => item.prepareUpdate((i) => { void (async () => {})(); }))
      .not.toThrow();
    item._setPreparedState(null);
    expect(() => item.prepareUpdate((async () => {}) as never))
      .toThrow(/prepareUpdate\(\) mutators must be synchronous/);
    expect(() => db.get<Item>('items').prepareCreate((async () => {}) as never))
      .toThrow(/prepareCreate\(\) mutators must be synchronous/);
    expect(item.title).toBe('one');
  });

  it('update() accepts a mutator, an async mutator, a patch object or nothing', async () => {
    await db.write(async () => {
      expect(await item.update((i) => { i.count = 2; })).toBe(item);
      expect(item.count).toBe(2);
      await item.update(async (i) => {
        await tick(1);
        i.title = 'async';
      });
      expect(item.title).toBe('async');
      await item.update({ count: 5, title: 'patch' });
      expect(item.count).toBe(5);
      expect(item._raw.title).toBe('patch');
      const before = { ...item._raw };
      await item.update();
      expect(item._raw).toEqual(before);
    });
    const reloaded = await db.get<Item>('items').find(item.id);
    expect(reloaded.count).toBe(5);
  });

  it('refuses mutations while a prepared operation is pending', async () => {
    item.prepareMarkAsDeleted();
    await db.write(async () => {
      await expect(item.update({ count: 9 })).rejects.toThrow(/pending prepareMarkAsDeleted\(\)/);
      await expect(item.markAsDeleted()).rejects.toThrow(/Cannot call markAsDeleted\(\) on items#/);
      await expect(item.destroyPermanently()).rejects.toThrow(/pending prepareMarkAsDeleted/);
      expect(() => item.prepareUpdate()).toThrow(/pending prepareMarkAsDeleted/);
      expect(() => item.prepareDestroyPermanently()).toThrow(/pending/);
      expect(() => item.prepareMarkAsDeleted()).toThrow(/pending/);
    });
    item._setPreparedState(null);
    await db.write(() => item.destroyPermanently());
    expect(await db.adapter.findById('items', item.id)).toBeNull();
  });

  it('children() and relation() follow static associations', async () => {
    const children = await owner.children<Item>('items').fetch();
    expect(children.map((i) => i.id)).toEqual([item.id]);
    expect(() => item.children('owners')).toThrow(/Association from "items" to "owners" is belongs_to; children\(\) needs has_many/);
    expect(() => item.children('unknown')).toThrow(/No association from "items" to "unknown"/);
    expect(() => owner.relation('items', 'missing_column')).toThrow(/Column "missing_column" is not declared on table "owners"/);

    const relation = item.owner;
    expect(relation.table).toBe('owners');
    expect(relation.key).toBe('owner_id');
    expect(relation.id).toBe(owner.id);
    expect(await relation.fetch()).toBe(owner);

    await db.write(() => item.update((i) => { i.owner.set(null); }));
    expect(item.ownerId).toBeNull();
    expect(await item.owner.fetch()).toBeNull();
    await db.write(() => item.update((i) => { i.owner.id = owner.id; }));
    expect(item.ownerId).toBe(owner.id);
    await db.write(() => item.update((i) => { i.owner.set(owner); }));
    const fetched = await item.owner.fetch();
    expect(fetched!.name).toBe('Ann');
  });

  it('relation.observe() ignores owner changes that keep the same foreign key', async () => {
    const other = await db.write(() => db.get<Owner>('owners').create((o) => { o.name = 'Bob'; }));
    const out = collect(item.owner.observe());
    await waitFor(() => out.values.length > 0);
    await tick(20);
    expect(out.values.every((o) => o === owner)).toBe(true);

    // unrelated change on the owning record: same foreign key, no new emission
    let seen = out.values.length;
    await db.write(() => item.update((i) => { i.count = 100; }));
    await tick(20);
    expect(out.values).toHaveLength(seen);

    await db.write(() => item.update((i) => { i.owner.set(other); }));
    await waitFor(() => out.values.length > seen);
    await tick(20);
    expect(out.values.at(-1)).toBe(other);
    seen = out.values.length;
    await db.write(() => item.update((i) => { i.owner.set(null); }));
    await waitFor(() => out.values.length > seen);
    expect(out.values.at(-1)).toBeNull();
    // null -> null is also deduplicated
    seen = out.values.length;
    await db.write(() => item.update((i) => { i.title = 'still null'; }));
    await tick(20);
    expect(out.values).toHaveLength(seen);
    out.unsubscribe();
    await db.write(() => item.update((i) => { i.owner.set(owner); }));
    await tick(20);
    expect(out.values).toHaveLength(seen);
  });

  it('observe() emits the record now and after each update', async () => {
    const out = collect(item.observe());
    expect(out.values).toEqual([item]);
    await db.write(() => item.update({ count: 7 }));
    expect(out.values).toHaveLength(2);
    out.unsubscribe();
    await db.write(() => item.update({ count: 8 }));
    expect(out.values).toHaveLength(2);
  });

  it('resolves relation-only fields on a hand-built schema', async () => {
    const hand = await db.write(() => db.get<HandItem>('hand_items').create((h) => h.setField('label', 'h')));
    // the relation has no column, so the relation lookup paths are used
    const relation = hand.relation<Owner>('owners', 'owner_id');
    expect(relation.id).toBeNull();
    expect(await relation.fetch()).toBeNull();
    expect(() => hand.relation('owners', 'hand_item_id')).toThrow(/Column "hand_item_id" is not declared on table "hand_items"/);
    expect(hand._captureMutationsSync((h) => h.setField('owner', owner.id))).toEqual({ owner: owner.id });
    expect(() => hand._captureMutationsSync((h) => h.setField('items', 'x')))
      .toThrow(/Unknown field "items" on table "hand_items"/);
    expect(() => hand._captureMutationsSync((h) => h.setField('zzz', 'x')))
      .toThrow(/Unknown field "zzz" on table "hand_items"/);
    await db.write(() => hand.update((h) => { h.relation<Owner>('owners', 'owner_id').set(owner); }));
    expect(hand.getField('owner')).toBe(owner.id);
    expect(hand.relation<Owner>('owners', 'owner_id').id).toBe(owner.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sync
// ═══════════════════════════════════════════════════════════════════════════

describe('synchronize', () => {
  it('rejects unsupported WatermelonDB options before touching the database', async () => {
    const db = createBrokenDatabase();
    const pullChanges = jest.fn();
    const pushChanges = jest.fn();
    for (const option of ['conflictResolver', 'onDidPullChanges', 'onWillApplyRemoteChanges'] as const) {
      await expect(synchronize({ database: db, pullChanges, pushChanges, [option]: () => {} }))
        .rejects.toThrow(`synchronize(): ${option} is not supported by pomegranate-db/watermelon`);
    }
    // without them, the (failed) database readiness is awaited
    await expect(synchronize({ database: db, pullChanges, pushChanges, _unsafeBatchPerCollection: true }))
      .rejects.toThrow('open failed');
    await expect(hasUnsyncedChanges({ database: db })).rejects.toThrow('open failed');
    expect(pullChanges).not.toHaveBeenCalled();
  });

  it('hasUnsyncedChanges reflects local writes and SyncLogger formats logs', async () => {
    const db = createDatabase();
    expect(await hasUnsyncedChanges({ database: db })).toBe(false);
    await db.write(() => db.get<Owner>('owners').create((o) => { o.name = 'local'; }));
    expect(await hasUnsyncedChanges({ database: db })).toBe(true);
    const logger = new SyncLogger(1);
    const log = logger.newLog();
    expect(logger.formattedLogs).toBe('[\n  {}\n]');
    await synchronize({
      database: db,
      log,
      pullChanges: async () => ({ changes: {}, timestamp: 1 }),
      pushChanges: async () => {},
    });
    expect(await hasUnsyncedChanges({ database: db })).toBe(false);
    expect(logger.logs).toEqual([log]);
    expect(JSON.parse(logger.formattedLogs)).toHaveLength(1);
    await db.pomegranate.close();
  });
});
