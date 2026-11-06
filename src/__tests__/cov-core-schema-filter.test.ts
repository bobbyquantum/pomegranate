/**
 * Schema filtering of pull payloads (`filterChangesToSchema`) and the JS turbo
 * fallback built on it (`applySyncJsonInJs`, `tableColumnsFromSchema`).
 */

import { filterChangesToSchema } from '../sync/schemaFilter';
import { applySyncJsonInJs, tableColumnsFromSchema } from '../adapters/applySyncJsonFallback';
import type { DatabaseSchema, RawRecord } from '../schema/types';
import type { SyncTableChanges } from '../sync/types';

const schema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'tasks',
      columns: [
        { name: 'title', type: 'text', isOptional: false, isIndexed: false },
        { name: 'done', type: 'boolean', isOptional: false, isIndexed: false },
        { name: 'meta', type: 'json', isOptional: true, isIndexed: false },
      ],
    },
    { name: 'projects', columns: [{ name: 'name', type: 'text', isOptional: false, isIndexed: false }] },
  ],
};

describe('filterChangesToSchema', () => {
  it('returns nothing for a missing changes map', () => {
    expect(filterChangesToSchema(undefined as unknown as SyncTableChanges, schema)).toEqual({
      changes: {},
      skippedTables: 0,
      skippedColumns: 0,
    });
    expect(filterChangesToSchema(null as unknown as SyncTableChanges, schema).changes).toEqual({});
  });

  it('defaults missing created/updated/deleted lists and a null table entry', () => {
    const result = filterChangesToSchema(
      {
        tasks: { created: [{ id: 't1', title: 'a' } as unknown as RawRecord] } as SyncTableChanges[string],
        projects: null as unknown as SyncTableChanges[string],
      },
      schema,
    );
    expect(result.changes).toEqual({
      tasks: { created: [{ id: 't1', title: 'a' }], updated: [], deleted: [] },
      projects: { created: [], updated: [], deleted: [] },
    });
    expect(result.skippedTables).toBe(0);
    expect(result.skippedColumns).toBe(0);
  });

  it('drops unknown tables and columns, strips sync columns, normalises booleans and objects', () => {
    const result = filterChangesToSchema(
      {
        tasks: {
          created: [
            {
              id: 't1',
              title: 'a',
              done: true,
              meta: { tags: ['x'], nested: { deep: 1 } },
              _status: 'created',
              _changed: 'title',
              ghost: 'dropped',
            } as unknown as RawRecord,
          ],
          updated: [{ id: 't2', title: null, done: false, meta: [1, 2], another_ghost: 1 } as unknown as RawRecord],
          deleted: ['t3'],
        },
        unknown: { created: [{ id: 'u1', anything: 1 } as unknown as RawRecord], updated: [], deleted: [] },
      },
      schema,
    );
    expect(result.skippedTables).toBe(1);
    expect(result.skippedColumns).toBe(2);
    expect(result.changes.unknown).toBeUndefined();
    expect(result.changes.tasks).toEqual({
      created: [{ id: 't1', title: 'a', done: 1, meta: JSON.stringify({ tags: ['x'], nested: { deep: 1 } }) }],
      updated: [{ id: 't2', title: null, done: 0, meta: '[1,2]' }],
      deleted: ['t3'],
    });
  });
});

describe('applySyncJsonInJs', () => {
  function capture() {
    const applied: SyncTableChanges[] = [];
    return {
      applied,
      adapter: {
        async applyRemoteChanges(changes: SyncTableChanges) {
          applied.push(changes);
        },
      },
    };
  }

  it('lists table columns the way the native importer expects', () => {
    expect(tableColumnsFromSchema(schema)).toEqual({ tasks: ['title', 'done', 'meta'], projects: ['name'] });
  });

  it('refuses a syncJsonId: only a native driver can read it', async () => {
    const { adapter, applied } = capture();
    await expect(applySyncJsonInJs(adapter, { syncJsonId: 3 }, schema)).rejects.toThrow(/cannot import a syncJsonId/);
    expect(applied).toEqual([]);
  });

  it('applies a payload without changes as an empty import with no timestamp', async () => {
    const { adapter, applied } = capture();
    expect(await applySyncJsonInJs(adapter, { syncJson: '{}' }, schema)).toEqual({
      timestamp: null,
      tables: 0,
      inserted: 0,
      deleted: 0,
      skippedTables: 0,
      skippedColumns: 0,
    });
    expect(applied).toEqual([{}]);
    const nonNumeric = await applySyncJsonInJs(adapter, { syncJson: '{"timestamp":"soon"}' }, schema);
    expect(nonNumeric.timestamp).toBeNull();
  });

  it('counts rows per table after filtering and forwards the filtered changes', async () => {
    const { adapter, applied } = capture();
    const result = await applySyncJsonInJs(
      adapter,
      {
        syncJson: JSON.stringify({
          timestamp: 1234,
          changes: {
            tasks: { created: [{ id: 't1', title: 'a', done: true, extra: 1 }], updated: [{ id: 't2', title: 'b' }], deleted: ['t3', 't4'] },
            projects: { created: [{ id: 'p1', name: 'P' }] },
            nope: { created: [{ id: 'n' }] },
          },
        }),
      },
      schema,
    );
    expect(result).toEqual({ timestamp: 1234, tables: 2, inserted: 3, deleted: 2, skippedTables: 1, skippedColumns: 1 });
    expect(applied[0].tasks.created[0]).toEqual({ id: 't1', title: 'a', done: 1 });
    expect(applied[0].projects).toEqual({ created: [{ id: 'p1', name: 'P' }], updated: [], deleted: [] });
    expect(applied[0].nope).toBeUndefined();
  });
});
