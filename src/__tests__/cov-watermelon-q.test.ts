/**
 * Coverage tests for the WatermelonDB compatibility layer's pure modules:
 * `Q` (argument validation and every operator's translation), `appSchema` /
 * `tableSchema` / migrations validation, `WatermelonObservable` edge cases,
 * the rxjs `Symbol.observable` interop, and the `SQLiteAdapter` /
 * `LokiJSAdapter` option handling (default driver, IndexedDB persistence).
 */

import { Subject } from '../observable/Subject';
import { createRawRecord } from '../model/Model';
import {
  m,
  Model,
  Q,
  Database,
  LokiJSAdapter,
  SQLiteAdapter,
  appSchema,
  tableSchema,
  schemaMigrations,
  createTable,
  addColumns,
  unsafeExecuteSql,
  toCoreMigrations,
  toCoreMigrationStep,
  toCoreTableSchema,
  toCoreDatabaseSchema,
  toCoreColumnType,
  applyClauses,
  isComparison,
  rawFromDirty,
  WatermelonObservable,
  DatabaseProvider,
  withDatabase,
} from '../watermelon';
import type { Clause, Where } from '../watermelon';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ItemSchema = m.model('items', {
  title: m.text('title'),
  score: m.number('score').optional(),
  flag: m.boolean('flag'),
  dueAt: m.date('due_at').optional(),
  ownerId: m.text('owner_id').optional(),
});

class Item extends Model<typeof ItemSchema> {
  static schema = ItemSchema;
  static table = 'items';
  get title(): string { return this.getField('title') as string; }
  set title(value: string) { this.setField('title', value); }
  get score(): number | null { return this.getField('score') as number | null; }
  set score(value: number | null) { this.setField('score', value); }
  get flag(): boolean { return this.getField('flag') as boolean; }
  set flag(value: boolean) { this.setField('flag', value); }
  get ownerId(): string | null { return this.getField('ownerId') as string | null; }
  set ownerId(value: string | null) { this.setField('ownerId', value); }
}

const OwnerSchema = m.model('owners', { name: m.text('name') });
class Owner extends Model<typeof OwnerSchema> {
  static schema = OwnerSchema;
  static table = 'owners';
  get name(): string { return this.getField('name') as string; }
  set name(value: string) { this.setField('name', value); }
}

const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'items',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'score', type: 'number', isOptional: true },
        { name: 'flag', type: 'boolean' },
        { name: 'due_at', type: 'number', isOptional: true },
        { name: 'owner_id', type: 'string', isOptional: true },
      ],
    }),
    tableSchema({ name: 'owners', columns: [{ name: 'name', type: 'string' }] }),
  ],
});

function createDatabase(): Database {
  return new Database({
    adapter: new LokiJSAdapter({ schema, dbName: `cov-q-${Math.random()}` }),
    modelClasses: [Item, Owner],
  });
}

async function seed(db: Database): Promise<void> {
  await db.write(async () => {
    const items = db.get<Item>('items');
    await items.create((i) => { i.title = 'alpha'; i.score = 1; i.flag = true; i.ownerId = 'o1'; });
    await items.create((i) => { i.title = 'beta'; i.score = 5; i.flag = false; i.ownerId = 'o2'; });
    await items.create((i) => { i.title = 'gamma'; i.score = 10; i.flag = true; i.ownerId = null; });
    await items.create((i) => { i.title = 'a%b_c'; i.score = null; i.flag = false; i.ownerId = 'o1'; });
  });
}

async function titles(db: Database, ...clauses: Clause[]): Promise<string[]> {
  const items = await db.get<Item>('items').query(...clauses, Q.sortBy('title')).fetch();
  return items.map((i) => i.title);
}

// ═══════════════════════════════════════════════════════════════════════════
// Q
// ═══════════════════════════════════════════════════════════════════════════

