/**
 * pomegranate-db/watermelon — WatermelonDB compatibility layer.
 *
 * Models follow the consumer's generated shape (m.model schema + getters/
 * setters over getField/setField + static associations). Covers schema and
 * migration conversion, every Q operator on both adapters, Q.on joins, live
 * queries, create/update/delete through mutators, children/relations,
 * unsafeResetDatabase, withChangesForTables, synchronize (regular, migration-
 * aware, turbo), hasUnsyncedChanges, SyncLogger and rxjs interop.
 */
/* eslint-disable unicorn/no-await-expression-member */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createBetterSqliteDriver } from './helpers/betterSqliteDriver';
import {
  m,
  Model,
  Q,
  Database,
  appSchema,
  tableSchema,
  schemaMigrations,
  createTable,
  addColumns,
  unsafeExecuteSql,
  toCoreMigrations,
  SQLiteAdapter,
  LokiJSAdapter,
  synchronize,
  hasUnsyncedChanges,
  SyncLogger,
  WatermelonObservable,
} from '../watermelon';
import type {
  Associations,
  Collection,
  Query,
  Relation,
  SyncPullArgs,
  SyncPushArgs,
  CollectionChangeSet,
} from '../watermelon';

// ─── Models (consumer's generated shape) ────────────────────────────────────

export const WorkflowProfileSchema = m.model('workflow_profiles', {
  displayText: m.text('display_text').optional(),
  active: m.boolean('active'),
});

class WorkflowProfile extends Model<typeof WorkflowProfileSchema> {
  static schema = WorkflowProfileSchema;
  static table = 'workflow_profiles';
  static associations: Associations = {
    workflow_profile_allowed_transforms: { type: 'has_many', foreignKey: 'workflow_profile_id' },
    work_tasks: { type: 'has_many', foreignKey: 'workflow_profile_id' },
  };
  get displayText(): string | null { return this.getField('displayText') as string | null; }
  set displayText(value: string | null) { this.setField('displayText', value); }
  get active(): boolean { return this.getField('active') as boolean; }
  set active(value: boolean) { this.setField('active', value); }
  get allowedTransforms(): Query<WorkflowProfileAllowedTransform> {
    return this.children<WorkflowProfileAllowedTransform>('workflow_profile_allowed_transforms');
  }
  get workTasks(): Query<WorkTask> { return this.children<WorkTask>('work_tasks'); }
}

export const WorkflowProfileAllowedTransformSchema = m.model('workflow_profile_allowed_transforms', {
  displayText: m.text('display_text').optional(),
  targetMobileScript: m.text('target_mobile_script').optional(),
  workflowProfileId: m.text('workflow_profile_id').indexed(),
});

class WorkflowProfileAllowedTransform extends Model<typeof WorkflowProfileAllowedTransformSchema> {
  static schema = WorkflowProfileAllowedTransformSchema;
  static table = 'workflow_profile_allowed_transforms';
  static associations: Associations = {
    workflow_profiles: { type: 'belongs_to', key: 'workflow_profile_id' },
  };
  get displayText(): string | null { return this.getField('displayText') as string | null; }
  set displayText(value: string | null) { this.setField('displayText', value); }
  get targetMobileScript(): string | null { return this.getField('targetMobileScript') as string | null; }
  set targetMobileScript(value: string | null) { this.setField('targetMobileScript', value); }
  get workflowProfileId(): string | null { return this.getField('workflowProfileId') as string | null; }
  set workflowProfileId(value: string | null) { this.setField('workflowProfileId', value); }
  get workflowProfile(): Relation<WorkflowProfile> {
    return this.relation<WorkflowProfile>('workflow_profiles', 'workflow_profile_id');
  }
}

const sanitizeTags = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];

export const WorkTaskSchema = m.model('work_tasks', {
  taskType: m.text('task_type').optional().indexed(),
  mobileScript: m.text('mobile_script').optional(),
  count: m.number('count'),
  dueAt: m.date('due_at').optional(),
  tags: m.json('tags', sanitizeTags),
  workflowProfileId: m.text('workflow_profile_id').optional().indexed(),
});

class WorkTask extends Model<typeof WorkTaskSchema> {
  static schema = WorkTaskSchema;
  static table = 'work_tasks';
  static associations: Associations = {
    workflow_profiles: { type: 'belongs_to', key: 'workflow_profile_id' },
    work_task_tickets: { type: 'has_many', foreignKey: 'work_task_id' },
  };
  get taskType(): string | null { return this.getField('taskType') as string | null; }
  set taskType(value: string | null) { this.setField('taskType', value); }
  get mobileScript(): string | null { return this.getField('mobileScript') as string | null; }
  set mobileScript(value: string | null) { this.setField('mobileScript', value); }
  get count(): number { return this.getField('count') as number; }
  set count(value: number) { this.setField('count', value); }
  get dueAt(): Date | null { return this.getField('dueAt') as Date | null; }
  set dueAt(value: Date | null) { this.setField('dueAt', value); }
  get tags(): string[] { return this.getField('tags') as string[]; }
  set tags(value: string[]) { this.setField('tags', value); }
  get workflowProfileId(): string | null { return this.getField('workflowProfileId') as string | null; }
  set workflowProfileId(value: string | null) { this.setField('workflowProfileId', value); }
  get workflowProfile(): Relation<WorkflowProfile> {
    return this.relation<WorkflowProfile>('workflow_profiles', 'workflow_profile_id');
  }
  get workTaskTickets(): Query<WorkTaskTicket> { return this.children<WorkTaskTicket>('work_task_tickets'); }
}

export const WorkTaskTicketSchema = m.model('work_task_tickets', {
  workTaskId: m.text('work_task_id').indexed(),
  closed: m.boolean('closed'),
});

class WorkTaskTicket extends Model<typeof WorkTaskTicketSchema> {
  static schema = WorkTaskTicketSchema;
  static table = 'work_task_tickets';
  static associations: Associations = {
    work_tasks: { type: 'belongs_to', key: 'work_task_id' },
    survey_responses: { type: 'has_many', foreignKey: 'work_task_ticket_id' },
  };
  get workTaskId(): string | null { return this.getField('workTaskId') as string | null; }
  set workTaskId(value: string | null) { this.setField('workTaskId', value); }
  get closed(): boolean { return this.getField('closed') as boolean; }
  set closed(value: boolean) { this.setField('closed', value); }
  get workTask(): Relation<WorkTask> { return this.relation<WorkTask>('work_tasks', 'work_task_id'); }
  get surveyResponses(): Query<SurveyResponse> { return this.children<SurveyResponse>('survey_responses'); }
}

