/**
 * WatermelonDB-shaped `Model` and `Relation`.
 *
 * The compat `Model` extends the core `Model` and adds mutator-style
 * `update()` / `create()` capture: inside a mutator, `setField()` stages a
 * value and `getField()` reflects it; when the mutator finishes the staged
 * values are written through the core `update(patch)`.
 */

import { Model as CoreModel } from '../model/Model';
import type { ModelAssociation, ModelAssociations, ModelCollectionRef } from '../model/Model';
import type { ModelSchema, RawRecord } from '../schema/types';
import type { Unsubscribe } from '../observable/Subject';
import { Q } from './Q';
import type { Query } from './Query';
import type { Collection } from './Collection';
import type { Database } from './Database';
import { WatermelonObservable } from './observable';
import { compatCollectionFor } from './registry';

export type Associations = ModelAssociations;
export type { ModelAssociation };

export type Mutator<M> = (record: M) => void | Promise<void>;

export class Model<S extends ModelSchema = ModelSchema> extends CoreModel<S> {
  /** WatermelonDB's static table name (informational; the schema's table is authoritative). */
  static table: string;

  /** The compat collection (the core collection when used outside a compat `Database`). */
  declare readonly collection: Collection<this>;

  #capture: Map<string, unknown> | null = null;

  constructor(collection: ModelCollectionRef, raw: RawRecord) {
    super(collection, raw);
    const compat = compatCollectionFor(collection);
    if (compat) (this as { collection: ModelCollectionRef }).collection = compat;
  }

  // ─── WatermelonDB accessors ────────────────────────────────────────────

  /** The raw row as stored (pending mutator values are not reflected). */
  get _raw(): RawRecord {
    return this._rawRecord;
  }

  get asModel(): this {
    return this;
  }

  get table(): string {
    return this.collection.table;
  }

  get database(): Database {
    const database = (this.collection as Partial<Collection>).database;
    if (!database) {
      throw new Error(
        `Record of table "${this.collection.table}" is not attached to a pomegranate-db/watermelon Database`,
      );
    }
    return database;
  }

  get collections(): Database['collections'] {
    return this.database.collections;
  }

  // ─── Fields ────────────────────────────────────────────────────────────

  getField(fieldName: string): unknown {
    if (this.#capture?.has(fieldName)) return this.#capture.get(fieldName);
    return super.getField(fieldName);
  }

  /** Stage a field value. Only allowed inside `update()` / `create()` mutators. */
  setField(fieldName: string, value: unknown): void {
    if (!this.#capture) {
      throw new Error('Cannot modify a record outside of update()/create()');
    }
    const schema = (this.constructor as typeof CoreModel).schema;
    const known =
      schema.columns.some((col) => col.fieldName === fieldName) ||
      schema.relations.some((rel) => rel.fieldName === fieldName && rel.kind === 'belongs_to');
    if (!known) {
      throw new Error(`Unknown field "${fieldName}" on table "${schema.table}"`);
    }
    this.#capture.set(fieldName, value);
  }

  /** @internal Run a mutator in capture mode and return the staged patch (by field name). */
  async _captureMutations(mutator?: Mutator<this>): Promise<Record<string, unknown>> {
    if (this.#capture) {
      throw new Error('Nested update()/create() on the same record is not supported');
    }
    this.#capture = new Map();
    try {
      await mutator?.(this);
      return Object.fromEntries(this.#capture);
    } finally {
      this.#capture = null;
    }
  }

  // ─── Mutations ─────────────────────────────────────────────────────────

  /**
   * Update this record. Accepts a WatermelonDB mutator (`record => { … }`)
   * or a core-style patch keyed by field name. Must be inside `write()`.
   */
  async update(mutatorOrPatch?: Mutator<this> | Record<string, unknown>): Promise<void> {
    this.collection._getDatabase()._ensureInWriter('Model.update()');
    if (typeof mutatorOrPatch === 'function') {
      const patch = await this._captureMutations(mutatorOrPatch);
      await super.update(patch);
      return;
    }
    await super.update(mutatorOrPatch ?? {});
  }

  // ─── Observation ───────────────────────────────────────────────────────

  observe(): WatermelonObservable<this> {
    return WatermelonObservable.from(super.observe());
  }

  // ─── Relations ─────────────────────────────────────────────────────────

  /**
   * The records of `table` whose foreign key points at this record, per
   * this class's `static associations[table]` (`has_many`).
   */
  children<T extends Model = Model>(table: string): Query<T> {
    const association = associationFor(this.constructor as typeof Model, table);
    if (association.type !== 'has_many') {
      throw new Error(
        `Association from "${this.table}" to "${table}" is ${association.type}; children() needs has_many`,
      );
    }
    return this.database.collections.get<T>(table).query(Q.where(association.foreignKey, this.id));
  }

  /** A belongs-to handle for the record of `table` referenced by column `key`. */
  relation<T extends Model = Model>(table: string, key: string): Relation<T> {
    return new Relation<T>(this, table, key);
  }
}

function associationFor(modelClass: typeof Model, table: string): ModelAssociation {
  const association = modelClass.associations?.[table];
  if (!association) {
    throw new Error(
      `No association from "${modelClass.schema.table}" to "${table}" — declare it in static associations`,
    );
  }
  return association;
}

// ─── Relation ──────────────────────────────────────────────────────────────

export class Relation<T extends Model = Model> {
  readonly table: string;
  readonly key: string;
  readonly #owner: Model;
  readonly #fieldName: string;

  constructor(owner: Model, table: string, key: string) {
    this.#owner = owner;
    this.table = table;
    this.key = key;
    this.#fieldName = fieldNameForColumn(owner, key);
  }

  /** The current foreign key value (reflects pending mutator values). */
  get id(): string | null {
    return (this.#owner.getField(this.#fieldName) as string | null | undefined) ?? null;
  }

  set id(value: string | null) {
    this.#owner.setField(this.#fieldName, value);
  }

  /** Stage the foreign key to `record` (or null). Only inside `update()` / `create()`. */
  set(record: T | null): void {
    this.id = record?.id ?? null;
  }

  /** Fetch the related record; null when the key is null, rejects when it is dangling. */
  async fetch(): Promise<T | null> {
    const id = this.id;
    if (!id) return null;
    return this.#owner.database.collections.get<T>(this.table).find(id);
  }

  /** Observe the related record, following changes to the foreign key. */
  observe(): WatermelonObservable<T | null> {
    return new WatermelonObservable<T | null>((observer) => {
      const collection = this.#owner.database.collections.get<T>(this.table);
      let cancelled = false;
      let inner: Unsubscribe | null = null;
      let currentId: string | null | undefined;

      const switchTo = (id: string | null) => {
        if (id === currentId) return;
        currentId = id;
        inner?.();
        inner = null;
        if (id === null) {
          observer.next(null);
          return;
        }
        inner = collection.findAndObserve(id).subscribe({
          next: observer.next,
          error: observer.error,
        });
      };

      const ownerUnsubscribe = this.#owner.observe().subscribe(() => {
        if (!cancelled) switchTo(this.id);
      });

      return () => {
        cancelled = true;
        ownerUnsubscribe();
        inner?.();
      };
    });
  }
}

function fieldNameForColumn(owner: Model, column: string): string {
  const schema = (owner.constructor as typeof CoreModel).schema;
  const col = schema.columns.find((c) => c.columnName === column);
  if (col) return col.fieldName;
  const relation = schema.relations.find((r) => r.kind === 'belongs_to' && r.foreignKey === column);
  if (relation) return relation.fieldName;
  throw new Error(`Column "${column}" is not declared on table "${schema.table}"`);
}