describe('Q argument validation', () => {
  it('rejects undefined and non-scalar values', () => {
    expect(() => Q.eq(undefined as never)).toThrow(/value is undefined/);
    expect(() => Q.eq({} as never)).toThrow(/expected a string, number, boolean or null, got object/);
    expect(() => Q.where('x', undefined as never)).toThrow(/Q\.where\('x'\): value is undefined/);
    expect(() => Q.where('x', [] as never)).toThrow(TypeError);
    expect(() => Q.notEq(undefined as never)).toThrow(/Q\.notEq/);
    expect(() => Q.gt(undefined as never)).toThrow(/Q\.gt/);
    expect(() => Q.gte(undefined as never)).toThrow(/Q\.gte/);
    expect(() => Q.lt(undefined as never)).toThrow(/Q\.lt/);
    expect(() => Q.lte(undefined as never)).toThrow(/Q\.lte/);
  });

  it('rejects non-array lists and invalid list members', () => {
    expect(() => Q.oneOf('a' as never)).toThrow(/Q\.oneOf: expected an array of values/);
    expect(() => Q.notIn(null as never)).toThrow(/Q\.notIn: expected an array of values/);
    expect(() => Q.oneOf([1, undefined] as never)).toThrow(/Q\.oneOf: value is undefined/);
    expect(() => Q.notIn([{}] as never)).toThrow(/Q\.notIn: expected a string/);
  });

  it('rejects bad column names', () => {
    expect(() => Q.where('', 1)).toThrow(/Q\.where: expected a column name/);
    expect(() => Q.where(42 as never, 1)).toThrow(TypeError);
    expect(() => Q.sortBy('')).toThrow(/Q\.sortBy: expected a column name/);
    expect(() => Q.on('', Q.where('x', 1))).toThrow(/Q\.on: expected a column name/);
  });

  it('validates between / like / notLike / sortBy / take / skip arguments', () => {
    expect(() => Q.between('1' as never, 2)).toThrow(/Q\.between: expected two numbers/);
    expect(() => Q.between(1, null as never)).toThrow(TypeError);
    expect(() => Q.like(1 as never)).toThrow(/Q\.like: expected a string/);
    expect(() => Q.notLike(null as never)).toThrow(/Q\.notLike: expected a string/);
    expect(() => Q.sortBy('x', 'sideways' as never)).toThrow(/order must be Q\.asc or Q\.desc, got sideways/);
    expect(() => Q.take(-1)).toThrow(/Q\.take: expected a non-negative integer/);
    expect(() => Q.take(1.5)).toThrow(TypeError);
    expect(() => Q.skip(-1)).toThrow(/Q\.skip: expected a non-negative integer/);
    expect(() => Q.skip(Number.NaN)).toThrow(TypeError);
    expect(Q.sortBy('x')).toEqual({ type: 'sortBy', sortColumn: 'x', sortOrder: 'asc' });
    expect(Q.sortBy('x', Q.desc).sortOrder).toBe('desc');
    expect(Q.take(0)).toEqual({ type: 'take', count: 0 });
    expect(Q.skip(3)).toEqual({ type: 'skip', count: 3 });
  });

  it('validates Q.on forms', () => {
    expect(() => (Q.on as (...args: unknown[]) => unknown)('owners', 'name')).toThrow(/requires exactly a column and a value/);
    expect(() => (Q.on as (...args: unknown[]) => unknown)('owners', 'name', 1, 2)).toThrow(
      /requires exactly a column and a value/,
    );
    expect(Q.on('owners', 'name', 'x')).toEqual({
      type: 'on',
      table: 'owners',
      conditions: [Q.where('name', 'x')],
    });
    expect(Q.on('owners', 'name', Q.notEq(null)).conditions[0]).toEqual(Q.where('name', Q.notEq(null)));
    expect(Q.on('owners', Q.where('name', 'a'), [Q.where('name', 'b')]).conditions).toHaveLength(2);
    expect(Q.on('owners').conditions).toEqual([]);
  });

  it('flattens nested clause arrays and rejects non-clauses in and/or/on', () => {
    const a = Q.where('a', 1);
    const b = Q.where('b', 2);
    const c = Q.where('c', 3);
    expect(Q.and(a, [b, [c]] as unknown as Where[]).conditions).toEqual([a, b, c]);
    expect(Q.or([a], b).conditions).toEqual([a, b]);
    expect(() => Q.and('nope' as never)).toThrow(/Q\.and: expected Q\.where\/Q\.and\/Q\.or\/Q\.on clauses/);
    expect(() => Q.or(null as never)).toThrow(/Q\.or: expected/);
    expect(() => Q.on('owners', {} as never)).toThrow(/Q\.on: expected/);
    expect(() => Q.and([42] as never)).toThrow(TypeError);
  });

  it('isComparison recognises only Q comparison objects', () => {
    expect(isComparison(Q.eq(1))).toBe(true);
    expect(isComparison(null)).toBe(false);
    expect(isComparison('eq')).toBe(false);
    expect(isComparison(7)).toBe(false);
    expect(isComparison({ operator: 'eq', right: 1 })).toBe(false);
    expect(isComparison(undefined)).toBe(false);
  });

  it('exposes no-op join clauses and sanitizeLikeString', () => {
    const tables = ['a', 'b'];
    const join = Q.experimentalJoinTables(tables);
    expect(join).toEqual({ type: 'joinTables', tables: ['a', 'b'] });
    expect(join.tables).not.toBe(tables);
    expect(Q.experimentalNestedJoin('a', 'b')).toEqual({ type: 'nestedJoinTable', from: 'a', to: 'b' });
    expect(Q.sanitizeLikeString('50% off_now!')).toBe('50__off_now_');
    expect(Q.sanitizeLikeString('abc123')).toBe('abc123');
    expect(Q.asc).toBe('asc');
    expect(Q.desc).toBe('desc');
  });
});

