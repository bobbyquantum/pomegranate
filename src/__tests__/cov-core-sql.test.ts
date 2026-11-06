/**
 * SQL generation edge cases, verified against a real SQLite connection where
 * the statement shape matters (defaults, joins, empty IN lists).
 */

import BetterSqlite3 from 'better-sqlite3';

import {
  sqlTypeForColumn,
  columnDefinitionSQL,
  createTableSQL,
  addColumnSQL,
  legacyAddColumnSQL,
  selectSQL,
  countSQL,
  searchSQL,
} from '../adapters/sqlite/sql';
import type { ComparisonOperator, Condition, QueryDescriptor } from '../query/types';
import type { TableColumnSchema } from '../schema/types';

const col = (name: string, type: TableColumnSchema['type'], over: Partial<TableColumnSchema> = {}): TableColumnSchema => ({
  name,
  type,
  isOptional: false,
  isIndexed: false,
  ...over,
});

function descriptor(over: Partial<QueryDescriptor>): QueryDescriptor {
  return { table: 'tasks', conditions: [], orderBy: [], joins: [], ...over };
}

function runStatements(db: BetterSqlite3.Database, sql: string): void {
  for (const statement of sql.split(';\n')) {
    const trimmed = statement.trim().replace(/;$/, '');
    if (trimmed) db.prepare(trimmed).run();
  }
}

// ─── Column definitions ─────────────────────────────────────────────────

describe('column definitions', () => {
  it('maps every schema type to a SQLite storage type, defaulting to TEXT', () => {
    expect(['text', 'number', 'boolean', 'date', 'json'].map((t) => sqlTypeForColumn(t as never))).toEqual([
      'TEXT',
      'REAL',
      'INTEGER',
      'REAL',
      'TEXT',
    ]);
    expect(sqlTypeForColumn('blob' as never)).toBe('TEXT');
  });

  it('gives required columns the default of their type and optional ones NULL', () => {
    expect(columnDefinitionSQL(col('a', 'text'))).toBe('"a" TEXT NOT NULL DEFAULT \'\'');
    expect(columnDefinitionSQL(col('a', 'json'))).toBe('"a" TEXT NOT NULL DEFAULT \'\'');
    expect(columnDefinitionSQL(col('a', 'number'))).toBe('"a" REAL NOT NULL DEFAULT 0');
    expect(columnDefinitionSQL(col('a', 'boolean'))).toBe('"a" INTEGER NOT NULL DEFAULT 0');
    expect(columnDefinitionSQL(col('a', 'date'))).toBe('"a" REAL NOT NULL DEFAULT NULL');
    expect(columnDefinitionSQL(col('a', 'blob' as never))).toBe('"a" TEXT NOT NULL');
    expect(columnDefinitionSQL(col('a', 'date', { isOptional: true }))).toBe('"a" REAL DEFAULT NULL');
    expect(columnDefinitionSQL(col('a', 'json', { isOptional: true }))).toBe('"a" TEXT DEFAULT NULL');
  });

  it('createTableSQL builds a table SQLite accepts, with one index per indexed column', () => {
    const sql = createTableSQL({
      name: 'things',
      columns: [
        col('title', 'text', { isIndexed: true }),
        col('count', 'number'),
        col('flag', 'boolean'),
        col('when', 'date', { isOptional: true }),
        col('meta', 'json'),
      ],
    });
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "things__status" ON "things" ("_status")');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "things_title" ON "things" ("title")');
    expect(sql).not.toContain('"things_count"');

    const db = new BetterSqlite3(':memory:');
    runStatements(db, sql);
    db.prepare('INSERT INTO "things" ("id") VALUES (?)').run('t1');
    expect(db.prepare('SELECT * FROM "things"').get()).toEqual({
      id: 't1',
      _status: 'created',
      _changed: '',
      title: '',
      count: 0,
      flag: 0,
      when: null,
      meta: '',
    });
    db.close();
  });
});

// ─── ALTER TABLE … ADD COLUMN ───────────────────────────────────────────