export const SurveyResponseSchema = m.model('survey_responses', {
  workTaskTicketId: m.text('work_task_ticket_id').indexed(),
  closed: m.boolean('closed'),
  title: m.text('title'),
});

class SurveyResponse extends Model<typeof SurveyResponseSchema> {
  static schema = SurveyResponseSchema;
  static table = 'survey_responses';
  static associations: Associations = {
    work_task_tickets: { type: 'belongs_to', key: 'work_task_ticket_id' },
  };
  get workTaskTicketId(): string | null { return this.getField('workTaskTicketId') as string | null; }
  set workTaskTicketId(value: string | null) { this.setField('workTaskTicketId', value); }
  get closed(): boolean { return this.getField('closed') as boolean; }
  set closed(value: boolean) { this.setField('closed', value); }
  get title(): string { return this.getField('title') as string; }
  set title(value: string) { this.setField('title', value); }
  get workTaskTicket(): Relation<WorkTaskTicket> {
    return this.relation<WorkTaskTicket>('work_task_tickets', 'work_task_ticket_id');
  }
}

const models = [WorkflowProfile, WorkflowProfileAllowedTransform, WorkTask, WorkTaskTicket, SurveyResponse];

// ─── WatermelonDB schema & migrations (unchanged shapes) ───────────────────

const workflowProfilesV1 = {
  name: 'workflow_profiles',
  columns: [{ name: 'display_text', type: 'string' as const, isOptional: true }],
};
const allowedTransformsSpec = {
  name: 'workflow_profile_allowed_transforms',
  columns: [
    { name: 'display_text', type: 'string' as const, isOptional: true },
    { name: 'target_mobile_script', type: 'string' as const, isOptional: true },
    { name: 'workflow_profile_id', type: 'string' as const, isIndexed: true },
  ],
};
const workTasksSpec = {
  name: 'work_tasks',
  columns: [
    { name: 'task_type', type: 'string' as const, isOptional: true, isIndexed: true },
    { name: 'mobile_script', type: 'string' as const, isOptional: true },
    { name: 'count', type: 'number' as const },
    { name: 'due_at', type: 'number' as const, isOptional: true },
    { name: 'tags', type: 'string' as const },
    { name: 'workflow_profile_id', type: 'string' as const, isOptional: true, isIndexed: true },
  ],
};
const ticketsSpec = {
  name: 'work_task_tickets',
  columns: [
    { name: 'work_task_id', type: 'string' as const, isIndexed: true },
    { name: 'closed', type: 'boolean' as const },
  ],
};
const surveysSpec = {
  name: 'survey_responses',
  columns: [
    { name: 'work_task_ticket_id', type: 'string' as const, isIndexed: true },
    { name: 'closed', type: 'boolean' as const },
    { name: 'title', type: 'string' as const },
  ],
};

const schemaV1 = appSchema({ version: 1, tables: [tableSchema(workflowProfilesV1)] });

const schemaV3 = appSchema({
  version: 3,
  tables: [
    tableSchema({
      name: 'workflow_profiles',
      columns: [...workflowProfilesV1.columns, { name: 'active', type: 'boolean' }],
    }),
    tableSchema(allowedTransformsSpec),
    tableSchema(workTasksSpec),
    tableSchema(ticketsSpec),
    tableSchema(surveysSpec),
  ],
});

// Deliberately out of order — schemaMigrations() must sort them.
const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 3,
      steps: [createTable(allowedTransformsSpec), createTable(ticketsSpec), createTable(surveysSpec)],
    },
    {
      toVersion: 2,
      steps: [
        addColumns({ table: 'workflow_profiles', columns: [{ name: 'active', type: 'boolean' }] }),
        createTable(workTasksSpec),
      ],
    },
  ],
});

// ─── Helpers ────────────────────────────────────────────────────────────────

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomegranate-watermelon-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function lokiDb(name = `wm-${Math.random()}`): Database {
  return new Database({
    adapter: new LokiJSAdapter({
      schema: schemaV3,
      migrations,
      dbName: name,
      useWebWorker: false,
      useIncrementalIndexedDB: true,
    }),
    modelClasses: models,
  });
}

function sqliteDb(file = ':memory:'): Database {
  return new Database({
    adapter: new SQLiteAdapter({
      schema: schemaV3,
      migrations,
      dbName: file,
      driver: createBetterSqliteDriver(),
    }),
    modelClasses: models,
  });
}

const adapters = [
  ['LokiJSAdapter', () => lokiDb()],
  ['SQLiteAdapter', () => sqliteDb()],
] as const;

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor: timed out');
    await tick(5);
  }
}

/** Subscribe and collect emissions. */
function collect<T>(observable: WatermelonObservable<T>) {
  const values: T[] = [];
  const errors: unknown[] = [];
  let completed = false;
  const subscription = observable.subscribe({
    next: (v) => values.push(v),
    error: (e) => errors.push(e),
    complete: () => { completed = true; },
  });
  return { values, errors, get completed() { return completed; }, subscription };
}

const ids = (records: Model[]) => records.map((r) => r.id).sort();
const idsOf = (...records: Model[]) => ids(records);

interface Fixture {
  p1: WorkflowProfile; p2: WorkflowProfile; p3: WorkflowProfile;
  t1: WorkTask; t2: WorkTask; t3: WorkTask; t4: WorkTask;
  k1: WorkTaskTicket; k2: WorkTaskTicket; k3: WorkTaskTicket;
  s1: SurveyResponse; s2: SurveyResponse;
}

async function seed(db: Database): Promise<Fixture> {
  const profiles = db.collections.get<WorkflowProfile>('workflow_profiles');
  const tasks = db.collections.get<WorkTask>('work_tasks');
  const tickets = db.collections.get<WorkTaskTicket>('work_task_tickets');
  const surveys = db.collections.get<SurveyResponse>('survey_responses');
  const fx = {} as Fixture;
  await db.write(async () => {
    fx.p1 = await profiles.create((p) => { p.displayText = 'Alpha'; p.active = true; });
    fx.p2 = await profiles.create((p) => { p.displayText = 'Beta'; p.active = false; });
    fx.p3 = await profiles.create((p) => { p.displayText = null; p.active = true; });

    fx.t1 = await tasks.create((t) => {
      t.taskType = 'inspection'; t.mobileScript = 'V1'; t.count = 1; t.workflowProfile.set(fx.p1);
    });
    fx.t2 = await tasks.create((t) => {
      t.taskType = 'repair'; t.mobileScript = 'V2'; t.count = 5; t.workflowProfile.set(fx.p1);
    });
    fx.t3 = await tasks.create((t) => {
      t.taskType = 'repair'; t.count = 10; t.workflowProfile.set(fx.p2);
    });
    fx.t4 = await tasks.create((t) => { t.taskType = null; t.count = 3; });

    fx.k1 = await tickets.create((k) => { k.workTask.set(fx.t1); k.closed = true; });
    fx.k2 = await tickets.create((k) => { k.workTask.set(fx.t1); k.closed = false; });
    fx.k3 = await tickets.create((k) => { k.workTask.set(fx.t3); k.closed = false; });

    fx.s1 = await surveys.create((s) => { s.workTaskTicket.set(fx.k2); s.closed = true; s.title = 'Gas safety'; });
    fx.s2 = await surveys.create((s) => { s.workTaskTicket.set(fx.k3); s.closed = false; s.title = 'Electrical'; });
  });
  return fx;
}

