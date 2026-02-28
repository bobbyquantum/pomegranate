/**
 * Tests for QueryBuilder.
 */

import { QueryBuilder, query } from '../query/QueryBuilder';

describe('QueryBuilder', () => {
  it('builds a basic query', () => {
    const desc = query('posts').build();

    expect(desc.table).toBe('posts');
    expect(desc.conditions).toEqual([]);
    expect(desc.orderBy).toEqual([]);
    expect(desc.joins).toEqual([]);
    expect(desc.limit).toBeUndefined();
    expect(desc.offset).toBeUndefined();
  });

  it('adds where conditions with implicit eq', () => {
    const desc = query('posts').where('status', 'published').build();

    expect(desc.conditions).toHaveLength(1);
    expect(desc.conditions[0]).toEqual({
      type: 'where',
      column: 'status',
      operator: 'eq',
      value: 'published',
    });
  });

  it('adds where conditions with explicit operator', () => {
    const desc = query('posts').where('views', 'gt', 100).build();

    expect(desc.conditions[0]).toEqual({
      type: 'where',
      column: 'views',
      operator: 'gt',
      value: 100,
    });
  });

  it('supports whereNull and whereNotNull', () => {
    const desc = query('posts').whereNull('deletedAt').whereNotNull('title').build();

    expect(desc.conditions).toHaveLength(2);
    expect(desc.conditions[0].type).toBe('where');
    expect((desc.conditions[0] as any).operator).toBe('isNull');
    expect((desc.conditions[1] as any).operator).toBe('isNotNull');
  });

  it('supports whereIn', () => {
    const desc = query('posts').whereIn('status', ['draft', 'published']).build();

    expect((desc.conditions[0] as any).operator).toBe('in');
    expect((desc.conditions[0] as any).value).toEqual(['draft', 'published']);
  });

  it('supports whereBetween', () => {
    const desc = query('posts').whereBetween('views', 10, 100).build();

    expect((desc.conditions[0] as any).operator).toBe('between');
    expect((desc.conditions[0] as any).value).toEqual([10, 100]);
  });

  it('supports whereLike', () => {
    const desc = query('posts').whereLike('title', '%hello%').build();

    expect((desc.conditions[0] as any).operator).toBe('like');
  });

  it('supports orderBy', () => {
    const desc = query('posts').orderBy('createdAt', 'desc').orderBy('title').build();

    expect(desc.orderBy).toEqual([
      { column: 'createdAt', order: 'desc' },
      { column: 'title', order: 'asc' },
    ]);
  });

  it('supports limit and offset', () => {
    const desc = query('posts').limit(20).offset(40).build();

    expect(desc.limit).toBe(20);
    expect(desc.offset).toBe(40);
  });

  it('supports OR conditions', () => {
    const desc = query('posts')
      .or((qb) => {
        qb.where('status', 'draft');
        qb.where('status', 'published');
      })
      .build();

    expect(desc.conditions).toHaveLength(1);
    expect(desc.conditions[0].type).toBe('or');
    expect((desc.conditions[0] as any).conditions).toHaveLength(2);
  });

  it('supports AND conditions', () => {
    const desc = query('posts')
      .and((qb) => {
        qb.where('status', 'published');
        qb.where('views', 'gt', 0);
      })
      .build();

    expect(desc.conditions[0].type).toBe('and');
  });

  it('supports joins', () => {
    const desc = query('posts').join('users', 'author_id', 'id').build();

    expect(desc.joins).toHaveLength(1);
    expect(desc.joins[0]).toEqual({
      table: 'users',
      leftColumn: 'author_id',
      rightColumn: 'id',
    });
  });

  it('clone creates an independent copy', () => {
    const original = query('posts').where('status', 'draft');
    const cloned = original.clone().where('views', 'gt', 0);

    expect(original.build().conditions).toHaveLength(1);
    expect(cloned.build().conditions).toHaveLength(2);
  });

  it('build() returns a frozen descriptor', () => {
    const desc = query('posts').build();
    expect(Object.isFrozen(desc)).toBe(true);
    expect(Object.isFrozen(desc.conditions)).toBe(true);
  });
});