describe('addColumnSQL / legacyAddColumnSQL', () => {
  it('follows the createTable rules, except required dates default to 0', () => {
    expect(addColumnSQL('t', col('d', 'date'))).toBe('ALTER TABLE "t" ADD COLUMN "d" REAL NOT NULL DEFAULT 0');
    expect(addColumnSQL('t', col('d', 'date', { isOptional: true }))).toBe('ALTER TABLE "t" ADD COLUMN "d" REAL DEFAULT NULL');
    expect(addColumnSQL('t', col('s', 'text'))).toBe('ALTER TABLE "t" ADD COLUMN "s" TEXT NOT NULL DEFAULT \'\'');
    expect(addColumnSQL('t', col('n', 'number', { isOptional: true }))).toBe('ALTER TABLE "t" ADD COLUMN "n" REAL DEFAULT NULL');
  });

  it('legacy steps take a SQL type: numeric types default to 0, others to an empty string', () => {
    expect(legacyAddColumnSQL('t', 'a', 'INTEGER', true)).toBe('ALTER TABLE "t" ADD COLUMN "a" INTEGER DEFAULT NULL');
    expect(legacyAddColumnSQL('t', 'a', ' integer ', false)).toBe('ALTER TABLE "t" ADD COLUMN "a" integer NOT NULL DEFAULT 0');
    expect(legacyAddColumnSQL('t', 'a', 'REAL', false)).toBe('ALTER TABLE "t" ADD COLUMN "a" REAL NOT NULL DEFAULT 0');
    expect(legacyAddColumnSQL('t', 'a', 'BOOLEAN', false)).toBe('ALTER TABLE "t" ADD COLUMN "a" BOOLEAN NOT NULL DEFAULT 0');
    expect(legacyAddColumnSQL('t', 'a', 'TEXT', false)).toBe('ALTER TABLE "t" ADD COLUMN "a" TEXT NOT NULL DEFAULT \'\'');
    expect(legacyAddColumnSQL('t', 'a', 'INTVAL', false)).toBe('ALTER TABLE "t" ADD COLUMN "a" INTVAL NOT NULL DEFAULT \'\'');
  });

  it('fills existing rows with the defaults when run on SQLite', () => {
    const db = new BetterSqlite3(':memory:');
    runStatements(db, createTableSQL({ name: 't', columns: [col('title', 'text')] }));
    db.prepare('INSERT INTO "t" ("id", "title") VALUES (?, ?)').run('r1', 'x');
    db.prepare(addColumnSQL('t', col('due', 'date'))).run();
    db.prepare(addColumnSQL('t', col('note', 'text', { isOptional: true }))).run();
    db.prepare(legacyAddColumnSQL('t', 'legacy_n', 'INTEGER', false)).run();
    db.prepare(legacyAddColumnSQL('t', 'legacy_s', 'TEXT', false)).run();
    db.prepare(legacyAddColumnSQL('t', 'legacy_o', 'TEXT', true)).run();
    expect(db.prepare('SELECT * FROM "t"').get()).toMatchObject({
      id: 'r1',
      due: 0,
      note: null,
      legacy_n: 0,
      legacy_s: '',
      legacy_o: null,
    });
    db.close();
  });
});

// ─── SELECT / COUNT ─────────────────────────────────────────────────────

