/**
 * Core type definitions for the schema system.
 *
 * The schema builder produces typed descriptors that the rest of the system
 * uses to generate SQL, validate patches, and infer TypeScript types.
 */

// ─── Column Types ──────────────────────────────────────────────────────────

export type ColumnType = 'text' | 'number' | 'boolean' | 'date';

/** Shared metadata for any persisted column declared in a model schema. */
export interface ColumnDescriptor {
  /** Primitive storage type used by the adapter. */
  readonly type: ColumnType;
  /** Explicit database column name, or `null` to reuse the field name. */
  readonly columnName: string | null; // null => use field name
  /** Whether the field can only be written by the framework. */
  readonly isReadonly: boolean;
  /** Whether `null` is allowed at the model level. */
  readonly isOptional: boolean;
  /** Whether adapters should create an index for this column. */
  readonly isIndexed: boolean;
  /** Default value applied when a record is created without this field. */
  readonly defaultValue?: unknown;
}

/** Text column descriptor. */
export interface TextColumn extends ColumnDescriptor {
  readonly type: 'text';
}

/** Numeric column descriptor. */
export interface NumberColumn extends ColumnDescriptor {
  readonly type: 'number';
}

/** Boolean column descriptor. */
export interface BooleanColumn extends ColumnDescriptor {
  readonly type: 'boolean';
}

/** Date column descriptor stored as an epoch timestamp. */
export interface DateColumn extends ColumnDescriptor {
  readonly type: 'date';
}

// ─── Relation Types ────────────────────────────────────────────────────────

/** Supported relation kinds in compiled schema metadata. */
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

/** Any relation descriptor accepted in a model field definition. */
export type RelationDescriptor = BelongsToDescriptor | HasManyDescriptor;

// ─── Field Descriptor (union) ──────────────────────────────────────────────

export type FieldDescriptor = ColumnDescriptor | RelationDescriptor;

// ─── Schema Shape ──────────────────────────────────────────────────────────

/** The raw shape definition passed to `m.model()` */
export type SchemaFields = Record<string, FieldDescriptor>;

/** Compiled model schema with table name and resolved columns */
export interface ModelSchema<F extends SchemaFields = SchemaFields> {
  /** Backing database table name. */
  readonly table: string;
  /** Original field map as declared by the model builder. */
  readonly fields: F;
  /** Resolved column metadata used by adapters and serializers. */
  readonly columns: ResolvedColumn[];
  /** Resolved relation metadata used for relation handles. */
  readonly relations: ResolvedRelation[];
}

/** Resolved, adapter-ready metadata for a declared column. */
export interface ResolvedColumn {
  /** Model field name used in TypeScript. */
  readonly fieldName: string;
  /** Physical database column name. */
  readonly columnName: string;
  /** Primitive storage type used by the adapter. */
  readonly type: ColumnType;
  /** Whether the field can only be written by framework internals. */
  readonly isReadonly: boolean;
  /** Whether `null` is allowed for this field. */
  readonly isOptional: boolean;
  /** Whether adapters should create an index for this column. */
  readonly isIndexed: boolean;
  /** Default value applied during record creation when omitted. */
  readonly defaultValue?: unknown;
}

/** Resolved, adapter-ready metadata for a declared relation. */
export interface ResolvedRelation {
  /** Model field name used to access the relation. */
  readonly fieldName: string;
  /** Relation kind. */
  readonly kind: RelationType;
  /** Foreign-key column stored on the owning side. */
  readonly foreignKey: string;
  /** @internal Lazy reference — call to get the related schema's table name */
  readonly _relatedSchemaThunk: () => ModelSchema;
}

// ─── Database-level Schema ─────────────────────────────────────────────────

/** Top-level schema object passed into adapters during initialization. */
export interface DatabaseSchema {
  /** Monotonically increasing schema version. */
  readonly version: number;
  /** All tables managed by this database. */
  readonly tables: TableSchema[];
}

/** Schema for one table in the database. */
export interface TableSchema {
  /** Table name. */
  readonly name: string;
  /** Declared columns in the table. */
  readonly columns: TableColumnSchema[];
}

/** Minimal column schema used by adapter DDL creation and migrations. */
export interface TableColumnSchema {
  /** Physical column name. */
  readonly name: string;
  /** Primitive storage type. */
  readonly type: ColumnType;
  /** Whether `null` is allowed. */
  readonly isOptional: boolean;
  /** Whether adapters should create an index. */
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
  /** Stable record identifier. */
  readonly id: string;
  /** Read a field value from the model instance. */
  getField(fieldName: string): unknown;
  /** Observe the model for future changes. */
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

/** Lifecycle state of a locally persisted row relative to sync. */
export type SyncStatus = 'synced' | 'created' | 'updated' | 'deleted';

/** Every persisted row carries sync metadata */
export interface SyncColumns {
  /** Current local sync status for the row. */
  readonly _status: SyncStatus;
  /** Comma-separated list of locally changed field names. */
  readonly _changed: string; // comma-separated field names
}

/** Raw row as stored in the adapter (values are primitives) */
export interface RawRecord extends SyncColumns {
  /** Stable record identifier. */
  readonly id: string;
  /** Arbitrary persisted columns by column name. */
  [column: string]: unknown;
}
