/**
 * Schema builder — the `m` API.
 *
 * Provides a fluent, Zod-inspired builder for defining model schemas
 * with full TypeScript inference.
 *
 * Usage:
 *   const PostSchema = m.model('posts', {
 *     title: m.text(),
 *     body: m.text(),
 *     isPinned: m.boolean().default(false),
 *     createdAt: m.date('created_at').readonly(),
 *     author: m.belongsTo(() => UserSchema, { key: 'author_id' }),
 *     comments: m.hasMany(() => CommentSchema, { foreignKey: 'post_id' }),
 *   });
 */

import type {
  ColumnDescriptor,
  TextColumn,
  NumberColumn,
  BooleanColumn,
  DateColumn,
  BelongsToDescriptor,
  HasManyDescriptor,
  SchemaFields,
  ModelSchema,
  ResolvedColumn,
  ResolvedRelation,
  ColumnType,
  FieldDescriptor,
} from './types';

// ─── Column Builder ────────────────────────────────────────────────────────

/**
 * Fluent builder wrapping a ColumnDescriptor.
 * Each modifier returns a new frozen object (immutable).
 */
export class ColumnBuilder<C extends ColumnDescriptor> {
  constructor(public readonly descriptor: C) {
    Object.freeze(this.descriptor);
  }

  /** Mark this column as readonly (cannot be set in update patches) */
  readonly(): ColumnBuilder<C & { readonly isReadonly: true }> {
    return new ColumnBuilder({ ...this.descriptor, isReadonly: true } as any);
  }

  /** Mark this column as optional (nullable) */
  optional(): ColumnBuilder<C & { readonly isOptional: true }> {
    return new ColumnBuilder({ ...this.descriptor, isOptional: true } as any);
  }

  /** Add a database index on this column */
  indexed(): ColumnBuilder<C & { readonly isIndexed: true }> {
    return new ColumnBuilder({ ...this.descriptor, isIndexed: true } as any);
  }

  /** Set a default value for this column */
  default(value: unknown): ColumnBuilder<C> {
    return new ColumnBuilder({ ...this.descriptor, defaultValue: value });
  }
}

// Make ColumnBuilder look like a plain descriptor for schema inference
// by forwarding the key properties
function isColumnBuilder(v: unknown): v is ColumnBuilder<ColumnDescriptor> {
  return v instanceof ColumnBuilder;
}

// ─── Helper: resolve a field (ColumnBuilder | RelationDescriptor) ──────────

function resolveField(
  fieldName: string,
  raw: FieldDescriptor | ColumnBuilder<ColumnDescriptor>,
): { column?: ResolvedColumn; relation?: ResolvedRelation } {
  const desc: FieldDescriptor = isColumnBuilder(raw) ? raw.descriptor : raw;

  if ('type' in desc) {
    const col: ResolvedColumn = {
      fieldName,
      columnName: desc.columnName ?? fieldName,
      type: desc.type,
      isReadonly: desc.isReadonly,
      isOptional: desc.isOptional,
      isIndexed: desc.isIndexed,
      defaultValue: desc.defaultValue,
    };
    return { column: col };
  }

  if ('kind' in desc) {
    const rel: ResolvedRelation = {
      fieldName,
      kind: desc.kind,
      foreignKey: desc.foreignKey,
      _relatedSchemaThunk: desc._relatedSchemaThunk,
    };

    // belongs_to also implies a column for the foreign key
    if (desc.kind === 'belongs_to') {
      const col: ResolvedColumn = {
        fieldName,
        columnName: desc.foreignKey,
        type: 'text' as ColumnType,
        isReadonly: false,
        isOptional: false,
        isIndexed: true,
        defaultValue: undefined,
      };
      return { column: col, relation: rel };
    }

    return { relation: rel };
  }

  throw new Error(`Unknown field descriptor for "${fieldName}"`);
}

// ─── The `m` namespace ─────────────────────────────────────────────────────

function makeColumn<T extends ColumnDescriptor>(
  type: T['type'],
  columnName: string | null,
): ColumnBuilder<T> {
  return new ColumnBuilder({
    type,
    columnName,
    isReadonly: false,
    isOptional: false,
    isIndexed: false,
  } as unknown as T);
}

/**
 * Public schema builder API — the `m` object.
 */
export const m = {
  /** Text (string) column */
  text(columnName?: string): ColumnBuilder<TextColumn> {
    return makeColumn<TextColumn>('text', columnName ?? null);
  },

  /** Numeric column */
  number(columnName?: string): ColumnBuilder<NumberColumn> {
    return makeColumn<NumberColumn>('number', columnName ?? null);
  },

  /** Boolean column */
  boolean(columnName?: string): ColumnBuilder<BooleanColumn> {
    return makeColumn<BooleanColumn>('boolean', columnName ?? null);
  },

  /** Date column (stored as epoch ms in the database) */
  date(columnName?: string): ColumnBuilder<DateColumn> {
    return makeColumn<DateColumn>('date', columnName ?? null);
  },

  /** Belongs-to relation (many-to-one). Adds a foreign key column. */
  belongsTo<S extends ModelSchema>(
    relatedSchema: () => S,
    opts: { key: string },
  ): BelongsToDescriptor<S> {
    return Object.freeze({
      kind: 'belongs_to' as const,
      foreignKey: opts.key,
      _relatedSchemaThunk: relatedSchema,
    });
  },

  /** Has-many relation (one-to-many). Query-only, no stored column. */
  hasMany<S extends ModelSchema>(
    relatedSchema: () => S,
    opts: { foreignKey: string },
  ): HasManyDescriptor<S> {
    return Object.freeze({
      kind: 'has_many' as const,
      foreignKey: opts.foreignKey,
      _relatedSchemaThunk: relatedSchema,
    });
  },

  /**
   * Define a model schema for the given table.
   *
   * Resolves all columns and relations, and returns a frozen ModelSchema
   * that carries full type information.
   */
  model<
    F extends Record<
      string,
      ColumnBuilder<ColumnDescriptor> | BelongsToDescriptor | HasManyDescriptor
    >,
  >(
    table: string,
    fields: F,
  ): ModelSchema<{
    [K in keyof F]: F[K] extends ColumnBuilder<infer D>
      ? D
      : F[K] extends FieldDescriptor
        ? F[K]
        : never;
  }> {
    const columns: ResolvedColumn[] = [];
    const relations: ResolvedRelation[] = [];
    const resolvedFields: Record<string, FieldDescriptor> = {};

    for (const [name, raw] of Object.entries(fields)) {
      const { column, relation } = resolveField(name, raw as any);
      if (column) columns.push(column);
      if (relation) relations.push(relation);

      // Store the resolved descriptor
      resolvedFields[name] = isColumnBuilder(raw) ? raw.descriptor : raw;
    }

    const schema = {
      table,
      fields: resolvedFields,
      columns,
      relations,
    };

    return Object.freeze(schema) as any;
  },
};

export { ColumnBuilder as _ColumnBuilder };
