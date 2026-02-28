/**
 * Model base class.
 *
 * Each model instance represents a single database record.
 * Models are schema-first: the schema defines columns, relations,
 * and the TypeScript types are inferred from it.
 *
 * Usage:
 *   class Post extends Model<typeof PostSchema> {
 *     static schema = PostSchema;
 *
 *     publish = this.writer(async () => {
 *       await this.update({ status: 'published' });
 *     });
 *   }
 */

import type {
  ModelSchema,
  SchemaFields,
  RawRecord,
  SyncStatus,
  InferUpdatePatch,
  ResolvedColumn,
} from '../schema/types';
import type { Subject } from '../observable/Subject';
import { BehaviorSubject } from '../observable/Subject';
import type { Observable } from '../observable/Subject';
import { generateId, dateToTimestamp, timestampToDate } from '../utils';

// ─── Forward declarations (avoid circular imports) ─────────────────────────

/** Minimal interface for what a Collection provides to a Model */
export interface ModelCollectionRef {
  readonly table: string;
  _update(id: string, raw: Partial<RawRecord>): Promise<void>;
  _delete(id: string): Promise<void>;
  _destroyPermanently(id: string): Promise<void>;
  _getDatabase(): ModelDatabaseRef;
}

/** Minimal interface for what a Database provides */
export interface ModelDatabaseRef {
  _ensureInWriter(action: string): void;
  _batch(
    operations: Array<{
      type: string;
      table: string;
      rawRecord?: Record<string, unknown>;
      id?: string;
    }>,
  ): Promise<void>;
}

// ─── Model class ───────────────────────────────────────────────────────────

export type ModelStatic<S extends ModelSchema = ModelSchema> = {
  new (collection: ModelCollectionRef, raw: RawRecord): Model<S>;
  schema: S;
};

export class Model<S extends ModelSchema = ModelSchema> {
  static schema: ModelSchema;

  /** The record id */
  readonly id: string;

  /** Reference back to the owning collection */
  readonly collection: ModelCollectionRef;

  /** The raw database row — ES private to avoid variance issues in generics */
  #raw: RawRecord;

  /**
   * Observable for record changes.
   * Typed as `BehaviorSubject<unknown>` to avoid TypeScript variance issues:
   * `BehaviorSubject<this>` causes invariant `Set<Listener<T>>` mismatches
   * when a subclass (e.g. Article) is assigned to `ModelStatic<Model>`.
   * The public API (`observe()`) still returns `Observable<this>`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #changes$: BehaviorSubject<any>;

  constructor(collection: ModelCollectionRef, raw: RawRecord) {
    this.collection = collection;
    this.#raw = raw;
    this.id = raw.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.#changes$ = new BehaviorSubject<any>(this);
  }

  // ─── Raw Access ────────────────────────────────────────────────────────

  /** Get the current raw record */
  get _rawRecord(): RawRecord {
    return this.#raw;
  }

  /** Sync status of this record */
  get syncStatus(): SyncStatus {
    return this.#raw._status;
  }

  /** Changed fields (comma-separated) */
  get changedFields(): string {
    return this.#raw._changed;
  }

  // ─── Field Accessors ──────────────────────────────────────────────────

  /**
   * Get a field value, converting from raw storage form.
   */
  getField(fieldName: string): unknown {
    const schema = (this.constructor as typeof Model).schema;
    const col = schema.columns.find((c) => c.fieldName === fieldName);
    if (!col) {
      // Check if it's a relation field name
      const rel = schema.relations.find((r) => r.fieldName === fieldName);
      if (rel && rel.kind === 'belongs_to') {
        return this.#raw[rel.foreignKey];
      }
      throw new Error(`Unknown field "${fieldName}" on table "${schema.table}"`);
    }

    const rawValue = this.#raw[col.columnName];
    return deserializeValue(col, rawValue);
  }

  /**
   * Set field value(s) on the raw record (does NOT persist — internal use).
   */
  _setRaw(updates: Partial<RawRecord>): void {
    this.#raw = { ...this.#raw, ...updates };
    this.#changes$.next(this);
  }

  // ─── Observable ──────────────────────────────────────────────────────

  /** Observe changes to this record */
  observe(): Observable<this> {
    return this.#changes$;
  }

