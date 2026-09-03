/**
 * WatermelonDB's `Q` query DSL, translated onto the core `QueryBuilder`.
 *
 * Clauses are plain objects (so they can be stored, combined and passed
 * around like in WatermelonDB) and are applied to a builder by
 * `applyClauses()` when a `Query` is executed.
 */

import type { QueryBuilder } from '../query/QueryBuilder';

// ─── Comparisons ───────────────────────────────────────────────────────────

export type ComparisonOperator =
  | 'eq'
  | 'notEq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'oneOf'
  | 'notIn'
  | 'between'
  | 'like'
  | 'notLike';

const COMPARISON = Symbol.for('pomegranate-db/watermelon/comparison');

export interface Comparison {
  readonly operator: ComparisonOperator;
  readonly right: unknown;
  readonly [COMPARISON]: true;
}

export type Value = string | number | boolean | null;

// ─── Clauses ───────────────────────────────────────────────────────────────

export interface WhereClause {
  readonly type: 'where';
  readonly left: string;
  readonly comparison: Comparison;
}

export interface AndClause {
  readonly type: 'and';
  readonly conditions: Where[];
}

export interface OrClause {
  readonly type: 'or';
  readonly conditions: Where[];
}

export interface OnClause {
  readonly type: 'on';
  readonly table: string;
  readonly conditions: Where[];
}

export type Where = WhereClause | AndClause | OrClause | OnClause;

export type SortOrder = 'asc' | 'desc';

export interface SortByClause {
  readonly type: 'sortBy';
  readonly sortColumn: string;
  readonly sortOrder: SortOrder;
}

export interface TakeClause {
  readonly type: 'take';
  readonly count: number;
}

export interface SkipClause {
  readonly type: 'skip';
  readonly count: number;
}

/** `Q.experimentalJoinTables` — accepted and ignored (joins are implicit). */
export interface JoinTablesClause {
  readonly type: 'joinTables';
  readonly tables: string[];
}

/** `Q.experimentalNestedJoin` — accepted and ignored (nested `Q.on` just works). */
export interface NestedJoinTableClause {
  readonly type: 'nestedJoinTable';
  readonly from: string;
  readonly to: string;
}

export type Clause =
  | Where
  | SortByClause
  | TakeClause
  | SkipClause
  | JoinTablesClause
  | NestedJoinTableClause;

// ─── Constructors ──────────────────────────────────────────────────────────

function comparison(operator: ComparisonOperator, right: unknown): Comparison {
  return { operator, right, [COMPARISON]: true };
}

export function isComparison(value: unknown): value is Comparison {
  return typeof value === 'object' && value !== null && (value as Comparison)[COMPARISON] === true;
}

function checkValue(value: unknown, context: string): void {
  if (value === undefined) {
    throw new Error(`${context}: value is undefined — use null for IS NULL`);
  }
  const type = typeof value;
  if (value !== null && type !== 'string' && type !== 'number' && type !== 'boolean') {
    throw new TypeError(`${context}: expected a string, number, boolean or null, got ${type}`);
  }
}

function checkValues(values: unknown, context: string): Value[] {
  if (!Array.isArray(values)) {
    throw new TypeError(`${context}: expected an array of values`);
  }
  for (const value of values) checkValue(value, context);
  return values as Value[];
}

function checkColumn(column: unknown, context: string): string {
  if (typeof column !== 'string' || column.length === 0) {
    throw new TypeError(`${context}: expected a column name`);
  }
  return column;
}

function flattenWhere(conditions: Array<Where | Where[]>, context: string): Where[] {
  const out: Where[] = [];
  for (const condition of conditions) {
    if (Array.isArray(condition)) {
      out.push(...flattenWhere(condition, context));
    } else if (condition && typeof condition === 'object' && 'type' in condition) {
      out.push(condition);
    } else {
      throw new TypeError(`${context}: expected Q.where/Q.and/Q.or/Q.on clauses`);
    }
  }
  return out;
}

function where(column: string, valueOrComparison: Value | Comparison): WhereClause {
  const left = checkColumn(column, 'Q.where');
  if (isComparison(valueOrComparison)) {
    return { type: 'where', left, comparison: valueOrComparison };
  }
  checkValue(valueOrComparison, `Q.where('${left}')`);
  return { type: 'where', left, comparison: comparison('eq', valueOrComparison) };
}

function on(table: string, column: string, value: Value | Comparison): OnClause;
function on(table: string, ...conditions: Array<Where | Where[]>): OnClause;
function on(table: string, ...rest: unknown[]): OnClause {
  checkColumn(table, 'Q.on');
  if (typeof rest[0] === 'string') {
    if (rest.length !== 2) {
      throw new TypeError('Q.on(table, column, value) requires exactly a column and a value');
    }
    return { type: 'on', table, conditions: [where(rest[0], rest[1] as Value | Comparison)] };
  }
  return { type: 'on', table, conditions: flattenWhere(rest as Array<Where | Where[]>, 'Q.on') };
}

