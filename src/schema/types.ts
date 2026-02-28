/**
 * Core type definitions for the schema system.
 *
 * The schema builder produces typed descriptors that the rest of the system
 * uses to generate SQL, validate patches, and infer TypeScript types.
 */

// ─── Column Types ──────────────────────────────────────────────────────────

export type ColumnType = 'text' | 'number' | 'boolean' | 'date';

export interface ColumnDescriptor {
  readonly type: ColumnType;
  readonly columnName: string | null; // null => use field name
  readonly isReadonly: boolean;
  readonly isOptional: boolean;
  readonly isIndexed: boolean;
  readonly defaultValue?: unknown;
}

export interface TextColumn extends ColumnDescriptor {
  readonly type: 'text';
}

export interface NumberColumn extends ColumnDescriptor {
  readonly type: 'number';
}

export interface BooleanColumn extends ColumnDescriptor {
  readonly type: 'boolean';
}

export interface DateColumn extends ColumnDescriptor {
  readonly type: 'date';
}

// ─── Relation Types ────────────────────────────────────────────────────────

export type RelationType = 'belongs_to' | 'has_many';

export interface BelongsToDescriptor {
  readonly kind: 'belongs_to';
  readonly relatedTable: string;
  readonly foreignKey: string;
}

export interface HasManyDescriptor {
  readonly kind: 'has_many';
  readonly relatedTable: string;
  readonly foreignKey: string;
}

export type RelationDescriptor = BelongsToDescriptor | HasManyDescriptor;

// ─── Field Descriptor (union) ──────────────────────────────────────────────

export type FieldDescriptor = ColumnDescriptor | RelationDescriptor;

// ─── Schema Shape ──────────────────────────────────────────────────────────

/** The raw shape definition passed to `m.model()` */
export type SchemaFields = Record<string, FieldDescriptor>;

/** Compiled model schema with table name and resolved columns */
export interface ModelSchema<F extends SchemaFields = SchemaFields> {
  readonly table: string;
  readonly fields: F;
  readonly columns: ResolvedColumn[];
  readonly relations: ResolvedRelation[];
}

export interface ResolvedColumn {
  readonly fieldName: string;
  readonly columnName: string;
  readonly type: ColumnType;
  readonly isReadonly: boolean;
  readonly isOptional: boolean;
  readonly isIndexed: boolean;
  readonly defaultValue?: unknown;
}

export interface ResolvedRelation {
  readonly fieldName: string;
  readonly kind: RelationType;
  readonly relatedTable: string;
  readonly foreignKey: string;
}

// ─── Database-level Schema ─────────────────────────────────────────────────

export interface DatabaseSchema {
  readonly version: number;
  readonly tables: TableSchema[];
}

export interface TableSchema {
  readonly name: string;
  readonly columns: TableColumnSchema[];
}

export interface TableColumnSchema {
  readonly name: string;
  readonly type: ColumnType;
  readonly isOptional: boolean;
  readonly isIndexed: boolean;
}

// ─── Type Inference Helpers ────────────────────────────────────────────────

/** Infer the runtime TypeScript type from a ColumnDescriptor */
export type InferColumnType<C extends ColumnDescriptor> = C['type'] extends 'text'
  ? string
  : C['type'] extends 'number'
    ? number
    : C['type'] extends 'boolean'
      ? boolean
      : C['type'] extends 'date'
        ? Date
        : never;

/** For optional columns, make the type T | null */
type MaybeOptional<C extends ColumnDescriptor, T> = C['isOptional'] extends true ? T | null : T;

/** Infer column type respecting optionality */
export type InferField<C extends FieldDescriptor> = C extends ColumnDescriptor
  ? MaybeOptional<C, InferColumnType<C>>
  : C extends BelongsToDescriptor
    ? string // foreign key value (ID)
    : C extends HasManyDescriptor
      ? never // has_many is query-only, not a stored field
      : never;

/** The record shape inferred from schema fields (writable columns only) */
export type InferCreatePatch<F extends SchemaFields> = {
  [K in keyof F as F[K] extends ColumnDescriptor
    ? F[K]['isReadonly'] extends true
      ? never
      : K
    : F[K] extends BelongsToDescriptor
      ? K
      : never]: F[K] extends ColumnDescriptor
    ? MaybeOptional<F[K], InferColumnType<F[K]>>
    : F[K] extends BelongsToDescriptor
      ? string
      : never;
};

/** The record shape for updates — all writable fields optional */
export type InferUpdatePatch<F extends SchemaFields> = Partial<InferCreatePatch<F>>;

/** Full record shape (all columns + belongs_to keys) */
export type InferRecord<F extends SchemaFields> = {
  readonly id: string;
} & {
  readonly [K in keyof F]: InferField<F[K]>;
};

// ─── Sync Metadata ────────────────────────────────────────────────────────

export type SyncStatus = 'synced' | 'created' | 'updated' | 'deleted';

/** Every persisted row carries sync metadata */
export interface SyncColumns {
  readonly _status: SyncStatus;
  readonly _changed: string; // comma-separated field names
}

/** Raw row as stored in the adapter (values are primitives) */
export interface RawRecord extends SyncColumns {
  readonly id: string;
  [column: string]: unknown;
}