  /** Observe a specific field */
  observeField(fieldName: string): Observable<unknown> {
    return {
      subscribe: (listener) => {
        let lastValue = this.getField(fieldName);
        // Emit initial value
        listener(lastValue);
        return this.#changes$.subscribe(() => {
          const newValue = this.getField(fieldName);
          if (newValue !== lastValue) {
            lastValue = newValue;
            listener(newValue);
          }
        });
      },
    };
  }

  // ─── Mutations ────────────────────────────────────────────────────────

  /**
   * Update this record with a patch of field values.
   * Must be called inside `db.write()`.
   */
  async update(patch: Record<string, unknown>): Promise<void> {
    this.collection._getDatabase()._ensureInWriter('Model.update()');

    const schema = (this.constructor as typeof Model).schema;
    const rawUpdates: Record<string, unknown> = {};
    const changedColumns: string[] = [];

    for (const [fieldName, value] of Object.entries(patch)) {
      const col = schema.columns.find((c) => c.fieldName === fieldName);
      if (col) {
        if (col.isReadonly) {
          throw new Error(`Cannot update readonly field "${fieldName}"`);
        }
        rawUpdates[col.columnName] = serializeValue(col, value);
        changedColumns.push(col.columnName);
      } else {
        // Check belongs_to
        const rel = schema.relations.find(
          (r) => r.fieldName === fieldName && r.kind === 'belongs_to',
        );
        if (rel) {
          rawUpdates[rel.foreignKey] = value;
          changedColumns.push(rel.foreignKey);
        } else {
          throw new Error(`Unknown field "${fieldName}" on table "${schema.table}"`);
        }
      }
    }

    // Track changed columns for sync
    const existingChanged = this.#raw._changed ? this.#raw._changed.split(',').filter(Boolean) : [];
    const allChanged = [...new Set([...existingChanged, ...changedColumns])];

    if (this.#raw._status === 'synced') {
      rawUpdates._status = 'updated' as SyncStatus;
    }
    rawUpdates._changed = allChanged.join(',');

    await this.collection._update(this.id, rawUpdates);
    this._setRaw(rawUpdates);
  }

  /**
   * Mark this record as deleted (soft delete for sync).
   * Must be called inside `db.write()`.
   */
  async markAsDeleted(): Promise<void> {
    this.collection._getDatabase()._ensureInWriter('Model.markAsDeleted()');
    await this.collection._delete(this.id);
    this._setRaw({ _status: 'deleted' as SyncStatus } as any);
  }

  /**
   * Permanently destroy this record.
   * Must be called inside `db.write()`.
   */
  async destroyPermanently(): Promise<void> {
    this.collection._getDatabase()._ensureInWriter('Model.destroyPermanently()');
    await this.collection._destroyPermanently(this.id);
  }

  // ─── Writer Helper ──────────────────────────────────────────────────

  /**
   * Create a bound writer method.
   * The returned function, when called, will run inside the current write transaction.
   */
  writer<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args) => {
      // Writer just delegates — the caller must already be inside db.write()
      return fn.apply(this, args);
    };
  }

  // ─── Prepare for sync ───────────────────────────────────────────────

  /**
   * Return raw values suitable for the sync push payload.
   */
  toPushPayload(): Record<string, unknown> {
    const { _status, _changed, ...rest } = this.#raw;
    return rest;
  }
}

// ─── Serialization Helpers ─────────────────────────────────────────────────

function serializeValue(col: ResolvedColumn, value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  switch (col.type) {
    case 'date':
      return dateToTimestamp(value as Date | number);
    case 'boolean':
      return value ? 1 : 0;
    default:
      return value;
  }
}

function deserializeValue(col: ResolvedColumn, rawValue: unknown): unknown {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }
  switch (col.type) {
    case 'date':
      return timestampToDate(rawValue as number);
    case 'boolean':
      return rawValue === 1 || rawValue === true;
    default:
      return rawValue;
  }
}

// ─── Create a raw record from a schema + patch ────────────────────────────

export function createRawRecord(
  schema: ModelSchema,
  patch: Record<string, unknown>,
  id?: string,
): RawRecord {
  const raw: Record<string, unknown> = {
    id: id ?? generateId(),
    _status: 'created',
    _changed: '',
  };

  for (const col of schema.columns) {
    const fieldName = col.fieldName;
    if (fieldName in patch) {
      raw[col.columnName] = serializeValue(col, patch[fieldName]);
    } else if (col.defaultValue !== undefined) {
      raw[col.columnName] = serializeValue(col, col.defaultValue);
    } else if (col.isOptional) {
      raw[col.columnName] = null;
    } else {
      // Default zero-values
      switch (col.type) {
        case 'text':
          raw[col.columnName] = '';
          break;
        case 'number':
          raw[col.columnName] = 0;
          break;
        case 'boolean':
          raw[col.columnName] = 0;
          break;
        case 'date':
          raw[col.columnName] = null;
          break;
      }
    }
  }

  return raw as RawRecord;
}