export const Q = {
  // comparisons
  eq(value: Value): Comparison {
    checkValue(value, 'Q.eq');
    return comparison('eq', value);
  },
  notEq(value: Value): Comparison {
    checkValue(value, 'Q.notEq');
    return comparison('notEq', value);
  },
  gt(value: Value): Comparison {
    checkValue(value, 'Q.gt');
    return comparison('gt', value);
  },
  gte(value: Value): Comparison {
    checkValue(value, 'Q.gte');
    return comparison('gte', value);
  },
  lt(value: Value): Comparison {
    checkValue(value, 'Q.lt');
    return comparison('lt', value);
  },
  lte(value: Value): Comparison {
    checkValue(value, 'Q.lte');
    return comparison('lte', value);
  },
  oneOf(values: Value[]): Comparison {
    return comparison('oneOf', checkValues(values, 'Q.oneOf'));
  },
  notIn(values: Value[]): Comparison {
    return comparison('notIn', checkValues(values, 'Q.notIn'));
  },
  between(left: number, right: number): Comparison {
    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new TypeError('Q.between: expected two numbers');
    }
    return comparison('between', [left, right]);
  },
  like(value: string): Comparison {
    if (typeof value !== 'string') throw new TypeError('Q.like: expected a string');
    return comparison('like', value);
  },
  notLike(value: string): Comparison {
    if (typeof value !== 'string') throw new TypeError('Q.notLike: expected a string');
    return comparison('notLike', value);
  },

  // conditions
  where,
  and(...conditions: Array<Where | Where[]>): AndClause {
    return { type: 'and', conditions: flattenWhere(conditions, 'Q.and') };
  },
  or(...conditions: Array<Where | Where[]>): OrClause {
    return { type: 'or', conditions: flattenWhere(conditions, 'Q.or') };
  },
  on,

  // ordering & paging
  asc: 'asc' as const,
  desc: 'desc' as const,
  sortBy(column: string, order: SortOrder = 'asc'): SortByClause {
    checkColumn(column, 'Q.sortBy');
    if (order !== 'asc' && order !== 'desc') {
      throw new TypeError(`Q.sortBy: order must be Q.asc or Q.desc, got ${String(order)}`);
    }
    return { type: 'sortBy', sortColumn: column, sortOrder: order };
  },
  take(count: number): TakeClause {
    if (!Number.isInteger(count) || count < 0) throw new TypeError('Q.take: expected a non-negative integer');
    return { type: 'take', count };
  },
  skip(count: number): SkipClause {
    if (!Number.isInteger(count) || count < 0) throw new TypeError('Q.skip: expected a non-negative integer');
    return { type: 'skip', count };
  },

  // no-ops kept for source compatibility
  experimentalJoinTables(tables: string[]): JoinTablesClause {
    return { type: 'joinTables', tables: [...tables] };
  },
  experimentalNestedJoin(from: string, to: string): NestedJoinTableClause {
    return { type: 'nestedJoinTable', from, to };
  },

  /** Escape a user-supplied string for use inside a LIKE pattern (WatermelonDB semantics). */
  sanitizeLikeString(value: string): string {
    return value.replaceAll(/[^a-zA-Z0-9]/g, '_');
  },
};

export type QType = typeof Q;

// ─── Translation to the core QueryBuilder ──────────────────────────────────

/** Booleans are stored as 0/1; make query values match what is on disk. */
function normalizeValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function applyWhere(qb: QueryBuilder, clause: WhereClause): void {
  const column = clause.left;
  const { operator, right } = clause.comparison;
  switch (operator) {
    case 'eq': {
      const value = normalizeValue(right);
      if (value === null) qb.whereNull(column);
      else qb.where(column, 'eq', value);
      return;
    }
    case 'notEq': {
      const value = normalizeValue(right);
      if (value === null) {
        qb.whereNotNull(column);
      } else {
        // WatermelonDB's notEq is `IS NOT`, which also matches NULL.
        qb.or((sub) => {
          sub.where(column, 'neq', value);
          sub.whereNull(column);
        });
      }
      return;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      qb.where(column, operator, normalizeValue(right));
      return;
    case 'oneOf':
      qb.whereIn(column, (right as unknown[]).map(normalizeValue));
      return;
    case 'notIn':
      qb.where(column, 'notIn', (right as unknown[]).map(normalizeValue));
      return;
    case 'between': {
      const [low, high] = right as [unknown, unknown];
      qb.whereBetween(column, low, high);
      return;
    }
    case 'like':
      qb.whereLike(column, right as string);
      return;
    case 'notLike':
      qb.where(column, 'notLike', right);
      return;
  }
}

export function applyConditions(qb: QueryBuilder, conditions: readonly Where[]): void {
  for (const condition of conditions) {
    switch (condition.type) {
      case 'where':
        applyWhere(qb, condition);
        break;
      case 'and':
        if (condition.conditions.length > 0) {
          qb.and((sub) => applyConditions(sub, condition.conditions));
        }
        break;
      case 'or':
        if (condition.conditions.length > 0) {
          qb.or((sub) => applyConditions(sub, condition.conditions));
        }
        break;
      case 'on':
        qb.on(condition.table, (inner) => applyConditions(inner, condition.conditions));
        break;
    }
  }
}

/** Apply WatermelonDB clauses to a core builder (which already excludes deleted rows). */
export function applyClauses(qb: QueryBuilder, clauses: readonly Clause[]): void {
  for (const clause of clauses) {
    switch (clause.type) {
      case 'where':
      case 'and':
      case 'or':
      case 'on':
        applyConditions(qb, [clause]);
        break;
      case 'sortBy':
        qb.orderBy(clause.sortColumn, clause.sortOrder);
        break;
      case 'take':
        qb.limit(clause.count);
        break;
      case 'skip':
        qb.offset(clause.count);
        break;
      case 'joinTables':
      case 'nestedJoinTable':
        break;
      default:
        throw new Error(`Unknown query clause type "${String((clause as { type: unknown }).type)}"`);
    }
  }
}
