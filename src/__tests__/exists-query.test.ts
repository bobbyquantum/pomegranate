/**
 * `QueryBuilder.on()` / `onColumns()` — EXISTS sub-queries (WatermelonDB `Q.on`).
 *
 * Covers SQL generation, execution on both adapters (with identical results),
 * association resolution from schema relations and `static associations`,
 * nesting, and live-query reactivity to inner-table changes.
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import type { ModelAssociations } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { SQLiteAdapter } from '../adapters/sqlite/SQLiteAdapter';
import { selectSQL, countSQL } from '../adapters/sqlite/sql';
import { query } from '../query/QueryBuilder';
import type { QueryBuilder } from '../query/QueryBuilder';
import type { QueryDescriptor, ExistsClause } from '../query/types';
import { collectQueryColumns, collectExistsTables } from '../query/introspect';
import { createBetterSqliteDriver } from './helpers/betterSqliteDriver';

// ─── Schemas ───────────────────────────────────────────────────────────────

const ProjectSchema = m.model('projects', {
  name: m.text(),
  archived: m.boolean().default(false),
});

// FK declared as a plain optional column (WatermelonDB style) + static associations
const TaskSchema = m.model('tasks', {
  title: m.text(),
  done: m.boolean().default(false),
  status: m.text().default('open'),
  projectId: m.text('project_id').optional(),
  comments: m.hasMany(() => CommentSchema, { foreignKey: 'task_id' }),
});

// FK declared via m.belongsTo (schema relation)
const CommentSchema = m.model('comments', {
  body: m.text(),
  approved: m.boolean().default(false),
  task: m.belongsTo(() => TaskSchema, { key: 'task_id' }),
});

class Project extends Model<typeof ProjectSchema> {
  static schema = ProjectSchema;
  static associations: ModelAssociations = {
    tasks: { type: 'has_many', foreignKey: 'project_id' },
  };
}

class Task extends Model<typeof TaskSchema> {
  static schema = TaskSchema;
  static associations: ModelAssociations = {
    projects: { type: 'belongs_to', key: 'project_id' },
  };
}

class Comment extends Model<typeof CommentSchema> {
  static schema = CommentSchema;
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const adapters = [
  ['LokiAdapter', () => new LokiAdapter({ databaseName: `exists-${Math.random()}` })],
  [
    'SQLiteAdapter',
    () => new SQLiteAdapter({ databaseName: ':memory:', driver: createBetterSqliteDriver() }),
  ],
] as const;

async function seed(db: Database) {
  const fx: Record<string, Model> = {};
  await db.write(async () => {
    fx.p1 = await db.get(Project).create({ name: 'p1' });
    fx.p2 = await db.get(Project).create({ name: 'p2', archived: true });
    fx.p3 = await db.get(Project).create({ name: 'p3' });

    fx.t1 = await db.get(Task).create({ title: 't1', done: true, projectId: fx.p1.id });
    fx.t2 = await db.get(Task).create({ title: 't2', projectId: fx.p1.id });
    fx.t3 = await db.get(Task).create({
      title: 't3',
      done: true,
      status: 'closed',
      projectId: fx.p2.id,
    });
    fx.t4 = await db.get(Task).create({ title: 't4', done: true });
    fx.t5 = await db.get(Task).create({
      title: 't5',
      done: true,
      status: 'closed',
      projectId: fx.p1.id,
    });

    fx.c1 = await db.get(Comment).create({ body: 'c1', approved: true, task: fx.t1.id });
    fx.c2 = await db.get(Comment).create({ body: 'c2', task: fx.t2.id });
    fx.c3 = await db.get(Comment).create({ body: 'c3', approved: true, task: fx.t3.id });
    fx.c4 = await db.get(Comment).create({ body: 'c4', approved: true, task: fx.t2.id });

    await fx.t5.markAsDeleted();
    await fx.c4.markAsDeleted();
  });
  return fx;
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Human-readable label of a record: title / name / body, whichever the schema has */
const titles = (records: Model[]) =>
  records.map((r) => {
    const schema = (r.constructor as typeof Model).schema;
    const field = ['title', 'name', 'body'].find((f) =>
      schema.columns.some((c) => c.fieldName === f),
    )!;
    return r.getField(field) as string;
  });

