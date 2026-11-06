/**
 * Migrations driven by `Database.initialize()`:
 *  - contiguous chain validation, downgrade refusal, lifecycle events
 *  - `addColumns` / legacy `addColumn` default rules on SQLite and Loki
 *  - `createTable` steps create the `_status` and column indexes
 *  - transactional rollback on SQLite keeps the stored version
 *  - re-entrant `db.write()`
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import type { ModelStatic } from '../model/Model';
import { Database } from '../database/Database';
import { SQLiteAdapter } from '../adapters/sqlite/SQLiteAdapter';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import type { Migration } from '../adapters/types';
import { defaultValueForColumn, migrationSyncInfo, resolveMigrationChain } from '../database/migrations';
import { createBetterSqliteDriver } from './helpers/betterSqliteDriver';

// ─── Schemas ────────────────────────────────────────────────────────────

const TaskV1Schema = m.model('tasks', { title: m.text() });
class TaskV1 extends Model<typeof TaskV1Schema> {
  static schema = TaskV1Schema;
}

const TaskV3Schema = m.model('tasks', {
  title: m.text(),
  priority: m.number(),
  done: m.boolean(),
  notes: m.text().optional(),
  category: m.text().indexed(),
});
class TaskV3 extends Model<typeof TaskV3Schema> {
  static schema = TaskV3Schema;
}

const TagSchema = m.model('tags', { name: m.text(), color: m.text().indexed() });
class Tag extends Model<typeof TagSchema> {
  static schema = TagSchema;
}

const migration1to2: Migration = {
  fromVersion: 1,
  toVersion: 2,
  steps: [
    {
      type: 'addColumns',
      table: 'tasks',
      columns: [
        { name: 'priority', type: 'number', isOptional: false, isIndexed: false },
        { name: 'done', type: 'boolean', isOptional: false, isIndexed: false },
        { name: 'notes', type: 'text', isOptional: true, isIndexed: false },
        { name: 'category', type: 'text', isOptional: false, isIndexed: true },
      ],
    },
  ],
};

const migration2to3: Migration = {
  fromVersion: 2,
  toVersion: 3,
  steps: [
    {
      type: 'createTable',
      schema: {
        name: 'tags',
        columns: [
          { name: 'name', type: 'text', isOptional: false, isIndexed: false },
          { name: 'color', type: 'text', isOptional: false, isIndexed: true },
        ],
      },
    },
  ],
};

// ─── Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomegranate-migrations-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sqliteDb(
  file: string,
  options: { models: ModelStatic[]; schemaVersion: number; migrations?: Migration[]; events?: string[] },
) {
  const driver = createBetterSqliteDriver();
  const adapter = new SQLiteAdapter({ databaseName: path.join(tmpDir, file), driver });
  const events = options.events;
  const db = new Database({
    adapter,
    models: options.models,
    schemaVersion: options.schemaVersion,
    migrations: options.migrations,
    migrationEvents: events
      ? {
          onStart: (from, to) => events.push(`start ${from}->${to}`),
          onSuccess: (from, to) => events.push(`success ${from}->${to}`),
          onError: (error, from, to) =>
            events.push(`error ${from}->${to}: ${error instanceof Error ? error.message : String(error)}`),
        }
      : undefined,
  });
  return { db, adapter, driver };
}

async function seedV1(file: string): Promise<void> {
  const { db } = sqliteDb(file, { models: [TaskV1], schemaVersion: 1 });
  await db.initialize();
  await db.write(async () => {
    await db.get(TaskV1).create({ title: 'Old task' });
  });
  await db.close();
}

// ─── Chain validation (pure) ────────────────────────────────────────────

describe('resolveMigrationChain', () => {
  it('returns the ordered chain for a contiguous range', () => {
    expect(resolveMigrationChain([migration2to3, migration1to2], 1, 3)).toEqual([migration1to2, migration2to3]);
    expect(resolveMigrationChain([migration1to2, migration2to3], 2, 3)).toEqual([migration2to3]);
    expect(resolveMigrationChain([migration1to2], 3, 3)).toEqual([]);
  });

  it('lists the missing steps', () => {
    expect(() => resolveMigrationChain([migration1to2], 1, 4)).toThrow(
      'Missing migrations between schema versions 1 and 4: 2 → 3, 3 → 4',
    );
  });

  it('rejects multi-version jumps and duplicate targets', () => {
    expect(() => resolveMigrationChain([{ fromVersion: 1, toVersion: 3, steps: [] }], 1, 3)).toThrow(
      /exactly one version/,
    );
    expect(() =>
      resolveMigrationChain([migration1to2, { fromVersion: 1, toVersion: 2, steps: [] }], 1, 2),
    ).toThrow(/Duplicate migration to schema version 2/);
  });
});

describe('migrationSyncInfo', () => {
  it('collects created tables and added columns, excluding columns of new tables', () => {
    const withTagColumn: Migration = {
      fromVersion: 3,
      toVersion: 4,
      steps: [
        { type: 'addColumn', table: 'tags', column: 'weight', columnType: 'INTEGER' },
        { type: 'addColumns', table: 'tasks', columns: [{ name: 'due', type: 'date', isOptional: true, isIndexed: false }] },
        { type: 'sql', query: 'UPDATE "tasks" SET "due" = NULL' },
      ],
    };
    expect(migrationSyncInfo([migration1to2, migration2to3, withTagColumn], 1, 4)).toEqual({
      from: 1,
      tables: ['tags'],
      columns: [{ table: 'tasks', columns: ['priority', 'done', 'notes', 'category', 'due'] }],
    });
  });

  it('throws when the chain is incomplete', () => {
    expect(() => migrationSyncInfo([migration2to3], 1, 3)).toThrow(
      /Missing migrations between schema versions 1 and 3 — cannot sync/,
    );
  });
});

describe('defaultValueForColumn', () => {
  it('matches the SQL defaults', () => {
    expect(defaultValueForColumn('text', false)).toBe('');
    expect(defaultValueForColumn('number', false)).toBe(0);
    expect(defaultValueForColumn('boolean', false)).toBe(0);
    expect(defaultValueForColumn('date', false)).toBe(0);
    expect(defaultValueForColumn('text', true)).toBeNull();
  });
});

// ─── SQLite ─────────────────────────────────────────────────────────────

describe('Database.initialize() migrations on SQLite', () => {
  it('leaves a fresh install alone and stores the target version', async () => {
    const events: string[] = [];
    const { db, adapter } = sqliteDb('fresh.db', {
      models: [TaskV3, Tag],
      schemaVersion: 3,
      migrations: [migration1to2, migration2to3],
      events,
    });
    await db.initialize();
    expect(await adapter.getSchemaVersion()).toBe(3);
    expect(events).toEqual([]);
    await db.close();
  });

  it('migrates an older database, preserving data and applying defaults', async () => {
    await seedV1('upgrade.db');

    const events: string[] = [];
    const { db, adapter, driver } = sqliteDb('upgrade.db', {
      models: [TaskV3, Tag],
      schemaVersion: 3,
      migrations: [migration1to2, migration2to3],
      events,
    });
    await db.initialize();

    expect(events).toEqual(['start 1->3', 'success 1->3']);
    expect(await adapter.getSchemaVersion()).toBe(3);

    const tasks = db.get(TaskV3);
    const [task] = await tasks.fetch(tasks.query());
    expect(task.getField('title')).toBe('Old task');
    expect(task.getField('priority')).toBe(0);
    expect(task.getField('done')).toBe(false);
    expect(task.getField('notes')).toBeNull();
    expect(task.getField('category')).toBe('');

    // Column definitions follow createTableSQL's rules.
    const columns = driver.raw().prepare('PRAGMA table_info("tasks")').all() as Array<Record<string, unknown>>;
    const byName = Object.fromEntries(columns.map((c) => [c.name as string, c]));
    expect(byName.priority).toMatchObject({ type: 'REAL', notnull: 1, dflt_value: '0' });
    expect(byName.done).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(byName.notes).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: 'NULL' });
    expect(byName.category).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "''" });

    // Indexes: the added indexed column, and the new table's _status + column indexes.
    const indexNames = (table: string) =>
      (driver.raw().prepare(`PRAGMA index_list("${table}")`).all() as Array<{ name: string }>).map((i) => i.name);
    expect(indexNames('tasks')).toContain('tasks_category');
    expect(indexNames('tags')).toEqual(expect.arrayContaining(['tags__status', 'tags_color']));

    // The new table is usable.
    await db.write(async () => {
      await db.get(Tag).create({ name: 'urgent', color: 'red' });
    });
    expect(await db.get(Tag).count()).toBe(1);
    await db.close();
  });

  it('rolls back a failed migration and keeps the stored version', async () => {
    await seedV1('rollback.db');

    const events: string[] = [];
    const failing: Migration = {
      fromVersion: 1,
      toVersion: 2,
      steps: [...migration1to2.steps, { type: 'sql', query: 'UPDATE "no_such_table" SET "x" = 1' }],
    };
    const { db, adapter, driver } = sqliteDb('rollback.db', {
      models: [TaskV3],
      schemaVersion: 2,
      migrations: [failing],
      events,
    });

    await expect(db.initialize()).rejects.toThrow(/no_such_table/);
    expect(events).toHaveLength(2);
    expect(events[0]).toBe('start 1->2');
    expect(events[1]).toMatch(/^error 1->2: /);

    expect(await adapter.getSchemaVersion()).toBe(1);
    const columns = (driver.raw().prepare('PRAGMA table_info("tasks")').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(columns).not.toContain('priority');
    expect(driver.raw().prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 1 });
    await adapter.close();
  });

  it('throws before touching anything when the chain has a gap', async () => {
    await seedV1('gap.db');
    const events: string[] = [];
    const { db, adapter } = sqliteDb('gap.db', {
      models: [TaskV3, Tag],
      schemaVersion: 3,
      migrations: [migration2to3],
      events,
    });
    await expect(db.initialize()).rejects.toThrow('Missing migrations between schema versions 1 and 3: 1 → 2');
    expect(events).toEqual([]);
    expect(await adapter.getSchemaVersion()).toBe(1);
    await adapter.close();
  });

  it('refuses to open a database newer than the schema', async () => {
    const { db } = sqliteDb('downgrade.db', { models: [TaskV3, Tag], schemaVersion: 3 });
    await db.initialize();
    await db.close();

    const { db: older, adapter } = sqliteDb('downgrade.db', { models: [TaskV3], schemaVersion: 2 });
    await expect(older.initialize()).rejects.toThrow(/version 3 is newer than the app's schema version 2/);
    await adapter.close();
  });

  it('gives legacy addColumn steps type-appropriate defaults', async () => {
    const { db, adapter, driver } = sqliteDb('legacy.db', { models: [TaskV1], schemaVersion: 1 });
    await db.initialize();
    await db.write(async () => {
      await db.get(TaskV1).create({ title: 'before' });
    });

    await adapter.migrate([
      {
        fromVersion: 1,
        toVersion: 2,
        steps: [
          { type: 'addColumn', table: 'tasks', column: 'score', columnType: 'INTEGER' },
          { type: 'addColumn', table: 'tasks', column: 'label', columnType: 'TEXT' },
          { type: 'addColumn', table: 'tasks', column: 'extra', columnType: 'TEXT', isOptional: true },
        ],
      },
    ]);

    const row = driver.raw().prepare('SELECT score, label, extra FROM tasks').get() as Record<string, unknown>;
    expect(row).toEqual({ score: 0, label: '', extra: null });
    const columns = driver.raw().prepare('PRAGMA table_info("tasks")').all() as Array<Record<string, unknown>>;
    const byName = Object.fromEntries(columns.map((c) => [c.name as string, c]));
    expect(byName.score).toMatchObject({ notnull: 1, dflt_value: '0' });
    expect(byName.label).toMatchObject({ notnull: 1, dflt_value: "''" });
    expect(byName.extra).toMatchObject({ notnull: 0, dflt_value: 'NULL' });
    await db.close();
  });
});

// ─── Loki ───────────────────────────────────────────────────────────────

describe('Database.initialize() migrations on Loki', () => {
  it('migrates a persisted instance and fills new columns with defaults', async () => {
    const { default: Loki } = await import('lokijs');
    const instance = new Loki('persisted-migrations');

    const v1 = new Database({
      adapter: new LokiAdapter({ databaseName: 'p', lokiInstance: instance }),
      models: [TaskV1],
      schemaVersion: 1,
    });
    await v1.initialize();
    await v1.write(async () => {
      await v1.get(TaskV1).create({ title: 'Old task' });
    });

    const events: string[] = [];
    const v3 = new Database({
      adapter: new LokiAdapter({ databaseName: 'p', lokiInstance: instance }),
      models: [TaskV3, Tag],
      schemaVersion: 3,
      migrations: [migration1to2, migration2to3],
      migrationEvents: {
        onStart: (from, to) => events.push(`start ${from}->${to}`),
        onSuccess: (from, to) => events.push(`success ${from}->${to}`),
      },
    });
    await v3.initialize();

    expect(events).toEqual(['start 1->3', 'success 1->3']);
    expect(await v3._adapter.getSchemaVersion()).toBe(3);

    const [task] = await v3.get(TaskV3).fetch(v3.get(TaskV3).query());
    expect(task.getField('title')).toBe('Old task');
    expect(task.getField('priority')).toBe(0);
    expect(task.getField('done')).toBe(false);
    expect(task.getField('notes')).toBeNull();
    expect(task.getField('category')).toBe('');

    await v3.write(async () => {
      await v3.get(Tag).create({ name: 'urgent', color: 'red' });
    });
    expect(await v3.get(Tag).count()).toBe(1);

    // Re-opening at the same version is a no-op.
    const again = new Database({
      adapter: new LokiAdapter({ databaseName: 'p', lokiInstance: instance }),
      models: [TaskV3, Tag],
      schemaVersion: 3,
      migrations: [migration1to2, migration2to3],
      migrationEvents: { onStart: () => events.push('unexpected') },
    });
    await again.initialize();
    expect(events).toHaveLength(2);
    await again.close();
  });

  it('refuses a persisted instance with a gap in the chain', async () => {
    const { default: Loki } = await import('lokijs');
    const instance = new Loki('gap');
    const v1 = new Database({
      adapter: new LokiAdapter({ databaseName: 'g', lokiInstance: instance }),
      models: [TaskV1],
      schemaVersion: 1,
    });
    await v1.initialize();

    const v3 = new Database({
      adapter: new LokiAdapter({ databaseName: 'g', lokiInstance: instance }),
      models: [TaskV3, Tag],
      schemaVersion: 3,
      migrations: [migration1to2],
    });
    await expect(v3.initialize()).rejects.toThrow(/Missing migrations between schema versions 1 and 3: 2 → 3/);
    await v3.close();
  });
});

// ─── Re-entrant write() ─────────────────────────────────────────────────

describe('Database.write() re-entrancy', () => {
  async function exercise(db: Database) {
    const ids = await db.write(async () => {
      const outer = await db.get(TaskV3).create({ title: 'outer', priority: 1, done: false, category: 'a' });
      // A helper that wraps its own mutations in write(), called from a writer.
      const inner = await db.write(async () => {
        return db.get(TaskV3).create({ title: 'inner', priority: 2, done: true, category: 'b' });
      });
      return [outer.id, inner.id];
    });
    expect(ids).toHaveLength(2);
    expect(await db.get(TaskV3).count()).toBe(2);
    expect(await db.get(TaskV3).findById(ids[1])).not.toBeNull();
  }

  it('runs a nested write inline on Loki', async () => {
    const db = new Database({ adapter: new LokiAdapter({ databaseName: 'reentrant' }), models: [TaskV3] });
    await db.initialize();
    await exercise(db);
    await db.close();
  });

  it('runs a nested write inline on SQLite, inside the outer transaction', async () => {
    const { db, driver } = sqliteDb('reentrant.db', { models: [TaskV3], schemaVersion: 1 });
    await db.initialize();
    await exercise(db);
    const begins = driver.statements.filter((s) => s === 'BEGIN IMMEDIATE').length;
    const commits = driver.statements.filter((s) => s === 'COMMIT').length;
    expect(begins).toBe(1);
    expect(commits).toBe(1);
    await db.close();
  });

  it('still serialises writes issued in the same tick', async () => {
    const db = new Database({ adapter: new LokiAdapter({ databaseName: 'serial' }), models: [TaskV3] });
    await db.initialize();
    const order: string[] = [];
    await Promise.all([
      db.write(async () => {
        order.push('a1');
        await db.get(TaskV3).create({ title: 'a', priority: 0, done: false, category: '' });
        order.push('a2');
      }),
      db.write(async () => {
        order.push('b1');
        await db.get(TaskV3).create({ title: 'b', priority: 0, done: false, category: '' });
        order.push('b2');
      }),
    ]);
    expect(order).toEqual(['a1', 'a2', 'b1', 'b2']);
    await db.close();
  });
});