describe('Q operators on a live database', () => {
  let db: Database;
  beforeAll(async () => {
    db = createDatabase();
    await seed(db);
  });
  afterAll(async () => {
    await db.pomegranate.close();
  });

  it('eq / notEq (including IS NULL / IS NOT NULL semantics)', async () => {
    expect(await titles(db, Q.where('score', 5))).toEqual(['beta']);
    expect(await titles(db, Q.where('score', Q.eq(null)))).toEqual(['a%b_c']);
    expect(await titles(db, Q.where('score', null))).toEqual(['a%b_c']);
    expect(await titles(db, Q.where('score', Q.notEq(null)))).toEqual(['alpha', 'beta', 'gamma']);
    // WatermelonDB's notEq also matches NULL
    expect(await titles(db, Q.where('score', Q.notEq(5)))).toEqual(['a%b_c', 'alpha', 'gamma']);
    expect(await titles(db, Q.where('flag', Q.notEq(true)))).toEqual(['a%b_c', 'beta']);
  });

  it('gt / gte / lt / lte / between', async () => {
    expect(await titles(db, Q.where('score', Q.gt(1)))).toEqual(['beta', 'gamma']);
    expect(await titles(db, Q.where('score', Q.gte(5)))).toEqual(['beta', 'gamma']);
    // NULL scores are excluded explicitly: SQLite never matches NULL in `<`, LokiJS does.
    const notNull = Q.where('score', Q.notEq(null));
    expect(await titles(db, notNull, Q.where('score', Q.lt(5)))).toEqual(['alpha']);
    expect(await titles(db, notNull, Q.where('score', Q.lte(5)))).toEqual(['alpha', 'beta']);
    expect(await titles(db, Q.where('score', Q.between(1, 5)))).toEqual(['alpha', 'beta']);
  });

  it('oneOf / notIn with booleans normalised to 0/1', async () => {
    expect(await titles(db, Q.where('score', Q.oneOf([1, 10])))).toEqual(['alpha', 'gamma']);
    expect(await titles(db, Q.where('flag', Q.oneOf([true])))).toEqual(['alpha', 'gamma']);
    expect(await titles(db, Q.where('score', Q.notEq(null)), Q.where('score', Q.notIn([1, 10])))).toEqual(['beta']);
    expect(await titles(db, Q.where('flag', Q.notIn([false])))).toEqual(['alpha', 'gamma']);
  });

  it('like / notLike with sanitized patterns', async () => {
    expect(await titles(db, Q.where('title', Q.like('%a%')))).toEqual(['a%b_c', 'alpha', 'beta', 'gamma']);
    expect(await titles(db, Q.where('title', Q.notLike('%a%')))).toEqual([]);
    expect(await titles(db, Q.where('title', Q.notLike('a%')))).toEqual(['beta', 'gamma']);
    const sanitized = `%${Q.sanitizeLikeString('a%b')}%`; // "a_b" -> matches a%b_c only via wildcard _
    expect(await titles(db, Q.where('title', Q.like(sanitized)))).toEqual(['a%b_c']);
  });

  it('and / or nesting, sortBy, take, skip and join no-ops', async () => {
    expect(
      await titles(db, Q.or(Q.where('title', 'alpha'), Q.and(Q.where('flag', false), Q.where('score', Q.gt(1))))),
    ).toEqual(['alpha', 'beta']);
    expect(await titles(db, Q.and([Q.where('flag', true)], Q.or(Q.where('score', 1), Q.where('score', 10)))))
      .toEqual(['alpha', 'gamma']);
    // empty and/or are no-ops
    expect(await titles(db, Q.and(), Q.or())).toEqual(['a%b_c', 'alpha', 'beta', 'gamma']);
    const paged = await db.get<Item>('items')
      .query(Q.experimentalJoinTables(['owners']), Q.experimentalNestedJoin('items', 'owners'),
        Q.sortBy('title', Q.desc), Q.skip(1), Q.take(2))
      .fetch();
    expect(paged.map((i) => i.title)).toEqual(['beta', 'alpha']);
    expect(await db.get<Item>('items').query([Q.where('flag', true)]).fetchCount()).toBe(2);
    expect((await db.get<Item>('items').query(Q.where('flag', true)).fetchIds())).toHaveLength(2);
  });

  it('Q.on in both forms joins through the related table', async () => {
    const ItemWithOwner = Item as unknown as { associations?: unknown };
    ItemWithOwner.associations = { owners: { type: 'belongs_to', key: 'owner_id' } };
    await db.write(async () => {
      await db.get<Owner>('owners').createFromDirtyRaw({ id: 'o1', name: 'one' });
      await db.get<Owner>('owners').createFromDirtyRaw({ id: 'o2', name: 'two' });
    });
    const viaValue = await db.get<Item>('items').query(Q.on('owners', 'name', 'one'), Q.sortBy('title')).fetch();
    const viaClauses = await db.get<Item>('items')
      .query(Q.on('owners', Q.where('name', Q.oneOf(['one', 'two']))), Q.sortBy('title'))
      .fetch();
    expect(viaValue.map((i) => i.title)).toEqual(['a%b_c', 'alpha']);
    expect(viaClauses.map((i) => i.title)).toEqual(['a%b_c', 'alpha', 'beta']);
  });

  it('rejects unknown clause types when the query is compiled', () => {
    const query = db.get<Item>('items').query({ type: 'bogus' } as unknown as Clause);
    expect(() => query.description).toThrow(/Unknown query clause type "bogus"/);
    expect(() => applyClauses(db.get<Item>('items').pomegranate.query(), [{ type: 'nope' } as unknown as Clause]))
      .toThrow(/Unknown query clause type "nope"/);
    expect(query.table).toBe('items');
    expect(query.extend(Q.take(1)).clauses).toHaveLength(2);
    const nested: Where = Q.and(Q.where('title', 'x'));
    expect(() => applyClauses(db.get<Item>('items').pomegranate.query(), [nested, Q.sortBy('title')])).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Schema & migrations
// ═══════════════════════════════════════════════════════════════════════════

describe('appSchema / tableSchema validation', () => {
  it('rejects nameless, reserved, invalid and duplicate columns', () => {
    expect(() => tableSchema({ name: 't', columns: [{ name: '', type: 'string' }] }))
      .toThrow(/Table "t" has a column without a name/);
    expect(() => tableSchema({ name: 't', columns: [{ name: undefined as never, type: 'string' }] }))
      .toThrow(/without a name/);
    expect(() => tableSchema({ name: 't', columns: [{ name: 'id', type: 'string' }] }))
      .toThrow(/reserved/);
    expect(() => tableSchema({ name: 't', columns: [{ name: 'x', type: 'date' as never }] }))
      .toThrow(/invalid type "date"/);
    expect(() => tableSchema({ name: 't', columns: [{ name: 'x', type: 'string' }, { name: 'x', type: 'number' }] }))
      .toThrow(/Duplicate column "x" on table "t"/);
  });

  it('rejects nameless tables, bad versions and duplicate tables', () => {
    expect(() => tableSchema({ name: '', columns: [] })).toThrow(/tableSchema\(\) requires a table name/);
    expect(() => tableSchema({ name: 3 as never, columns: [] })).toThrow(/requires a table name/);
    expect(() => appSchema({ version: 0, tables: [] })).toThrow(/positive integer, got 0/);
    expect(() => appSchema({ version: 1.5, tables: [] })).toThrow(/positive integer/);
    const t = tableSchema({ name: 'dup', columns: [] });
    expect(() => appSchema({ version: 1, tables: [t, t] })).toThrow(/Duplicate table "dup"/);
  });

  it('keeps WatermelonDB shape and converts to the core schema', () => {
    const unsafeSql = (sql: string) => sql;
    const t = tableSchema({ name: 'things', columns: [{ name: 'a', type: 'string', isIndexed: true }], unsafeSql });
    expect(t.columns.a).toEqual({ name: 'a', type: 'string', isIndexed: true });
    expect(t.columnArray).toHaveLength(1);
    expect(t.unsafeSql).toBe(unsafeSql);
    const app = appSchema({ version: 2, tables: [t], unsafeSql: (sql) => sql });
    expect(app.tables.things).toBe(t);
    expect(toCoreDatabaseSchema(app)).toEqual({
      version: 2,
      tables: [{ name: 'things', columns: [{ name: 'a', type: 'text', isOptional: false, isIndexed: true }] }],
    });
    // A plain spec (columns as an array) converts too
    expect(toCoreTableSchema({ name: 'spec', columns: [{ name: 'n', type: 'number', isOptional: true }] }))
      .toEqual({ name: 'spec', columns: [{ name: 'n', type: 'number', isOptional: true, isIndexed: false }] });
    expect(toCoreColumnType('boolean')).toBe('boolean');
    expect(toCoreColumnType('number')).toBe('number');
    expect(toCoreColumnType('string')).toBe('text');
  });
});

describe('schemaMigrations validation and conversion', () => {
  it('validates addColumns / unsafeExecuteSql arguments', () => {
    expect(() => addColumns({ table: '', columns: [{ name: 'x', type: 'string' }] }))
      .toThrow(/addColumns\(\) requires a table name/);
    expect(() => addColumns({ table: undefined as never, columns: [] })).toThrow(/requires a table name/);
    expect(() => addColumns({ table: 't', columns: [] }))
      .toThrow(/addColumns\(\) for table "t" requires at least one column/);
    expect(() => addColumns({ table: 't', columns: 'x' as never })).toThrow(/at least one column/);
    expect(() => addColumns({ table: 't', columns: [{ name: '_status', type: 'string' }] })).toThrow(/reserved/);
    expect(() => unsafeExecuteSql(5 as never)).toThrow(/unsafeExecuteSql\(\) requires a SQL string/);
    expect(unsafeExecuteSql('VACUUM')).toEqual({ type: 'sql', sql: 'VACUUM' });
    const columns = [{ name: 'x', type: 'string' as const }];
    const step = addColumns({ table: 't', columns, unsafeSql: (sql) => sql });
    expect(step.columns).toEqual(columns);
    expect(step.columns).not.toBe(columns);
  });

  it('validates the migrations list', () => {
    expect(() => schemaMigrations({ migrations: 'x' as never })).toThrow(/requires a `migrations` array/);
    expect(() => schemaMigrations({ migrations: [{ toVersion: 1, steps: [] }] }))
      .toThrow(/Invalid migration toVersion 1/);
    expect(() => schemaMigrations({ migrations: [{ toVersion: 2.5, steps: [] }] }))
      .toThrow(/Invalid migration toVersion 2.5/);
    expect(() => schemaMigrations({ migrations: [{ toVersion: 2, steps: null as never }] }))
      .toThrow(/Migration to version 2 has no steps array/);
    expect(() => schemaMigrations({ migrations: [{ toVersion: 2, steps: [] }, { toVersion: 2, steps: [] }] }))
      .toThrow(/Duplicate migration to schema version 2/);
    expect(() => schemaMigrations({ migrations: [{ toVersion: 2, steps: [] }, { toVersion: 4, steps: [] }] }))
      .toThrow(/Missing migration between schema versions 2 and 4/);
    const empty = schemaMigrations({ migrations: [] });
    expect(empty).toEqual({ validated: true, minVersion: 1, maxVersion: 1, sortedMigrations: [] });
    const sorted = schemaMigrations({ migrations: [{ toVersion: 3, steps: [] }, { toVersion: 2, steps: [] }] });
    expect(sorted.minVersion).toBe(1);
    expect(sorted.maxVersion).toBe(3);
    expect(sorted.sortedMigrations.map((mg) => mg.toVersion)).toEqual([2, 3]);
  });

  it('converts every step type and rejects unknown ones', () => {
    expect(toCoreMigrationStep(createTable({ name: 'n', columns: [{ name: 'c', type: 'boolean' }] }))).toEqual({
      type: 'createTable',
      schema: { name: 'n', columns: [{ name: 'c', type: 'boolean', isOptional: false, isIndexed: false }] },
    });
    expect(toCoreMigrationStep(addColumns({ table: 'n', columns: [{ name: 'd', type: 'number' }] }))).toEqual({
      type: 'addColumns',
      table: 'n',
      columns: [{ name: 'd', type: 'number', isOptional: false, isIndexed: false }],
    });
    expect(toCoreMigrationStep(unsafeExecuteSql('CREATE INDEX i ON n(d)'))).toEqual({
      type: 'sql',
      query: 'CREATE INDEX i ON n(d)',
    });
    expect(() => toCoreMigrationStep({ type: 'rename' } as never)).toThrow(/Unknown migration step type "rename"/);
    expect(toCoreMigrations(undefined)).toEqual([]);
    const list = [{ toVersion: 2, steps: [unsafeExecuteSql('X')] }];
    expect(toCoreMigrations(list)).toEqual([{ fromVersion: 1, toVersion: 2, steps: [{ type: 'sql', query: 'X' }] }]);
    expect(toCoreMigrations(schemaMigrations({ migrations: list }))).toEqual(toCoreMigrations(list));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// rawFromDirty coercion
// ═══════════════════════════════════════════════════════════════════════════

describe('rawFromDirty', () => {
  it('coerces per column type and falls back to defaults for invalid values', () => {
    const due = new Date('2024-01-02T03:04:05.000Z');
    const raw = rawFromDirty(ItemSchema, {
      id: 'r1',
      title: null, // required text: default ''
      score: 'nan', // invalid number: default null (optional)
      flag: 'yes', // invalid boolean: default false
      due_at: due, // Date instance -> timestamp
      owner_id: 7, // invalid text: optional -> null default
      unknown: 'dropped',
    });
    expect(raw).toEqual({ id: 'r1', _status: 'created', _changed: '', title: '', score: null, flag: 0, due_at: due.getTime(), owner_id: null });
    expect(rawFromDirty(ItemSchema, { flag: 1, due_at: 'tomorrow' }).flag).toBe(1);
    expect(rawFromDirty(ItemSchema, { flag: 0, due_at: 'tomorrow' }).due_at).toBeNull();
    expect(rawFromDirty(ItemSchema, { flag: 0 }).flag).toBe(0);
    expect(rawFromDirty(ItemSchema, { flag: 2 }).flag).toBe(0);
    expect(rawFromDirty(ItemSchema, { due_at: new Date('garbage') }).due_at).toBeNull();
    expect(rawFromDirty(ItemSchema, { due_at: 1_700_000_000_000 }).due_at).toBe(1_700_000_000_000);
    expect(rawFromDirty(ItemSchema, { due_at: Number.POSITIVE_INFINITY }).due_at).toBeNull();
    expect(rawFromDirty(ItemSchema, { score: null }).score).toBeNull();
    expect(rawFromDirty(ItemSchema, { score: 3 }).score).toBe(3);
    expect(rawFromDirty(ItemSchema, { title: 'ok', flag: true }).title).toBe('ok');
    expect(rawFromDirty(ItemSchema, { id: '' }).id).not.toBe('');
    expect(rawFromDirty(ItemSchema, { id: 42 }).id).not.toBe(42);
  });

  it('passes json values through untouched', () => {
    const JsonSchema = m.model('json_things', { data: m.json('data', (v) => v) });
    expect(rawFromDirty(JsonSchema, { data: { a: 1 } }).data).toBe(JSON.stringify({ a: 1 }));
    expect(rawFromDirty(JsonSchema, {}).data).toBe(createRawRecord(JsonSchema, {}).data);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WatermelonObservable
// ═══════════════════════════════════════════════════════════════════════════

describe('WatermelonObservable', () => {
  it('defer() accepts a synchronous factory and shares it between subscribers', () => {
    const subject = new Subject<number>();
    let calls = 0;
    const deferred = WatermelonObservable.defer(() => {
      calls++;
      return subject;
    });
    const a: number[] = [];
    const b: number[] = [];
    const subA = deferred.subscribe((v) => a.push(v));
    const subB = deferred.subscribe({ next: (v) => b.push(v) });
    subject.next(1);
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
    expect(calls).toBe(1);
    subA.unsubscribe();
    subject.next(2);
    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
    subB();
    subject.next(3);
    expect(b).toEqual([1, 2]);
  });

  it('defer() ignores a late source when unsubscribed before the factory resolves', async () => {
    const subject = new Subject<number>();
    let resolve: (o: Subject<number>) => void = () => {};
    const deferred = WatermelonObservable.defer(() => new Promise<Subject<number>>((r) => { resolve = r; }));
    const seen: number[] = [];
    const sub = deferred.subscribe((v) => seen.push(v));
    sub.unsubscribe();
    resolve(subject);
    await Promise.resolve();
    subject.next(1);
    expect(seen).toEqual([]);
    // a rejection after unsubscribe is swallowed
    const errors: unknown[] = [];
    let reject: (e: unknown) => void = () => {};
    const failing = WatermelonObservable.defer(() => new Promise<Subject<number>>((_, r) => { reject = r; }));
    failing.subscribe({ error: (e) => errors.push(e) }).unsubscribe();
    reject(new Error('late'));
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual([]);
  });

  it('routes error/complete to the observer, closes the subscription and runs teardown once', () => {
    let observer: { next: (v: number) => void; error: (e: unknown) => void; complete: () => void } | null = null;
    let teardowns = 0;
    const source = new WatermelonObservable<number>((o) => {
      observer = o;
      return () => { teardowns++; };
    });
    const events: string[] = [];
    const sub = source.subscribe({
      next: (v) => events.push(`next:${v}`),
      error: (e) => events.push(`error:${(e as Error).message}`),
      complete: () => events.push('complete'),
    });
    observer!.next(1);
    observer!.error(new Error('bad'));
    expect(sub.closed).toBe(true);
    expect(teardowns).toBe(1);
    // after close: next / error / complete are all ignored
    observer!.next(2);
    observer!.error(new Error('again'));
    observer!.complete();
    sub.unsubscribe();
    sub();
    expect(teardowns).toBe(1);
    expect(events).toEqual(['next:1', 'error:bad']);
  });

  it('complete() closes and later notifications are dropped', () => {
    let observer: { next: (v: number) => void; complete: () => void } | null = null;
    const source = new WatermelonObservable<number>((o) => {
      observer = o;
      return () => {};
    });
    const events: string[] = [];
    const sub = source.subscribe({ next: (v) => events.push(`next:${v}`), complete: () => events.push('complete') });
    observer!.complete();
    observer!.complete();
    observer!.next(9);
    expect(events).toEqual(['complete']);
    expect(sub.closed).toBe(true);
    // observer with only `next` as a function + no complete handler is fine
    const bare = source.subscribe(() => {});
    observer!.complete();
    expect(bare.closed).toBe(true);
  });

  it('logs unhandled errors when the observer has no error handler', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const source = new WatermelonObservable<number>((o) => {
        o.error(new Error('unhandled'));
        return () => {};
      });
      const sub = source.subscribe((v) => v);
      expect(sub.closed).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled error in observable subscription'),
        expect.objectContaining({ message: 'unhandled' }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('runs the teardown immediately when the producer completes synchronously', () => {
    let teardowns = 0;
    const source = new WatermelonObservable<number>((o) => {
      o.next(1);
      o.complete();
      return () => { teardowns++; };
    });
    const seen: number[] = [];
    const sub = source.subscribe({ next: (v) => seen.push(v) });
    expect(seen).toEqual([1]);
    expect(sub.closed).toBe(true);
    expect(teardowns).toBe(1);
    expect((sub as unknown as { started: boolean }).started).toBe(true);
  });

  it('from() forwards values from a core observable', () => {
    const subject = new Subject<string>();
    const seen: string[] = [];
    const sub = WatermelonObservable.from(subject).subscribe((v) => seen.push(v));
    subject.next('a');
    sub.unsubscribe();
    subject.next('b');
    expect(seen).toEqual(['a']);
    expect(subject.subscriberCount).toBe(0);
  });

  it('exposes @@observable always and Symbol.observable when the runtime defines it', () => {
    const plain = new WatermelonObservable<number>(() => () => {});
    expect((plain as unknown as Record<string, () => unknown>)['@@observable']()).toBe(plain);

    const interop = Symbol.for('cov-observable');
    Object.defineProperty(Symbol, 'observable', { value: interop, configurable: true, writable: true });
    try {
      jest.isolateModules(() => {
        const fresh = require('../watermelon/observable') as typeof import('../watermelon/observable');
        const observable = new fresh.WatermelonObservable<number>(() => () => {});
        expect((observable as unknown as Record<symbol, () => unknown>)[interop]()).toBe(observable);
        expect((observable as unknown as Record<string, () => unknown>)['@@observable']()).toBe(observable);
      });
    } finally {
      delete (Symbol as unknown as Record<string, unknown>).observable;
    }
    expect((Symbol as unknown as Record<string, unknown>).observable).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Adapters
// ═══════════════════════════════════════════════════════════════════════════

type AdaptersModule = typeof import('../watermelon/adapters');

/**
 * Load `watermelon/adapters` in an isolated module registry and run `fn` with
 * it. `fn` runs inside the isolation so the adapters' lazy `require()` calls
 * (native driver, Loki IndexedDB adapter) see the mocks registered by `setup`.
 */
function withFreshAdapters(setup: (() => void) | null, fn: (adapters: AdaptersModule) => void): void {
  setup?.();
  jest.isolateModules(() => {
    fn(require('../watermelon/adapters') as AdaptersModule);
  });
}

describe('SQLiteAdapter', () => {
  it('requires options with a schema', () => {
    expect(() => new SQLiteAdapter(undefined as never)).toThrow(/SQLiteAdapter requires a `schema`/);
    expect(() => new SQLiteAdapter({ migrations: undefined } as never)).toThrow(/requires a `schema`/);
  });

  it('resolves the native JSI driver lazily when no driver is given', () => {
    const fakeDriver = { open: async () => {}, close: async () => {} };
    const createNativeSQLiteDriver = jest.fn(() => fakeDriver);
    withFreshAdapters(
      () => jest.doMock('../adapters/native-sqlite', () => ({ createNativeSQLiteDriver })),
      ({ SQLiteAdapter: FreshSQLiteAdapter }) => {
        const adapter = new FreshSQLiteAdapter({ schema, dbName: 'native.db', usesExclusiveLocking: true });
        expect(createNativeSQLiteDriver).toHaveBeenCalledTimes(1);
        expect((adapter.pomegranate as unknown as { _driver: unknown })._driver).toBe(fakeDriver);
        expect(adapter.dbName).toBe('native.db');
        expect(adapter.migrations).toEqual([]);
        const withDriver = new FreshSQLiteAdapter({ schema, driver: fakeDriver as never });
        expect(createNativeSQLiteDriver).toHaveBeenCalledTimes(1);
        expect(withDriver.dbName).toBe('pomegranate');
      },
    );
    jest.dontMock('../adapters/native-sqlite');
  });
});

describe('LokiJSAdapter', () => {
  const idb = globalThis as { indexedDB?: unknown };
  afterEach(() => {
    delete idb.indexedDB;
    jest.dontMock('lokijs/src/incremental-indexeddb-adapter');
  });

  it('requires options with a schema and defaults the database name', () => {
    expect(() => new LokiJSAdapter(undefined as never)).toThrow(/LokiJSAdapter requires a `schema`/);
    expect(() => new LokiJSAdapter({} as never)).toThrow(/requires a `schema`/);
    const onSetUpError = () => {};
    const adapter = new LokiJSAdapter({ schema, onSetUpError });
    expect(adapter.dbName).toBe('pomegranate');
    expect(adapter.onSetUpError).toBe(onSetUpError);
    expect(adapter.persistent).toBe(false);
    expect(adapter.schema).toBe(schema);
  });

  it('warns once about useWebWorker in a fresh module', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      withFreshAdapters(null, ({ LokiJSAdapter: Fresh }) => {
        new Fresh({ schema, useWebWorker: true });
        new Fresh({ schema, useWebWorker: true });
        new Fresh({ schema, useWebWorker: false });
      });
      const warnings = warn.mock.calls.filter((c) => String(c[0]).includes('useWebWorker is not supported'));
      expect(warnings).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('uses the real incremental IndexedDB adapter when indexedDB exists', () => {
    idb.indexedDB = {};
    const adapter = new LokiJSAdapter({
      schema,
      useIncrementalIndexedDB: true,
      onQuotaExceededError: () => {},
      onIndexedDBVersionChange: () => {},
      onIndexedDBFetchStart: () => {},
      extraIncrementalIDBOptions: {},
    });
    expect(adapter.persistent).toBe(true);
    const config = (adapter.pomegranate as unknown as { _config: { persistenceAdapter?: { mode?: string } } })._config;
    expect(config.persistenceAdapter?.mode).toBe('incremental');
  });

  it('accepts an ES-module-shaped incremental adapter and tolerates a missing export', () => {
    idb.indexedDB = {};
    class FakeAdapter { mode = 'fake'; }
    withFreshAdapters(
      () => jest.doMock('lokijs/src/incremental-indexeddb-adapter', () => ({ default: FakeAdapter })),
      ({ LokiJSAdapter: WithDefault }) => {
        const persistent = new WithDefault({ schema, useIncrementalIndexedDB: true });
        expect(persistent.persistent).toBe(true);
        const config = (persistent.pomegranate as unknown as { _config: { persistenceAdapter: unknown } })._config;
        expect(config.persistenceAdapter).toBeInstanceOf(FakeAdapter);
      },
    );
    withFreshAdapters(
      () => jest.doMock('lokijs/src/incremental-indexeddb-adapter', () => ({})),
      ({ LokiJSAdapter: WithoutExport }) => {
        expect(new WithoutExport({ schema, useIncrementalIndexedDB: true }).persistent).toBe(false);
      },
    );
  });

  it('falls back to memory with a warning when the incremental adapter cannot be loaded', () => {
    idb.indexedDB = {};
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      withFreshAdapters(
        () => jest.doMock('lokijs/src/incremental-indexeddb-adapter', () => {
          throw new Error('module missing');
        }),
        ({ LokiJSAdapter: Broken }) => {
          const adapter = new Broken({ schema, useIncrementalIndexedDB: true });
          expect(adapter.persistent).toBe(false);
          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('could not load the IncrementalIndexedDB adapter'),
            expect.objectContaining({ message: 'module missing' }),
          );
        },
      );
    } finally {
      warn.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// React bindings (no renderer needed)
// ═══════════════════════════════════════════════════════════════════════════

describe('react bindings', () => {
  it('DatabaseProvider requires a database prop', () => {
    expect(() => DatabaseProvider({ database: undefined as never })).toThrow(/DatabaseProvider requires a `database` prop/);
    expect(() => DatabaseProvider({ database: null as never, children: null })).toThrow(/requires a `database`/);
  });

  it('withDatabase names the wrapper after displayName, name or a fallback', () => {
    function Named(_props: { database: Database }): null { return null; }
    expect(withDatabase(Named).displayName).toBe('withDatabase(Named)');
    const WithDisplayName = (_props: { database: Database }): null => null;
    WithDisplayName.displayName = 'Custom';
    expect(withDatabase(WithDisplayName).displayName).toBe('withDatabase(Custom)');
    const anonymous = (_props: { database: Database }): null => null;
    Object.defineProperty(anonymous, 'name', { value: undefined, configurable: true });
    expect(withDatabase(anonymous).displayName).toBe('withDatabase(Component)');
  });
});
