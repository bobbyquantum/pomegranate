/**
 * Query descriptor types.
 *
 * Queries are built as plain descriptor objects (no classes), making them
 * serializable and easy to translate to SQL or LokiJS query syntax.
 */

// ─── Comparison operators ──────────────────────────────────────────────────

export type ComparisonOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'like'
  | 'notLike'
  | 'between'
  | 'isNull'
  | 'isNotNull';

export interface WhereClause {
  readonly type: 'where';
  readonly column: string;
  readonly operator: ComparisonOperator;
  readonly value: unknown;
}

export interface AndClause {
  readonly type: 'and';
  readonly conditions: readonly Condition[];
}

export interface OrClause {
  readonly type: 'or';
  readonly conditions: readonly Condition[];
}

export interface NotClause {
  readonly type: 'not';
  readonly condition: Condition;
}

export type Condition = WhereClause | AndClause | OrClause | NotClause;

// ─── Sort / Order ──────────────────────────────────────────────────────────

export type SortOrder = 'asc' | 'desc';

export interface OrderByClause {
  readonly column: string;
  readonly order: SortOrder;
}

// ─── Join (for querying relations) ─────────────────────────────────────────

export interface JoinClause {
  readonly table: string;
  readonly leftColumn: string;
  readonly rightColumn: string;
}

// ─── Full Query Descriptor ─────────────────────────────────────────────────

export interface QueryDescriptor {
  readonly table: string;
  readonly conditions: readonly Condition[];
  readonly orderBy: readonly OrderByClause[];
  readonly limit?: number;
  readonly offset?: number;
  readonly joins: readonly JoinClause[];
}

// ─── Search Descriptor (full-text search) ──────────────────────────────────

export interface SearchDescriptor {
  readonly table: string;
  readonly term: string;
  readonly fields: readonly string[];
  readonly conditions: readonly Condition[];
  readonly orderBy: readonly OrderByClause[];
  readonly limit: number;
  readonly offset: number;
}

// ─── Batch operations ──────────────────────────────────────────────────────

export type BatchOperationType = 'create' | 'update' | 'delete' | 'destroyPermanently';

export interface BatchOperation {
  readonly type: BatchOperationType;
  readonly table: string;
  readonly rawRecord?: Record<string, unknown>;
  readonly id?: string;
}
