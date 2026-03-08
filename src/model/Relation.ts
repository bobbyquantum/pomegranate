/**
 * Relation wrappers — lazy handles for fetching/observing related records.
 *
 * These are thin facades over Collection primitives. They are created on-demand
 * by Model.belongsTo() and Model.hasMany() and carry the related schema type
 * so TypeScript can infer the related model.
 */

import type {
  ModelSchema,
  BelongsToRelation,
  HasManyRelation,
  ModelInstance,
} from '../schema/types';
import type { Observable } from '../observable/Subject';

const noop = () => {};

// ─── Database resolver interface ────────────────────────────────────────────

/**
 * Minimal interface a relation needs to reach the database.
 * Avoids importing Database directly (circular dep).
 */
export interface RelationDatabaseRef {
  _findById(table: string, id: string): Promise<ModelInstance | null>;
  _observeById(table: string, id: string): Observable<ModelInstance | null>;
  _fetchRelated(table: string, foreignKey: string, id: string): Promise<ModelInstance[]>;
  _observeRelated(table: string, foreignKey: string, id: string): Observable<ModelInstance[]>;
}

// ─── BelongsToRelationImpl ──────────────────────────────────────────────────

export class BelongsToRelationImpl<S extends ModelSchema = ModelSchema>
  implements BelongsToRelation<S>
{
  private _getFkValue: () => string | null;
  private _relatedSchemaThunk: () => S;
  private _db: RelationDatabaseRef;

  constructor(
    getFkValue: () => string | null,
    relatedSchemaThunk: () => S,
    db: RelationDatabaseRef,
  ) {
    this._getFkValue = getFkValue;
    this._relatedSchemaThunk = relatedSchemaThunk;
    this._db = db;
  }

  get id(): string | null {
    return this._getFkValue();
  }

  async fetch(): Promise<ModelInstance<S> | null> {
    const fk = this._getFkValue();
    if (!fk) return null;
    const table = this._relatedSchemaThunk().table;
    return this._db._findById(table, fk) as Promise<ModelInstance<S> | null>;
  }

  observe(): Observable<ModelInstance<S> | null> {
    const fk = this._getFkValue();
    if (!fk) {
      return {
        subscribe: (listener) => {
          listener(null);
          return noop;
        },
      };
    }
    const table = this._relatedSchemaThunk().table;
    return this._db._observeById(table, fk) as Observable<ModelInstance<S> | null>;
  }
}

// ─── HasManyRelationImpl ────────────────────────────────────────────────────

export class HasManyRelationImpl<S extends ModelSchema = ModelSchema>
  implements HasManyRelation<S>
{
  private _ownerId: string;
  private _foreignKey: string;
  private _relatedSchemaThunk: () => S;
  private _db: RelationDatabaseRef;

  constructor(
    ownerId: string,
    foreignKey: string,
    relatedSchemaThunk: () => S,
    db: RelationDatabaseRef,
  ) {
    this._ownerId = ownerId;
    this._foreignKey = foreignKey;
    this._relatedSchemaThunk = relatedSchemaThunk;
    this._db = db;
  }

  async fetch(): Promise<ModelInstance<S>[]> {
    const table = this._relatedSchemaThunk().table;
    return this._db._fetchRelated(table, this._foreignKey, this._ownerId) as Promise<
      ModelInstance<S>[]
    >;
  }

  observe(): Observable<ModelInstance<S>[]> {
    const table = this._relatedSchemaThunk().table;
    return this._db._observeRelated(table, this._foreignKey, this._ownerId) as Observable<
      ModelInstance<S>[]
    >;
  }
}