// ═══════════════════════════════════════════════════════════════════════════
// Schema & migrations
// ═══════════════════════════════════════════════════════════════════════════

describe('appSchema / tableSchema', () => {
  it('returns WatermelonDB shapes keyed by name', () => {
    expect(schemaV3.version).toBe(3);
    expect(Object.keys(schemaV3.tables)).toEqual([
      'workflow_profiles',
      'workflow_profile_allowed_transforms',
      'work_tasks',
      'work_task_tickets',
      'survey_responses',
    ]);
    const table = schemaV3.tables.work_tasks;
    expect(table.name).toBe('work_tasks');
    expect(table.columns.task_type).toEqual({ name: 'task_type', type: 'string', isOptional: true, isIndexed: true });
    expect(table.columnArray).toHaveLength(6);
  });

  it('rejects reserved and invalid columns', () => {
    expect(() => tableSchema({ name: 't', columns: [{ name: 'id', type: 'string' }] })).toThrow(/reserved/);
    expect(() => tableSchema({ name: 't', columns: [{ name: '_status', type: 'string' }] })).toThrow(/reserved/);
    expect(() => tableSchema({ name: 't', columns: [{ name: 'x', type: 'date' as any }] })).toThrow(/invalid type/);
    expect(() => tableSchema({ name: 't', columns: [{ name: 'x', type: 'string' }, { name: 'x', type: 'string' }] }))
      .toThrow(/Duplicate column/);
    expect(() => appSchema({ version: 0, tables: [] })).toThrow(/positive integer/);
  });
});