// ─── SQL generation ────────────────────────────────────────────────────────

describe('EXISTS SQL generation', () => {
  const notDeleted = { type: 'where', column: '_status', operator: 'neq', value: 'deleted' } as const;

  it('qualifies every column and compiles exists as a correlated sub-query', () => {
    const descriptor: QueryDescriptor = {
      table: 'tasks',
      conditions: [
        notDeleted,
        {
          type: 'exists',
          table: 'projects',
          localColumn: 'project_id',
          foreignColumn: 'id',
          conditions: [{ type: 'where', column: 'archived', operator: 'eq', value: 0 }],
        },
      ],
      orderBy: [{ column: 'title', order: 'asc' }],
      joins: [],
    };

    const { sql, bindings } = selectSQL(descriptor);
    expect(sql).toBe(
      'SELECT * FROM "tasks" WHERE "tasks"."_status" != ? AND EXISTS (SELECT 1 FROM "projects" ' +
        'WHERE "projects"."id" = "tasks"."project_id" AND "projects"."_status" != \'deleted\' ' +
        'AND ("projects"."archived" = ?)) ORDER BY "tasks"."title" ASC',
    );
    expect(bindings).toEqual(['deleted', 0]);

    const count = countSQL(descriptor);
    expect(count.sql).toBe(
      'SELECT COUNT(*) as count FROM "tasks" WHERE "tasks"."_status" != ? AND EXISTS (SELECT 1 FROM "projects" ' +
        'WHERE "projects"."id" = "tasks"."project_id" AND "projects"."_status" != \'deleted\' ' +
        'AND ("projects"."archived" = ?))',
    );
    expect(count.bindings).toEqual(['deleted', 0]);
  });

  it('omits the inner condition group when there are none and nests exists clauses', () => {
    const inner: ExistsClause = {
      type: 'exists',
      table: 'comments',
      localColumn: 'id',
      foreignColumn: 'task_id',
      conditions: [],
    };
    const { sql, bindings } = selectSQL({
      table: 'projects',
      conditions: [
        {
          type: 'exists',
          table: 'tasks',
          localColumn: 'id',
          foreignColumn: 'project_id',
          conditions: [{ type: 'where', column: 'done', operator: 'eq', value: 1 }, inner],
        },
      ],
      orderBy: [],
      joins: [],
    });

    expect(sql).toBe(
      'SELECT * FROM "projects" WHERE EXISTS (SELECT 1 FROM "tasks" ' +
        'WHERE "tasks"."project_id" = "projects"."id" AND "tasks"."_status" != \'deleted\' ' +
        'AND ("tasks"."done" = ? AND EXISTS (SELECT 1 FROM "comments" ' +
        'WHERE "comments"."task_id" = "tasks"."id" AND "comments"."_status" != \'deleted\')))',
    );
    expect(bindings).toEqual([1]);
  });

  it('rejects unsafe table and column names', () => {
    expect(() =>
      selectSQL({
        table: 'tasks',
        conditions: [
          {
            type: 'exists',
            table: 'projects; DROP TABLE tasks',
            localColumn: 'project_id',
            foreignColumn: 'id',
            conditions: [],
          },
        ],
        orderBy: [],
        joins: [],
      }),
    ).toThrow('Invalid table name');
  });
});

// ─── Builder ───────────────────────────────────────────────────────────────

describe('QueryBuilder.on()', () => {
  it('throws a clear error without association metadata', () => {
    expect(() => query('tasks').on('projects', 'archived', false)).toThrow(
      /Cannot resolve association from "tasks" to "projects"/,
    );
  });

  it('builds exists clauses from a resolver and shares it with nested builders', () => {
    const joins: Record<string, { localColumn: string; foreignColumn: string }> = {
      'projects->tasks': { localColumn: 'id', foreignColumn: 'project_id' },
      'tasks->comments': { localColumn: 'id', foreignColumn: 'task_id' },
    };
    const resolver = jest.fn((from: string, to: string) => joins[`${from}->${to}`] ?? null);
    const descriptor = query('projects', { associations: resolver })
      .on('tasks', (t) => t.where('done', true).on('comments', 'approved', true))
      .build();

    expect(descriptor.conditions).toEqual([
      {
        type: 'exists',
        table: 'tasks',
        localColumn: 'id',
        foreignColumn: 'project_id',
        conditions: [
          { type: 'where', column: 'done', operator: 'eq', value: true },
          {
            type: 'exists',
            table: 'comments',
            localColumn: 'id',
            foreignColumn: 'task_id',
            conditions: [{ type: 'where', column: 'approved', operator: 'eq', value: true }],
          },
        ],
      },
    ]);
    expect(collectExistsTables(descriptor)).toEqual(new Set(['tasks', 'comments']));
    expect(collectQueryColumns(descriptor)).toEqual(new Set(['id']));
  });

  it('onColumns() needs no association metadata', () => {
    const descriptor = query('tasks').onColumns('projects', 'project_id', 'id').build();
    expect(descriptor.conditions[0]).toMatchObject({
      type: 'exists',
      table: 'projects',
      localColumn: 'project_id',
      foreignColumn: 'id',
      conditions: [],
    });
  });
});

