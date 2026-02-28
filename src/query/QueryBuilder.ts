/**
 * Query builder — fluent API for constructing QueryDescriptors.
 *
 * Usage:
 *   const q = new QueryBuilder('posts')
 *     .where('status', 'eq', 'published')
 *     .where('createdAt', 'gt', someDate)
 *     .orderBy('createdAt', 'desc')
 *     .limit(20)
 *     .build();
 */

import type {
  QueryDescriptor,
  Condition,
  WhereClause,
  AndClause,
  OrClause,
  OrderByClause,
  JoinClause,
  ComparisonOperator,
  SortOrder,
} from './types';

export class QueryBuilder {
  private _table: string;
  private _conditions: Condition[] = [];
  private _orderBy: OrderByClause[] = [];
  private _limit?: number;
  private _offset?: number;
  private _joins: JoinClause[] = [];

  constructor(table: string) {
    this._table = table;
  }

  /** Add a WHERE condition */
  where(column: string, value: unknown): this;
  where(column: string, operator: ComparisonOperator, value: unknown): this;
  where(column: string, operatorOrValue: unknown, maybeValue?: unknown): this {
    let operator: ComparisonOperator;
    let value: unknown;

    if (maybeValue === undefined) {
      operator = 'eq';
      value = operatorOrValue;
    } else {
      operator = operatorOrValue as ComparisonOperator;
      value = maybeValue;
    }

    const clause: WhereClause = {
      type: 'where',
      column,
      operator,
      value,
    };
    this._conditions.push(clause);
    return this;
  }

  /** WHERE column IS NULL */
  whereNull(column: string): this {
    this._conditions.push({
      type: 'where',
      column,
      operator: 'isNull',
      value: null,
    });
    return this;
  }

  /** WHERE column IS NOT NULL */
  whereNotNull(column: string): this {
    this._conditions.push({
      type: 'where',
      column,
      operator: 'isNotNull',
      value: null,
    });
    return this;
  }

  /** WHERE column IN (...values) */
  whereIn(column: string, values: unknown[]): this {
    this._conditions.push({
      type: 'where',
      column,
      operator: 'in',
      value: values,
    });
    return this;
  }

  /** WHERE column BETWEEN low AND high */
  whereBetween(column: string, low: unknown, high: unknown): this {
    this._conditions.push({
      type: 'where',
      column,
      operator: 'between',
      value: [low, high],
    });
    return this;
  }

  /** WHERE column LIKE pattern */
  whereLike(column: string, pattern: string): this {
    this._conditions.push({
      type: 'where',
      column,
      operator: 'like',
      value: pattern,
    });
    return this;
  }

  /** Combine conditions with AND */
  and(builder: (qb: QueryBuilder) => void): this {
    const sub = new QueryBuilder(this._table);
    builder(sub);
    const andClause: AndClause = {
      type: 'and',
      conditions: sub._conditions,
    };
    this._conditions.push(andClause);
    return this;
  }

  /** Combine conditions with OR */
  or(builder: (qb: QueryBuilder) => void): this {
    const sub = new QueryBuilder(this._table);
    builder(sub);
    const orClause: OrClause = {
      type: 'or',
      conditions: sub._conditions,
    };
    this._conditions.push(orClause);
    return this;
  }

  /** Add ORDER BY */
  orderBy(column: string, order: SortOrder = 'asc'): this {
    this._orderBy.push({ column, order });
    return this;
  }

  /** Set LIMIT */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /** Set OFFSET */
  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /** Add a JOIN clause */
  join(table: string, leftColumn: string, rightColumn: string): this {
    this._joins.push({ table, leftColumn, rightColumn });
    return this;
  }

  /** Build the final query descriptor */
  build(): QueryDescriptor {
    return Object.freeze({
      table: this._table,
      conditions: Object.freeze([...this._conditions]),
      orderBy: Object.freeze([...this._orderBy]),
      limit: this._limit,
      offset: this._offset,
      joins: Object.freeze([...this._joins]),
    });
  }

  /** Clone this builder for forking */
  clone(): QueryBuilder {
    const qb = new QueryBuilder(this._table);
    qb._conditions = [...this._conditions];
    qb._orderBy = [...this._orderBy];
    qb._limit = this._limit;
    qb._offset = this._offset;
    qb._joins = [...this._joins];
    return qb;
  }
}

// ─── Convenience factory ───────────────────────────────────────────────────

export function query(table: string): QueryBuilder {
  return new QueryBuilder(table);
}
