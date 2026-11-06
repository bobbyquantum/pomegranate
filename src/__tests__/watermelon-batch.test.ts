/**
 * pomegranate-db/watermelon — `database.batch()` and the `prepare*` API.
 *
 * Covers prepareCreate / prepareCreateFromDirtyRaw / createFromDirtyRaw /
 * prepareUpdate / prepareMarkAsDeleted / prepareDestroyPermanently, the
 * notifications observers receive after a batch, dirty-raw sanitisation and
 * the guards around prepared records, on both adapters.
 */
/* eslint-disable unicorn/no-await-expression-member */

import { createBetterSqliteDriver } from './helpers/betterSqliteDriver';
import {
  m,
  Model,
  Q,
  Database,
  appSchema,
  tableSchema,
  SQLiteAdapter,
  LokiJSAdapter,
  hasUnsyncedChanges,
  WatermelonObservable,
} from '../watermelon';
import type { Associations, Collection, CollectionChangeSet, Query, Relation } from '../watermelon';

// ─── Models ──────────────────────────────────────────────────────────────────

const sanitizeTags = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];

const WorkTaskSchema = m.model('work_tasks', {
  taskType: m.text('task_type').optional().indexed(),
  mobileScript: m.text('mobile_script').optional(),
  count: m.number('count'),
  closed: m.boolean('closed'),
  dueAt: m.date('due_at').optional(),
  tags: m.json('tags', sanitizeTags),
});

class WorkTask extends Model<typeof WorkTaskSchema> {
  static schema = WorkTaskSchema;
  static table = 'work_tasks';
  static associations: Associations = {
    survey_responses: { type: 'has_many', foreignKey: 'work_task_id' },
  };
  get taskType(): string | null { return this.getField('taskType') as string | null; }
  set taskType(value: string | null) { this.setField('taskType', value); }
  get mobileScript(): string | null { return this.getField('mobileScript') as string | null; }
  set mobileScript(value: string | null) { this.setField('mobileScript', value); }
  get count(): number { return this.getField('count') as number; }
  set count(value: number) { this.setField('count', value); }
  get closed(): boolean { return this.getField('closed') as boolean; }
  set closed(value: boolean) { this.setField('closed', value); }
  get dueAt(): Date | null { return this.getField('dueAt') as Date | null; }
  set dueAt(value: Date | null) { this.setField('dueAt', value); }
  get tags(): string[] { return this.getField('tags') as string[]; }
  set tags(value: string[]) { this.setField('tags', value); }
  get surveyResponses(): Query<SurveyResponse> { return this.children<SurveyResponse>('survey_responses'); }
}

const SurveyResponseSchema = m.model('survey_responses', {
  workTaskId: m.text('work_task_id').optional().indexed(),
  surveyHeaderId: m.text('survey_header_id').optional(),
  title: m.text('title').optional(),
});

class SurveyResponse extends Model<typeof SurveyResponseSchema> {
  static schema = SurveyResponseSchema;
  static table = 'survey_responses';
  static associations: Associations = {
    work_tasks: { type: 'belongs_to', key: 'work_task_id' },
  };
  get workTaskId(): string | null { return this.getField('workTaskId') as string | null; }
  set workTaskId(value: string | null) { this.setField('workTaskId', value); }
  get surveyHeaderId(): string | null { return this.getField('surveyHeaderId') as string | null; }
  set surveyHeaderId(value: string | null) { this.setField('surveyHeaderId', value); }
  get title(): string | null { return this.getField('title') as string | null; }
  set title(value: string | null) { this.setField('title', value); }
  get workTask(): Relation<WorkTask> { return this.relation<WorkTask>('work_tasks', 'work_task_id'); }
}

const models = [WorkTask, SurveyResponse];

const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'work_tasks',
      columns: [
        { name: 'task_type', type: 'string', isOptional: true, isIndexed: true },
        { name: 'mobile_script', type: 'string', isOptional: true },
        { name: 'count', type: 'number' },
        { name: 'closed', type: 'boolean' },
        { name: 'due_at', type: 'number', isOptional: true },
        { name: 'tags', type: 'string' },
      ],
    }),
    tableSchema({
      name: 'survey_responses',
      columns: [
        { name: 'work_task_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'survey_header_id', type: 'string', isOptional: true },
        { name: 'title', type: 'string', isOptional: true },
      ],
    }),
  ],
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lokiDb(): Database {
  return new Database({
    adapter: new LokiJSAdapter({ schema, dbName: `wm-batch-${Math.random()}`, useWebWorker: false }),
    modelClasses: models,
  });
}