// ─── Execution ─────────────────────────────────────────────────────────────

describe.each(adapters)('exists queries via %s', (_name, makeAdapter) => {
  let db: Database;
  let fx: Record<string, Model>;

  beforeEach(async () => {
    db = new Database({ adapter: makeAdapter(), models: [Project, Task, Comment] });
    await db.initialize();
    fx = await seed(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const fetchTitles = async <M extends Model>(
    collection: ReturnType<Database['get']>,
    fn: (q: QueryBuilder) => void,
    orderBy = 'title',
  ) => titles(await collection.fetch(collection.query((q) => (fn(q), q.orderBy(orderBy)))));

  it('belongs_to via static associations: on(table, column, value)', async () => {
    const result = await fetchTitles(db.get(Task), (q) => q.on('projects', 'archived', false));
    expect(result).toEqual(['t1', 't2']); // t5 deleted, t4 has no project
  });

  it('has_many via static associations: on(table, fn), ignoring deleted inner rows', async () => {
    expect(
      await fetchTitles(db.get(Project), (q) => q.on('tasks', (t) => t.where('done', true)), 'name'),
    ).toEqual(['p1', 'p2']);

    // p1's only closed task (t5) is deleted → excluded
    expect(
      await fetchTitles(db.get(Project), (q) => q.on('tasks', 'status', 'closed'), 'name'),
    ).toEqual(['p2']);
  });

  it('resolves associations from schema relations (belongsTo / hasMany)', async () => {
    expect(await fetchTitles(db.get(Comment), (q) => q.on('tasks', 'done', true), 'body')).toEqual(
      ['c1', 'c3'],
    );
    // t2's only approved comment (c4) is deleted
    expect(await fetchTitles(db.get(Task), (q) => q.on('comments', 'approved', true))).toEqual([
      't1',
      't3',
    ]);
  });

  it('supports nested exists clauses', async () => {
    expect(
      await fetchTitles(
        db.get(Project),
        (q) => q.on('tasks', (t) => t.on('comments', 'approved', true)),
        'name',
      ),
    ).toEqual(['p1', 'p2']);

    expect(
      await fetchTitles(
        db.get(Project),
        (q) => q.on('tasks', (t) => t.on('comments', (c) => c.where('body', 'nope'))),
        'name',
      ),
    ).toEqual([]);
  });

  it('yields no rows for an empty inner set', async () => {
    expect(await fetchTitles(db.get(Task), (q) => q.on('projects', 'name', 'missing'))).toEqual([]);
  });

  it('composes with or() and counts', async () => {
    expect(
      await fetchTitles(db.get(Task), (q) =>
        q.or((o) => {
          o.where('title', 't4');
          o.on('projects', 'archived', true);
        }),
      ),
    ).toEqual(['t3', 't4']);

    await expect(
      db.get(Task).count(db.get(Task).query((q) => q.on('projects', 'archived', false))),
    ).resolves.toBe(2);
  });

  it('supports NOT EXISTS (via a not condition)', async () => {
    const base = db.get(Task).query().orderBy('title').build();
    const exists: ExistsClause = {
      type: 'exists',
      table: 'projects',
      localColumn: 'project_id',
      foreignColumn: 'id',
      conditions: [{ type: 'where', column: 'archived', operator: 'eq', value: false }],
    };
    const descriptor: QueryDescriptor = {
      ...base,
      conditions: [...base.conditions, { type: 'not', condition: exists }],
    };
    expect(titles(await db.get(Task).fetch(descriptor))).toEqual(['t3', 't4']);
  });

  it('onColumns() joins explicitly', async () => {
    expect(
      await fetchTitles(db.get(Task), (q) =>
        q.onColumns('projects', 'project_id', 'id', (p) => p.where('archived', true)),
      ),
    ).toEqual(['t3']);
  });

  it('throws for unknown associations', () => {
    expect(() => db.get(Project).query((q) => q.on('comments', 'approved', true))).toThrow(
      /Cannot resolve association from "projects" to "comments"/,
    );
    expect(() => db.get(Task).query((q) => q.on('nope', 'x', 1))).toThrow(
      /Cannot resolve association from "tasks" to "nope"/,
    );
  });

  describe('live queries', () => {
    it('re-runs when the inner table changes and emits when results differ', async () => {
      const emissions: string[][] = [];
      const findSpy = jest.spyOn(db._adapter, 'find');
      const unsub = db
        .get(Task)
        .observeQuery(db.get(Task).query((q) => q.on('projects', 'archived', false).orderBy('title')))
        .subscribe((records) => emissions.push(titles(records)));
      await tick();
      expect(emissions).toEqual([['t1', 't2']]);
      findSpy.mockClear();

      // Irrelevant inner change → re-run, no emission
      await db.write(async () => {
        await fx.p3.update({ name: 'renamed' });
      });
      await tick();
      expect(findSpy).toHaveBeenCalledTimes(1);
      expect(emissions).toHaveLength(1);

      // Inner change that alters membership → emission
      await db.write(async () => {
        await fx.p1.update({ archived: true });
      });
      await tick();
      expect(emissions).toEqual([['t1', 't2'], []]);

      // Outer change on an unreferenced column of a non-matching record → no re-run
      findSpy.mockClear();
      await db.write(async () => {
        await fx.t4.update({ status: 'parked' });
      });
      await tick();
      expect(findSpy).not.toHaveBeenCalled();

      unsub();
      findSpy.mockRestore();
    });

    it('observeCount follows inner-table changes', async () => {
      const counts: number[] = [];
      const unsub = db
        .get(Project)
        .observeCount(db.get(Project).query((q) => q.on('tasks', 'done', true)))
        .subscribe((c) => counts.push(c));
      await tick();
      expect(counts).toEqual([2]);

      await db.write(async () => {
        await fx.t2.update({ done: true });
      });
      await tick();
      expect(counts).toEqual([2]); // p1 already matched

      await db.write(async () => {
        await fx.t4.update({ projectId: fx.p3.id });
      });
      await tick();
      expect(counts).toEqual([2, 3]);
      unsub();
    });
  });
});

// ─── Adapter equivalence ───────────────────────────────────────────────────

describe('Loki and SQLite agree on exists and like queries', () => {
  const cases: Array<[string, string, (q: QueryBuilder) => void]> = [
    ['tasks', 'title', (q) => q.on('projects', 'archived', false)],
    ['tasks', 'title', (q) => q.on('comments', (c) => c.where('body', 'like', 'C_'))],
    [
      'tasks',
      'title',
      (q) =>
        q.where('title', 'notLike', 'T1').or((o) => {
          o.where('title', 'like', 'T4');
          o.on('projects', 'name', 'p2');
        }),
    ],
    ['projects', 'name', (q) => q.on('tasks', (t) => t.where('status', 'like', 'CLOSED'))],
    ['projects', 'name', (q) => q.on('tasks', (t) => t.on('comments', 'approved', true))],
    ['comments', 'body', (q) => q.on('tasks', (t) => t.where('done', true).on('projects', 'archived', true))],
  ];

  it.each(cases.map((c, i) => [i, ...c] as const))('case %i (%s)', async (_i, table, orderBy, fn) => {
    const results: string[][] = [];
    for (const [, makeAdapter] of adapters) {
      const db = new Database({ adapter: makeAdapter(), models: [Project, Task, Comment] });
      await db.initialize();
      await seed(db);
      const collection = db.collection(table);
      results.push(titles(await collection.fetch(collection.query((q) => (fn(q), q.orderBy(orderBy))))));
      await db.close();
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0].length).toBeGreaterThan(0);
  });
});