describe('schemaMigrations conversion', () => {
  it('sorts migrations and converts steps to core migrations', () => {
    expect(migrations.validated).toBe(true);
    expect(migrations.minVersion).toBe(1);
    expect(migrations.maxVersion).toBe(3);
    expect(migrations.sortedMigrations.map((mg) => mg.toVersion)).toEqual([2, 3]);

    const core = toCoreMigrations(migrations);
    expect(core.map((mg) => [mg.fromVersion, mg.toVersion])).toEqual([[1, 2], [2, 3]]);
    expect(core[0].steps[0]).toEqual({
      type: 'addColumns',
      table: 'workflow_profiles',
      columns: [{ name: 'active', type: 'boolean', isOptional: false, isIndexed: false }],
    });
    expect(core[0].steps[1]).toMatchObject({ type: 'createTable', schema: { name: 'work_tasks' } });
    const created = core[0].steps[1] as { schema: { columns: { name: string; type: string }[] } };
    expect(created.schema.columns.find((c) => c.name === 'task_type')).toEqual({
      name: 'task_type', type: 'text', isOptional: true, isIndexed: true,
    });
    expect(core[1].steps).toHaveLength(3);
  });

  it('converts unsafeExecuteSql to a sql step', () => {
    const [core] = toCoreMigrations([{ toVersion: 2, steps: [unsafeExecuteSql('CREATE INDEX i ON t(c)')] }]);
    expect(core.steps).toEqual([{ type: 'sql', query: 'CREATE INDEX i ON t(c)' }]);
  });

  it('validates versions, gaps and duplicates', () => {
    expect(() => schemaMigrations({ migrations: [{ toVersion: 1, steps: [] }] })).toThrow(/≥ 2/);
    expect(() => schemaMigrations({ migrations: [{ toVersion: 2, steps: [] }, { toVersion: 4, steps: [] }] }))
      .toThrow(/Missing migration between schema versions 2 and 4/);
    expect(() => schemaMigrations({ migrations: [{ toVersion: 2, steps: [] }, { toVersion: 2, steps: [] }] }))
      .toThrow(/Duplicate/);
    expect(() => addColumns({ table: 't', columns: [] })).toThrow(/at least one column/);
    expect(toCoreMigrations(undefined)).toEqual([]);
  });

  it('applies a 3-version chain through Database with migration events', async () => {
    const file = path.join(tmpDir, 'chain.db');

    // v1 install with one table and a legacy row
    const WorkflowProfileV1Schema = m.model('workflow_profiles', { displayText: m.text('display_text').optional() });
    class WorkflowProfileV1 extends Model<typeof WorkflowProfileV1Schema> {
      static schema = WorkflowProfileV1Schema;
      get displayText(): string | null { return this.getField('displayText') as string | null; }
      set displayText(value: string | null) { this.setField('displayText', value); }
    }
    const v1 = new Database({
      adapter: new SQLiteAdapter({ schema: schemaV1, dbName: file, driver: createBetterSqliteDriver() }),
      modelClasses: [WorkflowProfileV1],
    });
    await v1.write(async () => {
      await v1.get<WorkflowProfileV1>('workflow_profiles').create((p) => { p.displayText = 'Legacy'; });
    });
    await v1.pomegranate.close();

    // reopen at v3
    const events: string[] = [];
    const v3 = new Database({
      adapter: new SQLiteAdapter({
        schema: schemaV3,
        migrations,
        dbName: file,
        driver: createBetterSqliteDriver(),
        migrationEvents: {
          onStart: () => events.push('start'),
          onSuccess: () => events.push('success'),
          onError: (error) => events.push(`error: ${String(error)}`),
        },
      }),
      modelClasses: models,
    });
    await v3.ready;
    expect(events).toEqual(['start', 'success']);
    expect(await v3.adapter.getSchemaVersion()).toBe(3);

    const [legacy] = await v3.get<WorkflowProfile>('workflow_profiles').query().fetch();
    expect(legacy.displayText).toBe('Legacy');
    expect(legacy.active).toBe(false); // added column at its default

    // tables created by the migrations are usable, including for Q.on
    await v3.write(async () => {
      await v3.get<WorkTask>('work_tasks').create((t) => { t.taskType = 'x'; t.workflowProfile.set(legacy); });
    });
    const joined = await v3.get<WorkTask>('work_tasks')
      .query(Q.on('workflow_profiles', 'display_text', 'Legacy'))
      .fetch();
    expect(joined).toHaveLength(1);
    await v3.pomegranate.close();
  });

  it('rejects ready (and calls onSetUpError) when the chain is incomplete', async () => {
    const file = path.join(tmpDir, 'broken-chain.db');
    const v1 = new Database({
      adapter: new SQLiteAdapter({ schema: schemaV1, dbName: file, driver: createBetterSqliteDriver() }),
      modelClasses: [WorkflowProfile],
    });
    await v1.ready;
    await v1.pomegranate.close();

    const setUpErrors: unknown[] = [];
    const v3 = new Database({
      adapter: new SQLiteAdapter({
        schema: schemaV3,
        migrations: schemaMigrations({ migrations: [{ toVersion: 3, steps: [] }] }),
        dbName: file,
        driver: createBetterSqliteDriver(),
        onSetUpError: (error) => setUpErrors.push(error),
      }),
      modelClasses: models,
    });
    await expect(v3.ready).rejects.toThrow(/Missing migrations between schema versions 1 and 3/);
    await expect(v3.get('work_tasks').query().fetch()).rejects.toThrow(/Missing migrations/);
    expect(setUpErrors).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Queries, records, observation — on both adapters
// ═══════════════════════════════════════════════════════════════════════════

describe.each(adapters)('%s', (_name, createDb) => {
  let db: Database;
  let fx: Fixture;
  let tasks: Collection<WorkTask>;

  beforeEach(async () => {
    db = createDb();
    fx = await seed(db);
    tasks = db.collections.get<WorkTask>('work_tasks');
  });

  afterEach(async () => {
    await db.pomegranate.close();
  });

  describe('Q operators', () => {
    it('eq, IS NULL, notEq (matches null like WatermelonDB), IS NOT NULL', async () => {
      expect(ids(await tasks.query(Q.where('task_type', 'repair')).fetch())).toEqual(idsOf(fx.t2, fx.t3));
      expect(ids(await tasks.query(Q.where('task_type', Q.eq('repair'))).fetch())).toEqual(idsOf(fx.t2, fx.t3));
      expect(ids(await tasks.query(Q.where('mobile_script', null)).fetch())).toEqual(idsOf(fx.t3, fx.t4));
      expect(ids(await tasks.query(Q.where('mobile_script', Q.notEq(null))).fetch())).toEqual(idsOf(fx.t1, fx.t2));
      expect(ids(await tasks.query(Q.where('task_type', Q.notEq('repair'))).fetch())).toEqual(idsOf(fx.t1, fx.t4));
    });

    it('gt / gte / lt / lte / between', async () => {
      expect(ids(await tasks.query(Q.where('count', Q.gt(3))).fetch())).toEqual(idsOf(fx.t2, fx.t3));
      expect(ids(await tasks.query(Q.where('count', Q.gte(3))).fetch())).toEqual(idsOf(fx.t2, fx.t3, fx.t4));
      expect(ids(await tasks.query(Q.where('count', Q.lt(5))).fetch())).toEqual(idsOf(fx.t1, fx.t4));
      expect(ids(await tasks.query(Q.where('count', Q.lte(5))).fetch())).toEqual(idsOf(fx.t1, fx.t2, fx.t4));
      expect(ids(await tasks.query(Q.where('count', Q.between(3, 5))).fetch())).toEqual(idsOf(fx.t2, fx.t4));
    });

    it('oneOf / notIn (including empty lists)', async () => {
      expect(ids(await tasks.query(Q.where('count', Q.oneOf([1, 10]))).fetch())).toEqual(idsOf(fx.t1, fx.t3));
      expect(ids(await tasks.query(Q.where('count', Q.notIn([1, 10]))).fetch())).toEqual(idsOf(fx.t2, fx.t4));
      expect(await tasks.query(Q.where('id', Q.oneOf([]))).fetch()).toEqual([]);
      expect(await tasks.query(Q.where('id', Q.oneOf([fx.t1.id, fx.t3.id]))).fetchCount()).toBe(2);
    });

    it('like with sanitizeLikeString', async () => {
      expect(Q.sanitizeLikeString('a%b_c d')).toBe('a_b_c_d');
      const term = 'rep';
      expect(ids(await tasks.query(Q.where('task_type', Q.like(`%${Q.sanitizeLikeString(term)}%`))).fetch()))
        .toEqual(idsOf(fx.t2, fx.t3));
      expect(ids(await tasks.query(Q.where('task_type', Q.notLike('%rep%'))).fetch())).toEqual(idsOf(fx.t1));
    });

    it('booleans are matched against their stored 0/1 form', async () => {
      const tickets = db.collections.get<WorkTaskTicket>('work_task_tickets');
      expect(ids(await tickets.query(Q.where('closed', true)).fetch())).toEqual(idsOf(fx.k1));
      expect(ids(await tickets.query(Q.where('closed', false)).fetch())).toEqual(idsOf(fx.k2, fx.k3));
    });

    it('and / or', async () => {
      expect(ids(await tasks.query(
        Q.or(Q.where('task_type', 'inspection'), Q.where('count', Q.gte(10))),
      ).fetch())).toEqual(idsOf(fx.t1, fx.t3));
      expect(ids(await tasks.query(
        Q.and(Q.where('task_type', 'repair'), Q.where('count', Q.lt(10))),
      ).fetch())).toEqual(idsOf(fx.t2));
      expect(ids(await tasks.query(
        Q.or([Q.where('task_type', 'inspection'), Q.where('task_type', null)]),
      ).fetch())).toEqual(idsOf(fx.t1, fx.t4));
    });

    it('sortBy / take / skip / fetchCount / fetchIds / extend', async () => {
      const sorted = await tasks.query(Q.sortBy('count', Q.desc)).fetch();
      expect(sorted.map((t) => t.id)).toEqual([fx.t3.id, fx.t2.id, fx.t4.id, fx.t1.id]);
      const base = tasks.query(Q.sortBy('count', Q.asc));
      expect((await base.extend(Q.take(2)).fetch()).map((t) => t.count)).toEqual([1, 3]);
      expect((await base.extend(Q.skip(1), Q.take(2)).fetch()).map((t) => t.count)).toEqual([3, 5]);
      expect(await base.fetchCount()).toBe(4);
      expect(await tasks.query(Q.where('task_type', 'repair')).fetchCount()).toBe(2);
      expect((await tasks.query(Q.sortBy('count', Q.asc)).fetchIds())[0]).toBe(fx.t1.id);
      expect(base.clauses).toHaveLength(1);
      expect(base.extend(Q.take(1)).clauses).toHaveLength(2);
      expect(base.collection.table).toBe('work_tasks');
    });

    it('experimentalJoinTables / experimentalNestedJoin are no-ops', async () => {
      const q = tasks.query(
        Q.experimentalJoinTables(['workflow_profiles']),
        Q.experimentalNestedJoin('work_task_tickets', 'survey_responses'),
        Q.where('task_type', 'repair'),
      );
      expect(ids(await q.fetch())).toEqual(idsOf(fx.t2, fx.t3));
    });

    it('rejects undefined values', () => {
      expect(() => Q.where('x', undefined as any)).toThrow(/undefined/);
      expect(() => Q.eq(undefined as any)).toThrow(/undefined/);
    });
  });

  describe('Q.on', () => {
    it('belongs_to: column/value, clause, and Q.or clause forms', async () => {
      expect(ids(await tasks.query(Q.on('workflow_profiles', 'active', true)).fetch())).toEqual(idsOf(fx.t1, fx.t2));
      expect(ids(await tasks.query(Q.on('workflow_profiles', Q.where('id', fx.p2.id))).fetch())).toEqual(idsOf(fx.t3));
      expect(ids(await tasks.query(
        Q.on('workflow_profiles', Q.or(Q.where('display_text', 'Alpha'), Q.where('display_text', 'Beta'))),
      ).fetch())).toEqual(idsOf(fx.t1, fx.t2, fx.t3));
      expect(ids(await tasks.query(
        Q.on('workflow_profiles', [Q.where('active', true), Q.where('display_text', 'Alpha')]),
        Q.where('count', Q.gt(1)),
      ).fetch())).toEqual(idsOf(fx.t2));
    });

    it('has_many and nested Q.on', async () => {
      expect(ids(await tasks.query(Q.on('work_task_tickets', 'closed', true)).fetch())).toEqual(idsOf(fx.t1));
      // tasks with a ticket that has a closed survey
      expect(ids(await tasks.query(
        Q.on('work_task_tickets', Q.on('survey_responses', 'closed', true)),
      ).fetch())).toEqual(idsOf(fx.t1));
      // surveys of tickets of task t3
      const surveys = db.collections.get<SurveyResponse>('survey_responses');
      expect(ids(await surveys.query(
        Q.on('work_task_tickets', Q.on('work_tasks', Q.where('id', fx.t3.id))),
      ).fetch())).toEqual(idsOf(fx.s2));
      // count through a join
      expect(await db.get<WorkTaskTicket>('work_task_tickets')
        .query(Q.where('work_task_id', fx.t1.id), Q.on('survey_responses', 'closed', true))
        .fetchCount()).toBe(1);
    });

    it('throws for unknown associations', () => {
      expect(() => tasks.query(Q.on('survey_responses', 'closed', true)).description)
        .toThrow(/Cannot resolve association/);
    });
  });

  describe('live queries', () => {
    it('observe emits current results, then only on membership changes', async () => {
      const out = collect(tasks.query(Q.where('task_type', 'repair'), Q.sortBy('count', Q.asc)).observe());
      await waitFor(() => out.values.length === 1);
      expect(ids(out.values[0])).toEqual(idsOf(fx.t2, fx.t3));

      // update that does not change membership → no emission
      await db.write(() => fx.t2.update((t) => { t.count = 6; }));
      await tick(40);
      expect(out.values).toHaveLength(1);

      // new matching record → emission
      await db.write(async () => {
        await tasks.create((t) => { t.taskType = 'repair'; t.count = 99; });
      });
      await waitFor(() => out.values.length === 2);
      expect(out.values[1]).toHaveLength(3);

      // soft delete → emission
      await db.write(() => fx.t3.markAsDeleted());
      await waitFor(() => out.values.length === 3);
      expect(out.values[2]).toHaveLength(2);

      out.subscription.unsubscribe();
      expect(out.subscription.closed).toBe(true);
    });

    it('observeWithColumns emits on relevant column updates only', async () => {
      const out = collect(tasks.query(Q.where('id', fx.t1.id)).observeWithColumns(['task_type', 'mobile_script']));
      await waitFor(() => out.values.length === 1);

      await db.write(() => fx.t1.update((t) => { t.count = 42; }));
      await tick(40);
      expect(out.values).toHaveLength(1);

      await db.write(() => fx.t1.update((t) => { t.mobileScript = 'V2'; }));
      await waitFor(() => out.values.length === 2);
      expect(out.values[1][0].mobileScript).toBe('V2');
      out.subscription();
    });

    it('observeCount emits the count and updates when it changes', async () => {
      const out = collect(
        db.collections.get<WorkTaskTicket>('work_task_tickets')
          .query(Q.where('work_task_id', fx.t1.id), Q.on('survey_responses', 'closed', true))
          .observeCount(),
      );
      await waitFor(() => out.values.length === 1);
      expect(out.values[0]).toBe(1);

      await db.write(() => fx.s1.update((s) => { s.closed = false; }));
      await waitFor(() => out.values.length === 2);
      expect(out.values[1]).toBe(0);
      out.subscription.unsubscribe();
    });
  });

  describe('collection.find / findAndObserve', () => {
    it('find resolves existing records and rejects missing ones', async () => {
      expect((await tasks.find(fx.t1.id)).id).toBe(fx.t1.id);
      await expect(tasks.find('nope')).rejects.toThrow('Record nope not found in work_tasks');
    });

    it('findAndObserve emits the record and its updates; errors when missing', async () => {
      const out = collect(tasks.findAndObserve(fx.t1.id));
      await waitFor(() => out.values.length === 1);
      expect(out.values[0].id).toBe(fx.t1.id);
      await db.write(() => fx.t1.update((t) => { t.count = 7; }));
      await waitFor(() => out.values.length === 2);
      expect(out.values[1].count).toBe(7);
      out.subscription.unsubscribe();

      const missing = collect(tasks.findAndObserve('missing'));
      await waitFor(() => missing.errors.length === 1);
      expect(String(missing.errors[0])).toMatch(/Record missing not found in work_tasks/);
      expect(missing.subscription.closed).toBe(true);
    });
  });

  describe('records', () => {
    it('create() applies defaults, relation.set, dates and json', async () => {
      const due = new Date(1_700_000_000_000);
      let insideId = '';
      const task = await db.write(() =>
        tasks.create((t) => {
          insideId = t.id;
          t.taskType = 'survey';
          t.dueAt = due;
          t.tags = ['a', 'b'];
          t.workflowProfile.set(fx.p2);
          expect(t.taskType).toBe('survey'); // pending values readable
        }),
      );
      expect(task.id).toBe(insideId);
      expect(task.taskType).toBe('survey');
      expect(task.count).toBe(0);
      expect(task.mobileScript).toBeNull();
      expect(task.dueAt).toEqual(due);
      expect(task.tags).toEqual(['a', 'b']);
      expect(task.workflowProfile.id).toBe(fx.p2.id);
      expect(task.workflowProfileId).toBe(fx.p2.id);
      expect(task.syncStatus).toBe('created');
      expect(task._raw.workflow_profile_id).toBe(fx.p2.id);
      expect(task._raw.due_at).toBe(1_700_000_000_000);
      expect(task.collection.table).toBe('work_tasks');
      expect(task.collection.database).toBe(db);
      expect(task.table).toBe('work_tasks');
      expect((await tasks.find(task.id)).tags).toEqual(['a', 'b']);
    });

    it('create() and update() must run inside write()', async () => {
      await expect(tasks.create()).rejects.toThrow(/must be called inside db.write\(\)/);
      await expect(fx.t1.update((t) => { t.count = 1; })).rejects.toThrow(/must be called inside db.write\(\)/);
    });

    it('setField outside a mutator throws', () => {
      expect(() => { fx.t1.count = 3; }).toThrow('Cannot modify a record outside of update()/create()');
      expect(() => fx.t1.setField('nope', 1)).toThrow(/outside of update/);
    });

    it('update() reads pending values, tracks changes and accepts async mutators', async () => {
      await db.write(() =>
        fx.t1.update(async (t) => {
          t.count = (t.count ?? 0) + 1;
          expect(t.count).toBe(2);
          await tick(1);
          t.mobileScript = `${t.mobileScript}-x`;
          t.workflowProfile.set(null);
        }),
      );
      expect(fx.t1.count).toBe(2);
      expect(fx.t1.mobileScript).toBe('V1-x');
      expect(fx.t1.workflowProfile.id).toBeNull();
      expect(fx.t1.syncStatus).toBe('created'); // a locally created record stays `created`
      expect(fx.t1._raw._changed.split(',').sort()).toEqual(['count', 'mobile_script', 'workflow_profile_id']);
      expect((await tasks.find(fx.t1.id)).count).toBe(2);

      // core-style patch still works
      await db.write(() => fx.t1.update({ count: 9 }));
      expect(fx.t1.count).toBe(9);

      // unknown field
      await expect(db.write(() => fx.t1.update((t) => t.setField('bogus', 1)))).rejects.toThrow(/Unknown field "bogus"/);
    });

    it('markAsDeleted hides the record; destroyPermanently removes it', async () => {
      await db.write(() => fx.t4.markAsDeleted());
      expect(fx.t4.syncStatus).toBe('deleted');
      expect(await tasks.query().fetchCount()).toBe(3);
      await expect(tasks.find(fx.t4.id)).rejects.toThrow(/not found/);

      await db.write(() => fx.t3.destroyPermanently());
      expect(await tasks.query().fetchCount()).toBe(2);
      expect(await db.adapter.findById('work_tasks', fx.t3.id)).toBeNull();
    });

    it('record.observe() is rxjs-shaped and emits the current record then updates', async () => {
      const out = collect(fx.t2.observe());
      expect(out.values).toHaveLength(1);
      expect(out.values[0]).toBe(fx.t2);
      await db.write(() => fx.t2.update((t) => { t.count = 50; }));
      expect(out.values).toHaveLength(2);
      out.subscription.unsubscribe();
    });
  });

  describe('children / relation', () => {
    it('children().fetch() and observe()', async () => {
      expect(ids(await fx.p1.workTasks.fetch())).toEqual(idsOf(fx.t1, fx.t2));
      expect(ids(await fx.t1.workTaskTickets.fetch())).toEqual(idsOf(fx.k1, fx.k2));
      expect(await fx.p3.workTasks.fetchCount()).toBe(0);

      const out = collect(fx.p1.workTasks.observe());
      await waitFor(() => out.values.length === 1);
      await db.write(() => fx.t4.update((t) => t.workflowProfile.set(fx.p1)));
      await waitFor(() => out.values.length === 2);
      expect(ids(out.values[1])).toEqual(idsOf(fx.t1, fx.t2, fx.t4));
      out.subscription.unsubscribe();

      expect(() => fx.t1.children('workflow_profiles')).toThrow(/needs has_many/);
      expect(() => fx.t1.children('survey_responses')).toThrow(/No association/);
    });

    it('relation.id / fetch / observe follow the foreign key', async () => {
      expect(fx.t1.workflowProfile.id).toBe(fx.p1.id);
      expect((await fx.t1.workflowProfile.fetch())!.displayText).toBe('Alpha');
      expect(await fx.t4.workflowProfile.fetch()).toBeNull();
      expect((await fx.k1.workTask.fetch())!.id).toBe(fx.t1.id);

      const out = collect(fx.t1.workflowProfile.observe());
      await waitFor(() => out.values.length === 1);
      expect(out.values[0]!.id).toBe(fx.p1.id);

      await db.write(() => fx.t1.update((t) => t.workflowProfile.set(fx.p2)));
      await waitFor(() => out.values.length === 2);
      expect(out.values[1]!.id).toBe(fx.p2.id);

      // changes to the related record itself also emit
      await db.write(() => fx.p2.update((p) => { p.displayText = 'Beta 2'; }));
      await waitFor(() => out.values.length === 3);
      expect(out.values[2]!.displayText).toBe('Beta 2');

      await db.write(() => fx.t1.update((t) => t.workflowProfile.set(null)));
      await waitFor(() => out.values.length === 4);
      expect(out.values[3]).toBeNull();
      out.subscription.unsubscribe();

      // dangling key
      await db.write(() => fx.t1.update((t) => { t.workflowProfileId = 'ghost'; }));
      await expect(fx.t1.workflowProfile.fetch()).rejects.toThrow(/Record ghost not found/);
      expect(() => fx.t1.relation('workflow_profiles', 'no_such_column')).toThrow(/not declared/);
    });
  });

  describe('database', () => {
    it('unsafeResetDatabase inside write() empties everything and the db stays usable', async () => {
      await db.adapter.setMetadata?.('pomegranate_last_pulled_at', '123');
      await db.write(async () => {
        await db.unsafeResetDatabase();
      });
      expect(await tasks.query().fetchCount()).toBe(0);
      expect(await db.get('workflow_profiles').query().fetchCount()).toBe(0);
      expect(await db.adapter.getMetadata?.('pomegranate_last_pulled_at')).toBeNull();

      const created = await db.write(() => tasks.create((t) => { t.taskType = 'fresh'; }));
      expect(await tasks.query(Q.where('task_type', 'fresh')).fetchCount()).toBe(1);
      expect((await tasks.find(created.id)).taskType).toBe('fresh');
      expect(await db.adapter.getSchemaVersion()).toBe(3);

      await expect(db.unsafeResetDatabase()).rejects.toThrow(/must be called inside db.write\(\)/);
    });

    it('withChangesForTables emits null then change sets; collection.changes too', async () => {
      const out = collect(db.withChangesForTables(['work_tasks', 'survey_responses']));
      const coll = collect(db.collections.get<WorkTask>('work_tasks').changes);
      await waitFor(() => out.values.length === 1);
      expect(out.values[0]).toBeNull();

      const created = await db.write(() => tasks.create((t) => { t.taskType = 'n'; }));
      await db.write(() => fx.s1.update((s) => { s.title = 'x'; }));
      await db.write(() => created.markAsDeleted());
      await db.write(() => fx.p1.update((p) => { p.active = false; })); // other table: ignored
      await waitFor(() => out.values.length === 4);

      const sets = out.values.slice(1) as CollectionChangeSet[][];
      expect(sets.map((s) => [s[0].type, s[0].record.id])).toEqual([
        ['created', created.id],
        ['updated', fx.s1.id],
        ['destroyed', created.id],
      ]);
      expect(coll.values.map((s) => s[0].type)).toEqual(['created', 'destroyed']);
      out.subscription.unsubscribe();
      coll.subscription.unsubscribe();
    });

    it('exposes core handles, schema and read()', async () => {
      expect(db.schema.version).toBe(3);
      expect(db.adapter).toBe(db.compatAdapter.pomegranate);
      expect(db.pomegranate.schemaVersion).toBe(3);
      expect(db.get<WorkTask>('work_tasks')).toBe(db.collections.get('work_tasks'));
      expect(() => db.collections.get('nope')).toThrow(/No collection registered/);
      expect(await db.read(() => tasks.query().fetchCount())).toBe(4);
      expect(await db.write((writer) => writer.callWriter(async () => 7))).toBe(7);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sync
// ═══════════════════════════════════════════════════════════════════════════

describe('synchronize', () => {
  it('runs a regular WatermelonDB pull-first cycle with the expected params, payload and log', async () => {
    const db = lokiDb();
    const tasks = db.collections.get<WorkTask>('work_tasks');
    const local = await db.write(() => tasks.create((t) => { t.taskType = 'local'; t.count = 2; }));
    expect(await hasUnsyncedChanges({ database: db })).toBe(true);

    const pulls: SyncPullArgs[] = [];
    const pushes: SyncPushArgs[] = [];
    const logger = new SyncLogger(10);
    const log = logger.newLog();

    await synchronize({
      database: db,
      log,
      migrationsEnabledAtVersion: 1,
      pullChanges: async (args) => {
        pulls.push(args);
        return {
          changes: {
            workflow_profiles: {
              created: [{ id: 'remote-1', display_text: 'Remote', active: true } as any],
              updated: [],
              deleted: [],
            },
            unknown_table: { created: [{ id: 'x' } as any], updated: [], deleted: [] },
          },
          timestamp: 1000,
        };
      },
      pushChanges: async (args) => {
        pushes.push(args);
      },
    });

    expect(pulls).toEqual([{ lastPulledAt: null, schemaVersion: 3, migration: null }]);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].lastPulledAt).toBe(1000);
    const pushed = pushes[0].changes.work_tasks.created;
    expect(pushed.map((r) => r.id)).toEqual([local.id]);
    // like WatermelonDB, pushed rows are sanitised: _status synced, _changed empty
    expect(pushed[0]._status).toBe('synced');
    expect(pushed[0]._changed).toBe('');
    expect(pushed[0].task_type).toBe('local');

    expect(log.state).toBe('complete');
    expect(log.lastPulledAt).toBeNull();
    expect(log.newLastPulledAt).toBe(1000);
    expect(log.migration).toBeNull();
    expect(log.remoteChangeCount).toBe(1);
    expect(log.localChangeCount).toBe(1);
    expect(log.finishedAt).toBeGreaterThanOrEqual(log.startedAt!);
    expect(logger.logs[0]).toBe(log);

    const remote = await db.get<WorkflowProfile>('workflow_profiles').find('remote-1');
    expect(remote.displayText).toBe('Remote');
    expect(remote.active).toBe(true);
    expect(remote.syncStatus).toBe('synced');
    expect((await tasks.find(local.id)).syncStatus).toBe('synced');
    expect(await hasUnsyncedChanges({ database: db })).toBe(false);

    // second cycle: incremental
    await synchronize({
      database: db,
      migrationsEnabledAtVersion: 1,
      pullChanges: async (args) => {
        pulls.push(args);
        return { changes: {}, timestamp: 2000 };
      },
      pushChanges: async () => { throw new Error('nothing to push'); },
    });
    expect(pulls[1]).toEqual({ lastPulledAt: 1000, schemaVersion: 3, migration: null });
    await db.pomegranate.close();
  });

  it('sends the migration argument after a schema upgrade', async () => {
    const db = lokiDb();
    await db.ready;
    await db.adapter.setMetadata!('pomegranate_last_pulled_at', '500');
    await db.adapter.setMetadata!('pomegranate_last_pulled_schema_version', '1');

    const pulls: SyncPullArgs[] = [];
    const log: Record<string, unknown> = {};
    await synchronize({
      database: db,
      log,
      migrationsEnabledAtVersion: 1,
      pullChanges: async (args) => {
        pulls.push(args);
        return { changes: {}, timestamp: 600 };
      },
      pushChanges: async () => {},
    });
    const expected = {
      from: 1,
      tables: ['work_tasks', 'workflow_profile_allowed_transforms', 'work_task_tickets', 'survey_responses'],
      columns: [{ table: 'workflow_profiles', columns: ['active'] }],
    };
    expect(pulls[0]).toEqual({ lastPulledAt: 500, schemaVersion: 3, migration: expected });
    expect(log.migration).toEqual(expected);
    expect(log.lastPulledSchemaVersion).toBe(3);
    await db.pomegranate.close();
  });

  it('rejects unsupported options and requires a compat database', async () => {
    const db = lokiDb();
    await expect(synchronize({
      database: db,
      pullChanges: async () => ({ changes: {}, timestamp: 1 }),
      pushChanges: async () => {},
      conflictResolver: () => ({}),
    })).rejects.toThrow(/conflictResolver is not supported/);
    await db.pomegranate.close();
  });

  it('turbo: imports { syncJson } text without calling pushChanges', async () => {
    const db = lokiDb();
    const pushChanges = jest.fn(async () => {});
    const log: Record<string, any> = {};
    const syncJson = JSON.stringify({
      changes: {
        workflow_profiles: {
          created: [
            { id: 'p-1', display_text: 'Turbo', active: true },
            { id: 'p-2', display_text: null, active: false, extra: 'dropped' },
          ],
          updated: [],
          deleted: [],
        },
        work_tasks: { created: [{ id: 't-1', task_type: 'imported', count: 3, tags: ['x'] }], updated: [], deleted: [] },
      },
      timestamp: 3000,
    });

    await synchronize({
      database: db,
      log,
      unsafeTurbo: true,
      migrationsEnabledAtVersion: 1,
      pullChanges: async () => ({ syncJson }),
      pushChanges,
    });

    expect(pushChanges).not.toHaveBeenCalled();
    expect(log.state).toBe('complete');
    expect(log.turbo).toMatchObject({ inserted: 3, tables: 2, skippedColumns: 1 });
    expect(log.newLastPulledAt).toBe(3000);
    expect(await db.get<WorkflowProfile>('workflow_profiles').query().fetchCount()).toBe(2);
    const task = await db.get<WorkTask>('work_tasks').find('t-1');
    expect(task.taskType).toBe('imported');
    expect(task.tags).toEqual(['x']);
    expect(task.syncStatus).toBe('synced');
    expect(await db.adapter.getMetadata!('pomegranate_last_pulled_at')).toBe('3000');
    await db.pomegranate.close();
  });

  it('turbo: { syncJsonId } is refused without a native driver', async () => {
    const db = lokiDb();
    const log: Record<string, any> = {};
    await expect(synchronize({
      database: db,
      log,
      unsafeTurbo: true,
      pullChanges: async () => ({ syncJsonId: 42 }),
      pushChanges: async () => {},
    })).rejects.toThrow(/syncJsonId/);
    expect(log.state).toBe('error');
    expect(log.error).toMatch(/syncJsonId/);

    const sqlite = sqliteDb();
    await expect(synchronize({
      database: sqlite,
      unsafeTurbo: true,
      pullChanges: async () => ({ syncJsonId: 42 }),
      pushChanges: async () => {},
    })).rejects.toThrow(/syncJsonId/);
    await db.pomegranate.close();
    await sqlite.pomegranate.close();
  });

  it('turbo: refuses when local changes exist', async () => {
    const db = lokiDb();
    await db.write(() => db.get<WorkTask>('work_tasks').create((t) => { t.taskType = 'dirty'; }));
    await expect(synchronize({
      database: db,
      unsafeTurbo: true,
      pullChanges: async () => ({ syncJson: '{"changes":{},"timestamp":1}' }),
      pushChanges: async () => {},
    })).rejects.toThrow(/unsynced local changes/);
    await db.pomegranate.close();
  });
});

describe('SyncLogger', () => {
  it('keeps the newest `limit` logs, newest first', () => {
    const logger = new SyncLogger(2);
    const a = logger.newLog();
    const b = logger.newLog();
    expect(logger.logs).toEqual([b, a]);
    const c = logger.newLog();
    expect(logger.logs).toEqual([c, b]);
    expect(logger.logs[0]).toBe(c);
    (c as any).phase = 'done';
    expect(logger.formattedLogs).toContain('"phase": "done"');
    expect(new SyncLogger().logs).toEqual([]);
    expect(() => new SyncLogger(0)).toThrow(/positive integer/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Adapters & observables
// ═══════════════════════════════════════════════════════════════════════════

describe('adapters', () => {
  it('LokiJSAdapter warns once about useWebWorker and falls back to memory without indexedDB', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const a = new LokiJSAdapter({ schema: schemaV3, dbName: 'w1', useWebWorker: true, useIncrementalIndexedDB: true });
      const b = new LokiJSAdapter({ schema: schemaV3, dbName: 'w2', useWebWorker: true });
      const webWorkerWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('useWebWorker'));
      expect(webWorkerWarnings.length).toBeLessThanOrEqual(1);
      expect(a.persistent).toBe(false);
      expect(a.schemaVersion).toBe(3);
      expect(a.migrations).toEqual([]);
      expect(b.dbName).toBe('w2');
    } finally {
      warn.mockRestore();
    }
  });

  it('SQLiteAdapter carries schema version, migrations and events; Database validates its adapter', () => {
    const events = { onStart: () => {}, onSuccess: () => {}, onError: () => {} };
    const adapter = new SQLiteAdapter({
      schema: schemaV3, migrations, driver: createBetterSqliteDriver(), migrationEvents: events, jsi: true,
    });
    expect(adapter.dbName).toBe('pomegranate');
    expect(adapter.schemaVersion).toBe(3);
    expect(adapter.migrations.map((mg) => mg.toVersion)).toEqual([2, 3]);
    expect(adapter.migrationEvents).toBe(events);
    expect(() => new SQLiteAdapter({} as any)).toThrow(/schema/);
    expect(() => new Database({ adapter: {} as any, modelClasses: models })).toThrow(/SQLiteAdapter or LokiJSAdapter/);
  });
});

describe('WatermelonObservable', () => {
  it('interoperates with rxjs conventions', async () => {
    const db = lokiDb();
    const query = db.get<WorkTask>('work_tasks').query();
    const observable = query.observe();

    const symbol = (typeof Symbol === 'function' && Symbol.observable) || '@@observable';
    expect((observable as any)[symbol]()).toBe(observable);
    expect((observable as any)['@@observable']()).toBe(observable);

    // observer object, subscription shape
    const values: WorkTask[][] = [];
    const subscription = observable.subscribe({ next: (v) => values.push(v) });
    expect(typeof subscription.unsubscribe).toBe('function');
    expect(subscription.closed).toBe(false);
    await waitFor(() => values.length === 1);
    subscription.unsubscribe();
    expect(subscription.closed).toBe(true);
    subscription.unsubscribe(); // idempotent

    // plain function subscriber and callable subscription (core Unsubscribe)
    const more: number[] = [];
    const unsubscribe = query.observeCount().subscribe((n) => more.push(n));
    await waitFor(() => more.length === 1);
    expect(more).toEqual([0]);
    unsubscribe();
    expect(unsubscribe.closed).toBe(true);

    // errors reach observer.error and close the subscription
    const failing = WatermelonObservable.defer<number>(() => Promise.reject(new Error('boom')));
    const errors: unknown[] = [];
    const sub = failing.subscribe({ error: (e) => errors.push(e) });
    await waitFor(() => errors.length === 1);
    expect(String(errors[0])).toMatch(/boom/);
    expect(sub.closed).toBe(true);

    // subscribing with no observer is allowed
    WatermelonObservable.from({ subscribe: () => () => {} }).subscribe().unsubscribe();
    await db.pomegranate.close();
  });
});
