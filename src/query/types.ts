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

/** A basic column comparison such as `title = 'hello'` or `age >= 18`. */
export interface WhereClause {
  /** Discriminator used by query translators. */
  readonly type: 'where';
  /** Column name on the current table. */
  readonly column: string;
  /** Comparison to apply to the column value. */
  readonly operator: ComparisonOperator;
  /** Right-hand value for the comparison. */
  readonly value: unknown;
}

/** A nested condition group where all child conditions must match. */
export interface AndClause {
  /** Discriminator used by query translators. */
  readonly type: 'and';
  /** Child conditions combined with logical AND. */
  readonly conditions: readonly Condition[];
}

/** A nested condition group where any child condition may match. */
export interface OrClause {
  /** Discriminator used by query translators. */
  readonly type: 'or';
  /** Child conditions combined with logical OR. */
  readonly conditions: readonly Condition[];
}

/** Negates a single child condition. */
export interface NotClause {
  /** Discriminator used by query translators. */
  readonly type: 'not';
  /** Condition to negate. */
  readonly condition: Condition;
}

/** Any filter node that can appear in a serialized query tree. */
export type Condition = WhereClause | AndClause | OrClause | NotClause;

// ─── Sort / Order ──────────────────────────────────────────────────────────

/** Supported sort directions for ORDER BY clauses. */
export type SortOrder = 'asc' | 'desc';

/** A single ORDER BY clause. */
export interface OrderByClause {
  /** Column to sort by. */
  readonly column: string;
  /** Sort direction. */
  readonly order: SortOrder;
}

// ─── Join (for querying relations) ─────────────────────────────────────────

/** A simple join definition used by adapter query translators. */
export interface JoinClause {
  /** Joined table name. */
  readonly table: string;
  /** Left-hand join column, usually on the base table. */
  readonly leftColumn: string;
  /** Right-hand join column, usually on the joined table. */
  readonly rightColumn: string;
}

// ─── Full Query Descriptor ─────────────────────────────────────────────────

/** Fully-serializable query description produced by `QueryBuilder`. */
export interface QueryDescriptor {
  /** Base table to query. */
  readonly table: string;
  /** Filter tree applied to the query. */
  readonly conditions: readonly Condition[];
  /** Sort clauses applied in order. */
  readonly orderBy: readonly OrderByClause[];
  /** Maximum number of records to return. */
  readonly limit?: number;
  /** Number of matching rows to skip first. */
  readonly offset?: number;
  /** Join clauses needed to satisfy relational filters. */
  readonly joins: readonly JoinClause[];
}

// ─── Search Descriptor (full-text search) ──────────────────────────────────

/** Descriptor for adapter-level full-text search. */
export interface SearchDescriptor {
  /** Table to search within. */
  readonly table: string;
  /** Search term to match. */
  readonly term: string;
  /** Columns that should participate in the text search. */
  readonly fields: readonly string[];
  /** Additional non-text filters to apply. */
  readonly conditions: readonly Condition[];
  /** Sort clauses for the final result set. */
  readonly orderBy: readonly OrderByClause[];
  /** Maximum number of records to return. */
  readonly limit: number;
  /** Number of results to skip before returning rows. */
  readonly offset: number;
}

// ─── Batch operations ──────────────────────────────────────────────────────

/** Supported mutation kinds for adapter batch payloads. */
export type BatchOperationType = 'create' | 'update' | 'delete' | 'destroyPermanently';

/** A single mutation in an adapter batch payload. */
export interface BatchOperation {
  /** Operation kind to perform. */
  readonly type: BatchOperationType;
  /** Target table for the operation. */
  readonly table: string;
  /** Raw record payload for create or update operations. */
  readonly rawRecord?: Record<string, unknown>;
  /** Target record id for delete-style operations. */
  readonly id?: string;
}
