/**
 * Query introspection helpers (`collectQueryColumns`, `collectExistsTables`)
 * over every condition shape: nested and/or/not groups, exists clauses at any
 * depth, order-by and join columns.
 */

import { collectQueryColumns, collectExistsTables } from '../query/introspect';
import type { Condition, QueryDescriptor } from '../query/types';

function descriptor(over: Partial<QueryDescriptor>): QueryDescriptor {
  return { table: 'tasks', conditions: [], orderBy: [], joins: [], ...over };
}

const where = (column: string): Condition => ({ type: 'where', column, operator: 'eq', value: 1 });

describe('collectQueryColumns', () => {
  it('is empty for a bare query', () => {
    expect(collectQueryColumns(descriptor({}))).toEqual(new Set());
  });

  it('collects where columns through nested and/or/not groups', () => {
    const columns = collectQueryColumns(
      descriptor({
        conditions: [
          where('title'),
          {
            type: 'and',
            conditions: [
              where('done'),
              { type: 'or', conditions: [where('priority'), { type: 'not', condition: where('status') }] },
            ],
          },
          { type: 'not', condition: { type: 'and', conditions: [where('archived')] } },
        ],
      }),
    );
    expect([...columns].sort()).toEqual(['archived', 'done', 'priority', 'status', 'title']);
  });

  it('includes order-by and join columns, and the local column of an exists clause only', () => {
    const columns = collectQueryColumns(
      descriptor({
        conditions: [
          {
            type: 'exists',
            table: 'comments',
            localColumn: 'id',
            foreignColumn: 'task_id',
            conditions: [where('body')], // inner-table column: must not leak out
          },
        ],
        orderBy: [{ column: 'created_at', order: 'desc' }],
        joins: [{ table: 'projects', leftColumn: 'project_id', rightColumn: 'id' }],
      }),
    );
    expect([...columns].sort()).toEqual(['created_at', 'id', 'project_id']);
  });
});

describe('collectExistsTables', () => {
  it('is empty when no exists clause is present', () => {
    expect(collectExistsTables(descriptor({ conditions: [where('title')] }))).toEqual(new Set());
  });

  it('finds exists tables inside and/or/not groups and nested exists clauses', () => {
    const tables = collectExistsTables(
      descriptor({
        conditions: [
          where('title'), // plain where: ignored
          {
            type: 'and',
            conditions: [
              {
                type: 'exists',
                table: 'comments',
                localColumn: 'id',
                foreignColumn: 'task_id',
                conditions: [
                  where('approved'),
                  { type: 'exists', table: 'users', localColumn: 'author_id', foreignColumn: 'id', conditions: [] },
                ],
              },
            ],
          },
          {
            type: 'or',
            conditions: [
              {
                type: 'not',
                condition: { type: 'exists', table: 'tags', localColumn: 'id', foreignColumn: 'task_id', conditions: [] },
              },
            ],
          },
        ],
      }),
    );
    expect([...tables].sort()).toEqual(['comments', 'tags', 'users']);
  });
});
