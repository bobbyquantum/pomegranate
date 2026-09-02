/**
 * Column-aware live queries (WatermelonDB `observe` / `observeWithColumns`).
 *
 * - `updated` events carry the changed columns; irrelevant updates are ignored
 * - the query re-runs when a changed column is referenced or the record is in
 *   the current result set
 * - emissions happen only when the id list (or a watched column) changes
 * - synthetic notifications without column info always re-run
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';

const TaskSchema = m.model('tasks', {
  title: m.text(),
  done: m.boolean().default(false),
  priority: m.number().default(0),
  notes: m.text().optional(),
});

class Task extends Model<typeof TaskSchema> {
  static schema = TaskSchema;
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('column-aware live queries', () => {
  let db: Database;
  let open: Task;
  let finished: Task;
  let findSpy: jest.SpyInstance;
  let countSpy: jest.SpyInstance;

  beforeEach(async () => {
    db = new Database({
      adapter: new LokiAdapter({ databaseName: `live-query-${Math.random()}` }),
      models: [Task],
    });
    await db.initialize();
    await db.write(async () => {
      open = await db.get(Task).create({ title: 'Open', done: false, priority: 1 });
      finished = await db.get(Task).create({ title: 'Finished', done: true, priority: 2 });
    });
    findSpy = jest.spyOn(db._adapter, 'find');
    countSpy = jest.spyOn(db._adapter, 'count');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await db.close();
  });

  function observeDone(options?: { columns?: string[] }) {
    const emissions: Task[][] = [];
    const query = db.get(Task).query((q) => q.where('done', true).orderBy('priority'));
    const unsub = db
      .get(Task)
      .observeQuery(query, options)
      .subscribe((records) => emissions.push(records));
    return { emissions, unsub };
  }

  it('carries changed column names on updated events', async () => {
    const events: Array<readonly string[] | undefined> = [];
    const unsub = db.get(Task).changes$.subscribe((change) => events.push(change.columns));
    events.length = 0; // drop the Subject's replay of the last (created) event

    await db.write(async () => {
      await open.update({ title: 'Renamed', notes: 'x' });
      await open.markAsDeleted();
    });

    expect(events).toEqual([['title', 'notes'], undefined]);
    unsub();
  });

  it('emits once on subscribe and runs the query exactly once', async () => {
    const { emissions, unsub } = observeDone();
    await tick();
    expect(emissions).toHaveLength(1);
    expect(emissions[0].map((t) => t.id)).toEqual([finished.id]);
    expect(findSpy).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('ignores updates to unreferenced columns on records outside the result set', async () => {
    const { emissions, unsub } = observeDone();
    await tick();
    findSpy.mockClear();

    await db.write(async () => {
      await open.update({ title: 'Still open', notes: 'irrelevant' });
    });
    await tick();

    expect(findSpy).not.toHaveBeenCalled();
    expect(emissions).toHaveLength(1);
    unsub();
  });

  it('re-runs when a changed column is referenced by a where clause', async () => {
    const { emissions, unsub } = observeDone();
    await tick();
    findSpy.mockClear();

    await db.write(async () => {
      await open.update({ done: true });
    });
    await tick();

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(emissions).toHaveLength(2);
    expect(emissions[1].map((t) => t.id)).toEqual([open.id, finished.id]);
    unsub();
  });

  it('re-runs when a changed column is referenced by orderBy, without emitting if ids are unchanged', async () => {
    const { emissions, unsub } = observeDone();
    await tick();
    findSpy.mockClear();

    await db.write(async () => {
      await open.update({ priority: 99 }); // not in the result set, but orderBy references priority
    });
    await tick();

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(emissions).toHaveLength(1);
    unsub();
  });

  it('re-runs for a record in the result set but does not emit without an id change', async () => {
    const { emissions, unsub } = observeDone();
    await tick();
    findSpy.mockClear();

    await db.write(async () => {
      await finished.update({ title: 'Finished (edited)' });
    });
    await tick();

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(emissions).toHaveLength(1);
    unsub();
  });

  it('emits when a watched column changes on a record in the result set', async () => {
    const { emissions, unsub } = observeDone({ columns: ['title'] });
    await tick();

    await db.write(async () => {
      await finished.update({ title: 'Finished (edited)' });
    });
    await tick();
    expect(emissions).toHaveLength(2);
    expect(emissions[1][0].getField('title')).toBe('Finished (edited)');

    // An unwatched column on the same record: re-run but no emission
    await db.write(async () => {
      await finished.update({ notes: 'meh' });
    });
    await tick();
    expect(emissions).toHaveLength(2);
    unsub();
  });

  it('observeQueryWithColumns is an alias for observeQuery with columns', async () => {
    const emissions: Task[][] = [];
    const unsub = db
      .get(Task)
      .observeQueryWithColumns(db.get(Task).query((q) => q.where('done', true)), ['notes'])
      .subscribe((records) => emissions.push(records));
    await tick();

    await db.write(async () => {
      await finished.update({ notes: 'watched' });
    });
    await tick();

    expect(emissions).toHaveLength(2);
    unsub();
  });

  it('emits on id-set changes from created and deleted events', async () => {
    const { emissions, unsub } = observeDone();
    await tick();

    const created = await db.write(async () => db.get(Task).create({ title: 'New', done: true }));
    await tick();
    expect(emissions).toHaveLength(2);
    expect(emissions[1]).toHaveLength(2);

    await db.write(async () => {
      await created.markAsDeleted();
    });
    await tick();
    expect(emissions).toHaveLength(3);
    expect(emissions[2].map((t) => t.id)).toEqual([finished.id]);
    unsub();
  });

  it('emits when the order of ids changes', async () => {
    await db.write(async () => {
      await open.update({ done: true });
    });
    const { emissions, unsub } = observeDone();
    await tick();
    expect(emissions[0].map((t) => t.id)).toEqual([open.id, finished.id]);

    await db.write(async () => {
      await open.update({ priority: 10 });
    });
    await tick();

    expect(emissions).toHaveLength(2);
    expect(emissions[1].map((t) => t.id)).toEqual([finished.id, open.id]);
    unsub();
  });

  it('re-runs on synthetic notifications without column info (Database.batch)', async () => {
    const { emissions, unsub } = observeDone({ columns: ['title'] });
    await tick();
    findSpy.mockClear();

    await db.write(async () => {
      await db.batch([
        {
          type: 'update',
          table: 'tasks',
          rawRecord: { ...finished._rawRecord, title: 'Batched' },
        },
      ]);
    });
    await tick();

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(emissions).toHaveLength(2);
    expect(emissions[1][0].getField('title')).toBe('Batched');
    unsub();
  });

  it('re-runs on _notifyChange updates without columns, and filters those with columns', async () => {
    const { unsub } = observeDone();
    await tick();
    findSpy.mockClear();

    db.get(Task)._notifyChange('updated', open);
    await tick();
    expect(findSpy).toHaveBeenCalledTimes(1);

    db.get(Task)._notifyChange('updated', open, ['title']);
    await tick();
    expect(findSpy).toHaveBeenCalledTimes(1);

    db.get(Task)._notifyChange('updated', open, ['done']);
    await tick();
    expect(findSpy).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('keeps cached records fresh even when nothing is emitted', async () => {
    const { emissions, unsub } = observeDone();
    await tick();

    await db.write(async () => {
      await db.batch([
        {
          type: 'update',
          table: 'tasks',
          rawRecord: { ...finished._rawRecord, title: 'Batched' },
        },
      ]);
    });
    await tick();

    expect(emissions).toHaveLength(1);
    expect(finished.getField('title')).toBe('Batched');
    unsub();
  });

  describe('observeCount', () => {
    function observeDoneCount() {
      const counts: number[] = [];
      const unsub = db
        .get(Task)
        .observeCount(db.get(Task).query((q) => q.where('done', true)))
        .subscribe((c) => counts.push(c));
      return { counts, unsub };
    }

    it('emits only when the count changes', async () => {
      const { counts, unsub } = observeDoneCount();
      await tick();
      expect(counts).toEqual([1]);

      await db.write(async () => {
        await open.update({ done: true });
      });
      await tick();
      expect(counts).toEqual([1, 2]);

      // Referenced column changes but the count does not
      await db.write(async () => {
        await open.update({ done: true });
      });
      await tick();
      expect(counts).toEqual([1, 2]);
      unsub();
    });

    it('skips re-counting for updates to unreferenced columns', async () => {
      const { counts, unsub } = observeDoneCount();
      await tick();
      countSpy.mockClear();

      await db.write(async () => {
        await finished.update({ title: 'Renamed', priority: 5 });
      });
      await tick();

      expect(countSpy).not.toHaveBeenCalled();
      expect(counts).toEqual([1]);
      unsub();
    });

    it('re-counts on created, deleted and synthetic notifications', async () => {
      const { counts, unsub } = observeDoneCount();
      await tick();

      const created = await db.write(async () =>
        db.get(Task).create({ title: 'New', done: true }),
      );
      await tick();
      expect(counts).toEqual([1, 2]);

      await db.write(async () => {
        await db.batch([{ type: 'destroyPermanently', table: 'tasks', id: created.id }]);
      });
      await tick();
      expect(counts).toEqual([1, 2, 1]);
      unsub();
    });
  });
});