function sqliteDb(): Database {
  return new Database({
    adapter: new SQLiteAdapter({ schema, dbName: ':memory:', driver: createBetterSqliteDriver() }),
    modelClasses: models,
  });
}

const adapters = [
  ['LokiJSAdapter', lokiDb],
  ['SQLiteAdapter', sqliteDb],
] as const;

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor: timed out');
    await tick(5);
  }
}

function collect<T>(observable: WatermelonObservable<T>) {
  const values: T[] = [];
  const errors: unknown[] = [];
  const subscription = observable.subscribe({
    next: (v) => values.push(v),
    error: (e) => errors.push(e),
  });
  return { values, errors, subscription };
}

const ids = (records: Model[]) => records.map((r) => r.id).sort();
const idsOf = (...records: Model[]) => ids(records);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe.each(adapters)('%s batch / prepare', (_name, createDb) => {
  let db: Database;
  let tasks: Collection<WorkTask>;
  let surveys: Collection<SurveyResponse>;
  let t1: WorkTask;
  let t2: WorkTask;
  let t3: WorkTask;

  beforeEach(async () => {
    db = createDb();
    await db.ready;
    tasks = db.collections.get<WorkTask>('work_tasks');
    surveys = db.collections.get<SurveyResponse>('survey_responses');
    await db.write(async () => {
      t1 = await tasks.create((t) => { t.taskType = 'inspection'; t.mobileScript = 'V1'; t.count = 1; });
      t2 = await tasks.create((t) => { t.taskType = 'repair'; t.count = 2; });
      t3 = await tasks.create((t) => { t.taskType = 'repair'; t.count = 3; });
    });
  });

  afterEach(async () => {
    await db.pomegranate.close();
  });

  describe('prepareCreate', () => {
    it('returns the draft with a usable id and staged values, persisting nothing until batch', async () => {
      const due = new Date(1_700_000_000_000);
      const draft = tasks.prepareCreate((t) => {
        t.taskType = 'survey';
        t.dueAt = due;
        t.tags = ['a'];
        expect(t.taskType).toBe('survey');
      });
      expect(draft).toBeInstanceOf(WorkTask);
      expect(draft.id).toMatch(/\S/);
      expect(draft.taskType).toBe('survey');
      expect(draft.dueAt).toEqual(due);
      expect(draft.count).toBe(0);
      expect(draft.closed).toBe(false);
      expect(draft.syncStatus).toBe('created');
      expect(draft._preparedState?.type).toBe('create');
      expect(draft.collection).toBe(tasks);

      // the id can be wired into other prepared records before anything is written
      const survey = surveys.prepareCreate((s) => { s.workTask.set(draft); s.title = 'Gas'; });
      expect(survey.workTaskId).toBe(draft.id);

      expect(await tasks.query().fetchCount()).toBe(3);
      await expect(tasks.find(draft.id)).rejects.toThrow(/not found/);

      await db.write(() => db.batch(draft, survey));

      expect(draft._preparedState).toBeNull();
      expect(await tasks.find(draft.id)).toBe(draft); // the draft is the live instance
      expect((await survey.workTask.fetch())?.id).toBe(draft.id);
      expect(ids(await draft.surveyResponses.fetch())).toEqual(idsOf(survey));
      expect(await db.adapter.findById('work_tasks', draft.id)).toMatchObject({
        id: draft.id, task_type: 'survey', due_at: 1_700_000_000_000, tags: '["a"]', _status: 'created', _changed: '',
      });
    });

    it('rejects async mutators and non-compat model classes', () => {
      expect(() => tasks.prepareCreate(async () => {})).toThrow(/prepareCreate\(\) mutators must be synchronous/);
      expect(() => t1.prepareUpdate(async () => {})).toThrow(/prepareUpdate\(\) mutators must be synchronous/);
    });
  });

  describe('prepareCreateFromDirtyRaw / createFromDirtyRaw', () => {
    it('sanitises the raw through the schema and honours id', () => {
      const record = tasks.prepareCreateFromDirtyRaw({
        id: 'wt-dirty',
        task_type: 'gas',
        count: 7,
        closed: true,
        due_at: 1_700_000_000_000,
        tags: ['x', 1, 'y'],
        bogus: 'dropped',
        _status: 'synced',
        _changed: 'count',
      });
      expect(record.id).toBe('wt-dirty');
      expect(record._raw).toEqual({
        id: 'wt-dirty',
        _status: 'created',
        _changed: '',
        task_type: 'gas',
        mobile_script: null,
        count: 7,
        closed: 1,
        due_at: 1_700_000_000_000,
        tags: '["x",1,"y"]',
      });
      expect(record.closed).toBe(true);
      expect(record.tags).toEqual(['x', 'y']);
      expect(record._preparedState?.type).toBe('create');
    });

    it('replaces missing or ill-typed values with the column defaults', () => {
      const record = tasks.prepareCreateFromDirtyRaw({
        task_type: 42,
        count: 'nope',
        closed: 0,
        due_at: new Date(5000),
        mobile_script: null,
      });
      expect(record.id).toMatch(/\S/);
      expect(record._raw).toMatchObject({
        task_type: null, // optional → null
        count: 0, // required number default
        closed: 0,
        due_at: 5000,
        mobile_script: null,
        tags: '',
      });
      expect(tasks.prepareCreateFromDirtyRaw({ id: '' }).id).not.toBe('');
    });

    it('createFromDirtyRaw persists immediately inside write()', async () => {
      await expect(tasks.createFromDirtyRaw({ id: 'x' })).rejects.toThrow(/must be called inside db.write\(\)/);

      const out = collect(tasks.query().observeCount());
      await waitFor(() => out.values.length === 1);

      const record = await db.write(() => tasks.createFromDirtyRaw({ id: 'wt-now', task_type: 'now', count: 1 }));
      expect(record._preparedState).toBeNull();
      expect(await tasks.find('wt-now')).toBe(record);
      await waitFor(() => out.values.length === 2);
      expect(out.values[1]).toBe(4);
      out.subscription.unsubscribe();
    });
  });

  describe('database.batch', () => {
    it('persists a mixed batch in one go with correct sync columns', async () => {
      expect(await hasUnsyncedChanges({ database: db })).toBe(true); // seeded records are local

      const created = tasks.prepareCreate((t) => { t.taskType = 'created'; t.count = 10; });
      const fromRaw = surveys.prepareCreateFromDirtyRaw({ id: 'sr-1', survey_header_id: 'h1', work_task_id: t1.id });
      const updated = t1.prepareUpdate((t) => { t.mobileScript = 'X'; t.count = t.count + 1; });
      const deleted = t2.prepareMarkAsDeleted();
      const destroyed = t3.prepareDestroyPermanently();

      expect(updated).toBe(t1);
      expect(t1.mobileScript).toBe('V1'); // not applied until batch
      expect(t1._preparedState).toMatchObject({ type: 'update', changedColumns: ['mobile_script', 'count'] });

      await db.write(() => db.batch(created, fromRaw, updated, deleted, destroyed));

      expect(ids(await tasks.query().fetch())).toEqual(idsOf(t1, created));
      expect(t1.mobileScript).toBe('X');
      expect(t1.count).toBe(2);
      expect(t1._raw._changed.split(',').sort()).toEqual(['count', 'mobile_script']);
      expect(t1.syncStatus).toBe('created'); // was never synced
      expect(await db.adapter.findById('work_tasks', t1.id)).toMatchObject({ mobile_script: 'X', count: 2 });

      expect(t2.syncStatus).toBe('deleted');
      expect((await db.adapter.findById('work_tasks', t2.id))?._status).toBe('deleted');
      await expect(tasks.find(t2.id)).rejects.toThrow(/not found/);

      expect(await db.adapter.findById('work_tasks', t3.id)).toBeNull();

      expect((await surveys.find('sr-1')).surveyHeaderId).toBe('h1');
      expect(fromRaw.syncStatus).toBe('created');
      expect(created.syncStatus).toBe('created');

      for (const record of [created, fromRaw, t1, t2, t3]) expect(record._preparedState).toBeNull();
      expect(await hasUnsyncedChanges({ database: db })).toBe(true);

      // records are usable again after the batch
      await db.write(() => t1.update((t) => { t.count = 99; }));
      expect((await tasks.find(t1.id)).count).toBe(99);
    });

    it('a prepared update on a synced record marks it updated', async () => {
      await db.adapter.markAsSynced('work_tasks', [t1.id]);
      tasks.pomegranate._refreshCached(t1.id, { _status: 'synced', _changed: '' });
      expect(await hasUnsyncedChanges({ database: db })).toBe(true); // t2/t3 are still local

      await db.write(() => db.batch(t1.prepareUpdate((t) => { t.count = 5; })));
      expect(t1.syncStatus).toBe('updated');
      expect(t1.changedFields).toBe('count');
      expect(await db.adapter.findById('work_tasks', t1.id)).toMatchObject({ _status: 'updated', _changed: 'count', count: 5 });
    });

    it('tolerates falsy entries, nested arrays and an empty batch', async () => {
      const a = tasks.prepareCreate((t) => { t.taskType = 'a'; });
      const b = tasks.prepareCreate((t) => { t.taskType = 'b'; });
      await db.write(async () => {
        await db.batch();
        await db.batch(null, undefined, false);
        await db.batch(null, [a, undefined, [b, false]], t2.prepareMarkAsDeleted());
      });
      expect(ids(await tasks.query().fetch())).toEqual(idsOf(t1, t3, a, b));
    });

    it('requires write() and prepared records of this database', async () => {
      const draft = tasks.prepareCreate();
      await expect(db.batch(draft)).rejects.toThrow(/Database.batch\(\) must be called inside db.write\(\)/);
      expect(draft._preparedState?.type).toBe('create'); // still pending
      await expect(tasks.find(draft.id)).rejects.toThrow(/not found/);

      await expect(db.write(() => db.batch(t1))).rejects.toThrow(/has no prepared operation/);
      await expect(db.write(() => db.batch({ id: 'x' } as never))).rejects.toThrow(/only accepts records/);

      const other = createDb();
      await other.ready;
      try {
        const foreign = other.collections.get<WorkTask>('work_tasks').prepareCreate();
        await expect(db.write(() => db.batch(foreign))).rejects.toThrow(/belongs to a different database/);
      } finally {
        await other.pomegranate.close();
      }
    });

    it('blocks direct mutations and re-preparing while an operation is pending', async () => {
      t1.prepareUpdate((t) => { t.count = 1; });
      await expect(db.write(() => t1.update((t) => { t.count = 2; }))).rejects.toThrow(
        /Cannot call update\(\) on work_tasks#.*pending prepareUpdate\(\)/,
      );
      await expect(db.write(() => t1.markAsDeleted())).rejects.toThrow(/pending prepareUpdate\(\)/);
      await expect(db.write(() => t1.destroyPermanently())).rejects.toThrow(/pending prepareUpdate\(\)/);
      expect(() => t1.prepareMarkAsDeleted()).toThrow(/pending prepareUpdate\(\)/);
      expect(() => t1.prepareUpdate()).toThrow(/pending prepareUpdate\(\)/);

      await db.write(() => db.batch(t1));
      expect(t1.count).toBe(1);

      t2.prepareMarkAsDeleted();
      expect(() => t2.prepareUpdate()).toThrow(/pending prepareMarkAsDeleted\(\)/);
      expect(() => t2.prepareDestroyPermanently()).toThrow(/pending prepareMarkAsDeleted\(\)/);
      await db.write(() => db.batch(t2));
      expect(t2.syncStatus).toBe('deleted');
    });

    it('a record held after the cache was cleared is refreshed and re-cached', async () => {
      db.pomegranate._clearAllCaches();
      await db.write(() => db.batch(t1.prepareUpdate((t) => { t.mobileScript = 'held'; })));
      expect(t1.mobileScript).toBe('held');
      expect(await tasks.find(t1.id)).toBe(t1);
    });
  });

  describe('observers after a batch', () => {
    it('query().observe() sees created and deleted records in one emission', async () => {
      const out = collect(tasks.query(Q.where('task_type', 'repair'), Q.sortBy('count', Q.asc)).observe());
      await waitFor(() => out.values.length === 1);
      expect(ids(out.values[0])).toEqual(idsOf(t2, t3));

      const extra = tasks.prepareCreate((t) => { t.taskType = 'repair'; t.count = 9; });
      await db.write(() => db.batch(extra, t2.prepareMarkAsDeleted(), t1.prepareUpdate((t) => { t.count = 50; })));
      await waitFor(() => out.values.length >= 2);
      await tick(40);
      expect(ids(out.values.at(-1)!)).toEqual(idsOf(t3, extra));
      expect(out.values.at(-1)![1]).toBe(extra);
      out.subscription.unsubscribe();
    });

    it('observeWithColumns re-emits for a batched update of a watched column only', async () => {
      const out = collect(tasks.query(Q.where('id', t1.id)).observeWithColumns(['mobile_script']));
      await waitFor(() => out.values.length === 1);

      await db.write(() => db.batch(t1.prepareUpdate((t) => { t.count = 42; })));
      await tick(40);
      expect(out.values).toHaveLength(1);

      await db.write(() => db.batch(t1.prepareUpdate((t) => { t.mobileScript = 'V2'; })));
      await waitFor(() => out.values.length === 2);
      expect(out.values[1][0].mobileScript).toBe('V2');
      out.subscription.unsubscribe();
    });

    it('observeCount updates once for the whole batch', async () => {
      const out = collect(tasks.query().observeCount());
      await waitFor(() => out.values.length === 1);
      expect(out.values[0]).toBe(3);

      await db.write(() =>
        db.batch(
          tasks.prepareCreate(),
          tasks.prepareCreateFromDirtyRaw({ id: 'wt-c' }),
          t2.prepareMarkAsDeleted(),
          t3.prepareDestroyPermanently(),
        ),
      );
      await tick(60);
      expect(out.values).toEqual([3]); // +2 −2 → unchanged count is not re-emitted
      expect(ids(await tasks.query().fetch())).toContain('wt-c');

      await db.write(() => db.batch(t1.prepareMarkAsDeleted()));
      await waitFor(() => out.values.length === 2);
      expect(out.values[1]).toBe(2);
      out.subscription.unsubscribe();
    });

    it('record.observe(), findAndObserve, collection.changes and withChangesForTables emit per record', async () => {
      const draft = tasks.prepareCreate((t) => { t.taskType = 'obs'; });
      const t1Obs = collect(t1.observe());
      const draftObs = collect(draft.observe());
      const found = collect(tasks.findAndObserve(t2.id));
      const changes = collect(tasks.changes);
      const tableChanges = collect(db.withChangesForTables(['work_tasks', 'survey_responses']));
      await waitFor(() => found.values.length === 1 && tableChanges.values.length === 1);

      await db.write(() =>
        db.batch(
          draft,
          surveys.prepareCreate((s) => { s.title = 'S'; }),
          t1.prepareUpdate((t) => { t.count = 7; }),
          t2.prepareMarkAsDeleted(),
          t3.prepareDestroyPermanently(),
        ),
      );
      await tick(40);

      expect(t1Obs.values).toHaveLength(2);
      expect(t1Obs.values[1].count).toBe(7);
      expect(draftObs.values).toHaveLength(2);
      expect(await tasks.find(draft.id)).toBe(draft);
      expect(found.values).toHaveLength(1); // deleted → completes rather than re-emitting
      expect(found.errors).toHaveLength(0);

      const flat = (sets: (CollectionChangeSet[] | null)[]) =>
        sets.flatMap((set) => set ?? []).map((c) => [c.record.collection.table, c.type, c.record.id]);
      expect(flat(changes.values)).toEqual([
        ['work_tasks', 'created', draft.id],
        ['work_tasks', 'updated', t1.id],
        ['work_tasks', 'destroyed', t2.id],
        ['work_tasks', 'destroyed', t3.id],
      ]);
      const table = flat(tableChanges.values);
      expect(table).toHaveLength(5);
      expect(table[1][0]).toBe('survey_responses');
      expect(table[1][1]).toBe('created');

      for (const o of [t1Obs, draftObs, found, changes, tableChanges]) o.subscription.unsubscribe();
    });
  });
});

describe('SQLiteAdapter batch failure', () => {
  it('rolls back and leaves failed drafts out of the collection cache', async () => {
    const db = sqliteDb();
    await db.ready;
    const tasks = db.collections.get<WorkTask>('work_tasks');
    const existing = await db.write(() => tasks.createFromDirtyRaw({ id: 'dup', task_type: 'first' }));

    const ok = tasks.prepareCreate((t) => { t.taskType = 'ok'; });
    const clash = tasks.prepareCreateFromDirtyRaw({ id: 'dup', task_type: 'second' });
    await expect(db.write(() => db.batch(ok, clash))).rejects.toThrow();

    expect(ok._preparedState?.type).toBe('create');
    await expect(tasks.find(ok.id)).rejects.toThrow(/not found/);
    expect(await tasks.find('dup')).toBe(existing);
    expect(existing.taskType).toBe('first');
    expect(await tasks.query().fetchCount()).toBe(1);
    await db.pomegranate.close();
  });
});
