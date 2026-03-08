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

/**
 * Belongs-to (many-to-one) relation descriptor.
 * Generic over the related ModelSchema so TypeScript can infer the related type.
 * The thunk `_relatedSchemaThunk` is resolved lazily to support forward references.
 */
export interface BelongsToDescriptor<S extends ModelSchema = ModelSchema> {
  readonly kind: 'belongs_to';
  readonly foreignKey: string;
  /** @internal Lazy reference to the related schema — supports forward references */
  readonly _relatedSchemaThunk: () => S;
}

/**
 * Has-many (one-to-many) relation descriptor.
 * Generic over the related ModelSchema so TypeScript can infer the related type.
 */
export interface HasManyDescriptor<S extends ModelSchema = ModelSchema> {
  readonly kind: 'has_many';
  readonly foreignKey: string;
  /** @internal Lazy reference to the related schema — supports forward references */
  readonly _relatedSchemaThunk: () => S;
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
  readonly foreignKey: string;
  /** @internal Lazy reference — call to get the related schema's table name */
  readonly _relatedSchemaThunk: () => ModelSchema;
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

// ─── Relation Wrapper Types ────────────────────────────────────────────────

import type { Observable } from '../observable/Subject';

/** Lazy belongs-to relation handle (many-to-one). */
export interface BelongsToRelation<S extends ModelSchema = ModelSchema> {
  /** The foreign key value (the related record's ID) */
  readonly id: string | null;
  /** Fetch the related record */
  fetch(): Promise<ModelInstance<S> | null>;
  /** Observe the related record reactively */
  observe(): Observable<ModelInstance<S> | null>;
}

/** Lazy has-many relation handle (one-to-many). */
export interface HasManyRelation<S extends ModelSchema = ModelSchema> {
  /** Fetch all related records */
  fetch(): Promise<ModelInstance<S>[]>;
  /** Observe the related records reactively */
  observe(): Observable<ModelInstance<S>[]>;
}

/**
 * A model instance typed by its schema.
 * Forward-declared as a minimal interface to avoid circular imports.
 * Full Model class satisfies this at runtime.
 */
export interface ModelInstance<S extends ModelSchema = ModelSchema> {
  readonly id: string;
  getField(fieldName: string): unknown;
  observe(): Observable<ModelInstance<S>>;
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

/** Infer field type — columns resolve to values, relations resolve to relation wrappers */
export type InferField<C extends FieldDescriptor> = C extends ColumnDescriptor
  ? MaybeOptional<C, InferColumnType<C>>
  : C extends BelongsToDescriptor<infer S>
    ? BelongsToRelation<S>
    : C extends HasManyDescriptor<infer S>
      ? HasManyRelation<S>
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
      ? string // create/update patches accept the FK id as a string
      : never;
};

/** The record shape for updates — all writable fields optional */
export type InferUpdatePatch<F extends SchemaFields> = Partial<InferCreatePatch<F>>;

/** Full record shape (all columns + relation wrappers) */
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
