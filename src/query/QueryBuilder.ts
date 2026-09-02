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
  ExistsClause,
  OrderByClause,
  JoinClause,
  ComparisonOperator,
  SortOrder,
} from './types';

// ─── Association resolution (for `on()`) ───────────────────────────────────

/** How two tables are linked: `outer.localColumn = inner.foreignColumn`. */
export interface AssociationJoin {
  readonly localColumn: string;
  readonly foreignColumn: string;
}

/**
 * Resolves the join columns between two tables, or `null` when unknown.
 * Supplied by `Collection.query()` so `on()` can look up schema relations
 * and `static associations` — including for nested inner builders.
 */
export type AssociationResolver = (fromTable: string, toTable: string) => AssociationJoin | null;

export interface QueryBuilderOptions {
  readonly associations?: AssociationResolver;
}

export class QueryBuilder {
  private _table: string;
  private _conditions: Condition[] = [];
  private _orderBy: OrderByClause[] = [];
  private _limit?: number;
  private _offset?: number;
  private _joins: JoinClause[] = [];
  private _associations?: AssociationResolver;

  constructor(table: string, options: QueryBuilderOptions = {}) {
    this._table = table;
    this._associations = options.associations;
  }

  /** The table this builder queries */
  get table(): string {
    return this._table;
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
    const sub = this._sub(this._table);
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
    const sub = this._sub(this._table);
    builder(sub);
    const orClause: OrClause = {
      type: 'or',
      conditions: sub._conditions,
    };
    this._conditions.push(orClause);
    return this;
  }

  /**
   * Add an EXISTS condition on an associated table (WatermelonDB `Q.on`).
   *
   * The join columns are resolved from the association between this table
   * and `table` — declared either as `m.belongsTo()` / `m.hasMany()` in the
   * schema, or via `static associations` on the model class:
   *   belongs_to → `outer.<fk> = inner.id`
   *   has_many   → `outer.id = inner.<fk>`
   *
   *   // comments whose post is published
   *   .on('posts', 'status', 'published')
   *   // posts with at least one approved comment by a given author
   *   .on('comments', (c) => c.where('approved', true).where('author_id', id))
   *
   * Inner builders may nest further `on()` calls. Rows of the inner table
   * marked deleted are ignored. Use `onColumns()` when no association exists.
   */
  on(table: string, fn: (qb: QueryBuilder) => void): this;
  on(table: string, column: string, value: unknown): this;
  on(table: string, fnOrColumn: ((qb: QueryBuilder) => void) | string, value?: unknown): this {
    const join = this._associations?.(this._table, table) ?? null;
    if (!join) {
      throw new Error(
        `Cannot resolve association from "${this._table}" to "${table}". ` +
          'Declare it with m.belongsTo()/m.hasMany() in the schema or `static associations` ' +
          'on the model class, or use onColumns() to give the join columns explicitly.',
      );
    }
    const fn =
      typeof fnOrColumn === 'function'
        ? fnOrColumn
        : (qb: QueryBuilder) => {
          qb.where(fnOrColumn, value);
        };
    return this.onColumns(table, join.localColumn, join.foreignColumn, fn);
  }

  /**
   * Add an EXISTS condition with explicit join columns:
   * `EXISTS (SELECT 1 FROM table WHERE table.foreignColumn = this.localColumn AND ...)`.
   */
  onColumns(
    table: string,
    localColumn: string,
    foreignColumn: string,
    fn?: (qb: QueryBuilder) => void,
  ): this {
    const inner = this._sub(table);
    fn?.(inner);
    const clause: ExistsClause = {
      type: 'exists',
      table,
      localColumn,
      foreignColumn,
      conditions: inner._conditions,
    };
    this._conditions.push(clause);
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
    const qb = this._sub(this._table);
    qb._conditions = [...this._conditions];
    qb._orderBy = [...this._orderBy];
    qb._limit = this._limit;
    qb._offset = this._offset;
    qb._joins = [...this._joins];
    return qb;
  }

  /** Create a nested builder sharing this builder's association resolver */
  private _sub(table: string): QueryBuilder {
    return new QueryBuilder(table, { associations: this._associations });
  }
}

// ─── Convenience factory ───────────────────────────────────────────────────

export function query(table: string, options?: QueryBuilderOptions): QueryBuilder {
  return new QueryBuilder(table, options);
}
