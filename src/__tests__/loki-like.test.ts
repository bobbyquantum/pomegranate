/**
 * Loki executor: SQL LIKE semantics and NOT handling.
 *
 * `like` must behave like SQL LIKE — whole-string match, `%` / `_` wildcards,
 * case-insensitive, regex metacharacters literal, NULL never matches.
 * NOT over and/or groups must be pushed to the leaves (De Morgan) because
 * Loki only supports `$not` on a single field operator.
 */

import { LokiExecutor } from '../adapters/loki/worker/LokiExecutor';
import type { QueryDescriptor, Condition } from '../query/types';
import type { DatabaseSchema, RawRecord } from '../schema/types';

const schema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'items',
      columns: [
        { name: 'title', type: 'text', isOptional: true, isIndexed: false },
        { name: 'done', type: 'boolean', isOptional: false, isIndexed: false },
        { name: 'priority', type: 'number', isOptional: false, isIndexed: false },
      ],
    },
  ],
};

function row(id: string, title: string | null, done = 0, priority = 0): RawRecord {
  return { id, title, done, priority, _status: 'synced', _changed: '' } as RawRecord;
}

function query(conditions: Condition[]): QueryDescriptor {
  return { table: 'items', conditions, orderBy: [{ column: 'id', order: 'asc' }], joins: [] };
}

function like(value: string, operator: 'like' | 'notLike' = 'like'): Condition {
  return { type: 'where', column: 'title', operator, value };
}

describe('LokiExecutor LIKE semantics', () => {
  let executor: LokiExecutor;

  beforeEach(async () => {
    executor = new LokiExecutor({ databaseName: `loki-like-${Math.random()}` });
    await executor.initialize(schema);
    await executor.batch(
      [
        row('alpha', 'Alpha', 1, 1),
        row('xalpha', 'xAlpha', 1, 2),
        row('delta', 'Delta', 0, 1),
        row('deltas', 'Deltas', 0, 2),
        row('dotted', 'a.b', 0, 3),
        row('axb', 'axb', 1, 3),
        row('plus', 'a+b', 0, 4),
        row('nil', null, 1, 4),
      ].map((rawRecord) => ({ type: 'create' as const, table: 'items', rawRecord })),
    );
  });

  afterEach(async () => {
    await executor.close();
  });

  const ids = async (conditions: Condition[]) => {
    const rows = await executor.find(query(conditions));
    return rows.map((r) => r.id);
  };

  it('anchors the pattern to the whole string', async () => {
    expect(await ids([like('Al%')])).toEqual(['alpha']);
    expect(await ids([like('%alpha')])).toEqual(['alpha', 'xalpha']);
    expect(await ids([like('lph')])).toEqual([]);
  });

  it('treats _ as exactly one character and is case-insensitive', async () => {
    expect(await ids([like('delt_')])).toEqual(['delta']);
    expect(await ids([like('DELTA_')])).toEqual(['deltas']);
  });

  it('treats regex metacharacters literally', async () => {
    expect(await ids([like('a.b')])).toEqual(['dotted']);
    expect(await ids([like('a+b')])).toEqual(['plus']);
    expect(await ids([like('a_b')])).toEqual(['axb', 'dotted', 'plus']);
  });

  it('never matches NULL for like, notLike, or NOT like', async () => {
    expect(await ids([like('%')])).not.toContain('nil');
    expect(await ids([like('zzz', 'notLike')])).not.toContain('nil');
    expect(await ids([{ type: 'not', condition: like('zzz') }])).not.toContain('nil');
    expect(await ids([like('zzz', 'notLike')])).toHaveLength(7);
  });

  it('supports notLike and double negation', async () => {
    expect(await ids([like('%alpha', 'notLike')])).toEqual([
      'axb',
      'delta',
      'deltas',
      'dotted',
      'plus',
    ]);
    expect(await ids([{ type: 'not', condition: like('%alpha', 'notLike') }])).toEqual([
      'alpha',
      'xalpha',
    ]);
  });

  it('applies De Morgan for NOT over and/or groups', async () => {
    const doneAndPriority1: Condition = {
      type: 'and',
      conditions: [
        { type: 'where', column: 'done', operator: 'eq', value: 1 },
        { type: 'where', column: 'priority', operator: 'eq', value: 1 },
      ],
    };
    // NOT (done AND priority = 1) → everything except alpha
    expect(await ids([{ type: 'not', condition: doneAndPriority1 }])).toEqual([
      'axb',
      'delta',
      'deltas',
      'dotted',
      'nil',
      'plus',
      'xalpha',
    ]);

    const doneOrPriority1: Condition = { ...doneAndPriority1, type: 'or' };
    // NOT (done OR priority = 1) → not done AND priority != 1
    expect(await ids([{ type: 'not', condition: doneOrPriority1 }])).toEqual([
      'deltas',
      'dotted',
      'plus',
    ]);
  });

  it('counts with the same semantics', async () => {
    await expect(executor.count(query([like('%a%')]))).resolves.toBe(7);
  });
});