describe('selectSQL', () => {
  const where = (column: string, operator: ComparisonOperator, value: unknown): Condition => ({
    type: 'where',
    column,
    operator,
    value,
  });

  it('renders joins, negations and every comparison operator', () => {
    const { sql, bindings } = selectSQL(
      descriptor({
        joins: [{ table: 'projects', leftColumn: 'project_id', rightColumn: 'id' }],
        conditions: [
          { type: 'not', condition: where('title', 'notLike', '%x%') },
          where('priority', 'between', [1, 5]),
          where('priority', 'neq', 3),
          where('priority', 'gte', 1),
          where('priority', 'lte', 5),
          where('priority', 'lt', 9),
          where('done', 'isNull', undefined),
          where('done', 'isNotNull', undefined),
          where('id', 'notIn', ['a', 'b']),
        ],
        orderBy: [
          { column: 'priority', order: 'desc' },
          { column: 'title', order: 'asc' },
        ],
        limit: 10,
        offset: 20,
      }),
    );
    expect(sql).toBe(
      'SELECT * FROM "tasks" JOIN "projects" ON "tasks"."project_id" = "projects"."id" ' +
        'WHERE NOT ("tasks"."title" NOT LIKE ?) AND "tasks"."priority" BETWEEN ? AND ? AND "tasks"."priority" != ? ' +
        'AND "tasks"."priority" >= ? AND "tasks"."priority" <= ? AND "tasks"."priority" < ? ' +
        'AND "tasks"."done" IS NULL AND "tasks"."done" IS NOT NULL AND "tasks"."id" NOT IN (?, ?) ' +
        'ORDER BY "tasks"."priority" DESC, "tasks"."title" ASC LIMIT ? OFFSET ?',
    );
    expect(bindings).toEqual(['%x%', 1, 5, 3, 1, 5, 9, 'a', 'b', 10, 20]);
  });

  it('nests exists clauses inside and/or/not groups with inner-table qualification', () => {
    const inner: Condition = {
      type: 'exists',
      table: 'comments',
      localColumn: 'id',
      foreignColumn: 'task_id',
      conditions: [
        where('approved', 'eq', 1),
        {
          type: 'exists',
          table: 'users',
          localColumn: 'author_id',
          foreignColumn: 'id',
          conditions: [where('name', 'like', 'a%')],
        },
      ],
    };
    const { sql, bindings } = selectSQL(
      descriptor({
        conditions: [{ type: 'and', conditions: [{ type: 'not', condition: inner }, { type: 'or', conditions: [where('done', 'eq', 1)] }] }],
      }),
    );
    expect(sql).toBe(
      'SELECT * FROM "tasks" WHERE (NOT (EXISTS (SELECT 1 FROM "comments" WHERE "comments"."task_id" = "tasks"."id" ' +
        'AND "comments"."_status" != \'deleted\' AND ("comments"."approved" = ? AND EXISTS (SELECT 1 FROM "users" ' +
        'WHERE "users"."id" = "comments"."author_id" AND "users"."_status" != \'deleted\' AND ("users"."name" LIKE ?))))) ' +
        'AND ("tasks"."done" = ?))',
    );
    expect(bindings).toEqual([1, 'a%', 1]);

    const count = countSQL(descriptor({ conditions: [inner] }));
    expect(count.sql).toMatch(/^SELECT COUNT\(\*\) as count FROM "tasks" WHERE EXISTS \(SELECT 1 FROM "comments"/);
    expect(count.bindings).toEqual([1, 'a%']);
  });

  it('renders an empty IN list that matches nothing, and the join really joins', () => {
    const db = new BetterSqlite3(':memory:');
    runStatements(db, createTableSQL({ name: 'tasks', columns: [col('title', 'text'), col('project_id', 'text', { isOptional: true })] }));
    runStatements(db, createTableSQL({ name: 'projects', columns: [col('name', 'text')] }));
    db.prepare('INSERT INTO "projects" ("id", "name") VALUES (?, ?)').run('p1', 'Proj');
    db.prepare('INSERT INTO "tasks" ("id", "title", "project_id") VALUES (?, ?, ?)').run('t1', 'linked', 'p1');
    db.prepare('INSERT INTO "tasks" ("id", "title", "project_id") VALUES (?, ?, ?)').run('t2', 'orphan', null);

    const empty = selectSQL(descriptor({ conditions: [where('id', 'in', [])] }));
    expect(empty.sql).toBe('SELECT * FROM "tasks" WHERE "tasks"."id" IN ()');
    expect(empty.bindings).toEqual([]);
    expect(db.prepare(empty.sql).all()).toEqual([]);

    const joined = selectSQL(
      descriptor({
        joins: [{ table: 'projects', leftColumn: 'project_id', rightColumn: 'id' }],
        conditions: [where('name', 'eq', 'Proj')],
      }),
    );
    // The where column is qualified with the outer table, so it must exist there.
    expect(() => db.prepare(joined.sql).all(...joined.bindings)).toThrow(/no such column/);
    const rows = db
      .prepare(selectSQL(descriptor({ joins: [{ table: 'projects', leftColumn: 'project_id', rightColumn: 'id' }] })).sql)
      .all() as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.title)).toEqual(['linked']);
    db.close();
  });

  it('rejects unknown condition types and operators', () => {
    expect(() => selectSQL(descriptor({ conditions: [{ type: 'xor' } as unknown as Condition] }))).toThrow(
      'Unknown condition type: xor',
    );
    expect(() => selectSQL(descriptor({ conditions: [where('a', 'matches' as never, 1)] }))).toThrow(
      'Unknown operator: matches',
    );
  });
});

// ─── SEARCH ─────────────────────────────────────────────────────────────

describe('searchSQL', () => {
  it('appends extra conditions to both queries and orders only the result query', () => {
    const { sql, countSql, bindings, countBindings } = searchSQL({
      table: 'tasks',
      term: '50%_off',
      fields: ['title', 'notes'],
      conditions: [
        { type: 'where', column: 'done', operator: 'eq', value: 0 },
        { type: 'or', conditions: [
          { type: 'where', column: 'priority', operator: 'gt', value: 1 },
          { type: 'where', column: 'priority', operator: 'isNull', value: undefined },
        ] },
      ],
      orderBy: [{ column: 'priority', order: 'desc' }],
      limit: 5,
      offset: 10,
    });
    expect(sql).toBe(
      'SELECT * FROM "tasks" WHERE ("tasks"."title" LIKE ? OR "tasks"."notes" LIKE ?) AND "tasks"."done" = ? ' +
        'AND ("tasks"."priority" > ? OR "tasks"."priority" IS NULL) ORDER BY "tasks"."priority" DESC LIMIT ? OFFSET ?',
    );
    expect(countSql).toBe(
      'SELECT COUNT(*) as count FROM "tasks" WHERE ("tasks"."title" LIKE ? OR "tasks"."notes" LIKE ?) AND "tasks"."done" = ? ' +
        'AND ("tasks"."priority" > ? OR "tasks"."priority" IS NULL)',
    );
    expect(bindings).toEqual([String.raw`%50\%\_off%`, String.raw`%50\%\_off%`, 0, 1, 5, 10]);
    expect(countBindings).toEqual([String.raw`%50\%\_off%`, String.raw`%50\%\_off%`, 0, 1]);
  });
});
