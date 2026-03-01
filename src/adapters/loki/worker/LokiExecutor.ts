/**
 * LokiJS Executor.
 *
 * Contains all actual database operations using LokiJS.
 * Runs either in the main thread (direct mode) or inside a Web Worker.
 */

import type { Migration } from '../../types';
import type {
  QueryDescriptor,
  SearchDescriptor,
  BatchOperation,
  Condition,
  WhereClause,
  ComparisonOperator,
} from '../../../query/types';
import type { DatabaseSchema, RawRecord } from '../../../schema/types';

// ─── Loki Types ───────────────────────────────────────────────────────────

interface LokiCollection<T extends object = any> {
  insert(doc: T): T;
  findOne(query: object): T | null;
  find(query?: object): T[];
  update(doc: T): void;
  remove(doc: T | T[]): void;
  count(query?: object): number;
  chain(): LokiResultset<T>;
  clear(): void;
}

interface LokiResultset<T extends object = any> {
  find(query: object): LokiResultset<T>;
  where(fn: (doc: T) => boolean): LokiResultset<T>;
  simplesort(field: string, options?: { desc?: boolean }): LokiResultset<T>;
  offset(n: number): LokiResultset<T>;
  limit(n: number): LokiResultset<T>;
  data(): T[];
  count(): number;
}

interface LokiDb {
  addCollection<T extends object>(name: string, options?: object): LokiCollection<T>;
  getCollection<T extends object>(name: string): LokiCollection<T> | null;
  removeCollection(name: string): void;
  listCollections(): Array<{ name: string }>;
  saveDatabase(callback?: (err: unknown) => void): void;
  close(callback?: () => void): void;
}

// ─── Executor Config ──────────────────────────────────────────────────────

export interface LokiExecutorConfig {
  databaseName: string;
  saveStrategy?: 'immediate' | 'auto';
  autosaveInterval?: number;
  /** Pre-constructed persistence adapter (direct mode only, not serializable). */
  persistenceAdapter?: unknown;
  /** Pre-constructed LokiJS instance (direct mode only, not serializable). */
  lokiInstance?: LokiDb;
}

// ─── LokiJS Executor ─────────────────────────────────────────────────────

export class LokiExecutor {
  private _db: LokiDb | null = null;
  private _config: LokiExecutorConfig;
  private _schemaVersion = 0;
  private _initialized = false;

  constructor(config: LokiExecutorConfig) {
    this._config = config;
  }

  // ─── Initialize ──────────────────────────────────────────────────────

  async initialize(schema: DatabaseSchema): Promise<void> {
    if (this._initialized) return;

    if (this._config.lokiInstance) {
      this._db = this._config.lokiInstance;
    } else {
      this._db = await this._createLokiDb();
    }

    let metaCollection = this._db.getCollection('__pomegranate_metadata');
    if (!metaCollection) {
      metaCollection = this._db.addCollection('__pomegranate_metadata', { unique: ['key'] as any });
    }

    const versionDoc = metaCollection.findOne({ key: 'schema_version' } as any);
    const existingVersion = versionDoc ? Number.parseInt((versionDoc as any).value, 10) : 0;

    if (existingVersion === 0) {
      for (const table of schema.tables) {
        if (!this._db.getCollection(table.name)) {
          const indices = table.columns.filter((c) => c.isIndexed).map((c) => c.name);
          this._db.addCollection(table.name, {
            unique: ['id'] as any,
            indices: ['_status', ...indices] as any,
          });
        }
      }

      const existing = metaCollection.findOne({ key: 'schema_version' } as any);
      if (existing) {
        (existing as any).value = String(schema.version);
        metaCollection.update(existing);
      } else {
        metaCollection.insert({ key: 'schema_version', value: String(schema.version) } as any);
      }
    }

    this._schemaVersion = schema.version;
    this._initialized = true;
  }

  private async _createLokiDb(): Promise<LokiDb> {
    const { default: Loki } = await import('lokijs');

    const hasPersistence = !!this._config.persistenceAdapter;
    const options: Record<string, unknown> = {};

    if (hasPersistence) {
      options.adapter = this._config.persistenceAdapter;
      const strategy = this._config.saveStrategy ?? 'immediate';
      if (strategy === 'auto') {
        options.autosave = true;
        options.autosaveinterval = this._config.autosaveInterval ?? 500;
      }
    }

    return new Promise<LokiDb>((resolve, reject) => {
      if (hasPersistence) {
        options.autoload = true;
        options.autoloadCallback = (err: unknown) => {
          if (err) reject(err);
          else resolve(db as LokiDb);
        };
      }

      const db = new Loki(this._config.databaseName || 'pomegranate.db', options);

      if (!hasPersistence) {
        resolve(db as LokiDb);
      }
    });
  }

  private _getCollection(table: string): LokiCollection {
    if (!this._db) throw new Error('Database not initialized');
    const col = this._db.getCollection(table);
    if (!col) throw new Error(`Collection "${table}" not found`);
    return col;
  }

  /**
   * Persist to storage adapter.
   * No-op when: no persistence configured, or saveStrategy is 'auto' (timer handles it).
   */
  private async _save(): Promise<void> {
    if (!this._db || !this._config.persistenceAdapter) return;
    if ((this._config.saveStrategy ?? 'immediate') !== 'immediate') return;
    return new Promise<void>((resolve, reject) => {
      this._db!.saveDatabase((err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ─── Core sync operations (for batch optimization) ──────────────────

  private _doInsert(table: string, raw: RawRecord): void {
    const col = this._getCollection(table);
    col.insert({ ...raw } as any);
  }

  private _doUpdate(table: string, raw: RawRecord): void {
    const col = this._getCollection(table);
    const existing = col.findOne({ id: raw.id } as any);
    if (!existing) throw new Error(`Record not found: ${table}/${raw.id}`);
    for (const [key, value] of Object.entries(raw)) {
      (existing as any)[key] = value;
    }
    col.update(existing);
  }

  private _doMarkAsDeleted(table: string, id: string): void {
    const col = this._getCollection(table);
    const doc = col.findOne({ id } as any);
    if (doc) {
      (doc as any)._status = 'deleted';
      col.update(doc);
    }
  }

  private _doDestroyPermanently(table: string, id: string): void {
    const col = this._getCollection(table);
    const doc = col.findOne({ id } as any);
    if (doc) {
      col.remove(doc);
    }
  }

  // ─── Query ──────────────────────────────────────────────────────────

  async find(query: QueryDescriptor): Promise<RawRecord[]> {
    const col = this._getCollection(query.table);
    let chain = col.chain();

    if (query.conditions.length > 0) {
      const lokiQuery = conditionsToLoki(query.conditions);
      chain = chain.find(lokiQuery);
    }

    for (const ob of query.orderBy) {
      chain = chain.simplesort(ob.column, { desc: ob.order === 'desc' });
    }

    if (query.offset !== undefined) {
      chain = chain.offset(query.offset);
    }
    if (query.limit !== undefined) {
      chain = chain.limit(query.limit);
    }

    return stripLokiMeta(chain.data()) as RawRecord[];
  }

  async count(query: QueryDescriptor): Promise<number> {
    const col = this._getCollection(query.table);

    if (query.conditions.length > 0) {
      const lokiQuery = conditionsToLoki(query.conditions);
      return col.chain().find(lokiQuery).count();
    }

    return col.count();
  }

  async findById(table: string, id: string): Promise<RawRecord | null> {
    const col = this._getCollection(table);
    const doc = col.findOne({ id } as any);
    return doc ? (stripLokiMetaSingle(doc) as RawRecord) : null;
  }

  // ─── Insert / Update / Delete ────────────────────────────────────────

  async insert(table: string, raw: RawRecord): Promise<void> {
    this._doInsert(table, raw);
    await this._save();
  }

  async update(table: string, raw: RawRecord): Promise<void> {
    this._doUpdate(table, raw);
    await this._save();
  }

  async markAsDeleted(table: string, id: string): Promise<void> {
    this._doMarkAsDeleted(table, id);
    await this._save();
  }

  async destroyPermanently(table: string, id: string): Promise<void> {
    this._doDestroyPermanently(table, id);
    await this._save();
  }

  // ─── Batch (single save at end) ─────────────────────────────────────

  async batch(operations: BatchOperation[]): Promise<void> {
    for (const op of operations) {
      switch (op.type) {
        case 'create':
          this._doInsert(op.table, op.rawRecord as RawRecord);
          break;
        case 'update':
          this._doUpdate(op.table, op.rawRecord as RawRecord);
          break;
        case 'delete':
          this._doMarkAsDeleted(op.table, op.id!);
          break;
        case 'destroyPermanently':
          this._doDestroyPermanently(op.table, op.id!);
          break;
      }
    }
    await this._save();
  }

  // ─── Search ──────────────────────────────────────────────────────────

  async search(descriptor: SearchDescriptor): Promise<{ records: RawRecord[]; total: number }> {
    const col = this._getCollection(descriptor.table);
    const term = descriptor.term.toLowerCase();

    let results = col.chain().where((doc: any) => {
      return descriptor.fields.some((field) => {
        const val = doc[field];
        return typeof val === 'string' && val.toLowerCase().includes(term);
      });
    });

    if (descriptor.conditions.length > 0) {
      const lokiQuery = conditionsToLoki(descriptor.conditions);
      results = results.find(lokiQuery);
    }

    const total = results.count();

    for (const ob of descriptor.orderBy) {
      results = results.simplesort(ob.column, { desc: ob.order === 'desc' });
    }

    const data = results.offset(descriptor.offset).limit(descriptor.limit).data();

    return {
      records: stripLokiMeta(data) as RawRecord[],
      total,
    };
  }

  // ─── Sync helpers ──────────────────────────────────────────────────

  async getLocalChanges(
    tables: string[],
  ): Promise<Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>> {
    const result: Record<
      string,
      { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }
    > = {};

    for (const table of tables) {
      const col = this._getCollection(table);
      const created = col.find({ _status: 'created' } as any);
      const updated = col.find({ _status: 'updated' } as any);
      const deleted = col.find({ _status: 'deleted' } as any);

      result[table] = {
        created: stripLokiMeta(created) as RawRecord[],
        updated: stripLokiMeta(updated) as RawRecord[],
        deleted: deleted.map((d: any) => d.id),
      };
    }

    return result;
  }

  async applyRemoteChanges(
    changes: Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>,
  ): Promise<void> {
    for (const [table, tableChanges] of Object.entries(changes)) {
      const col = this._getCollection(table);

      for (const raw of tableChanges.created) {
        const existing = col.findOne({ id: raw.id } as any);
        if (existing) {
          for (const [key, value] of Object.entries(raw)) {
            (existing as any)[key] = value;
          }
          (existing as any)._status = 'synced';
          (existing as any)._changed = '';
          col.update(existing);
        } else {
          col.insert({ ...raw, _status: 'synced', _changed: '' } as any);
        }
      }

      for (const raw of tableChanges.updated) {
        const existing = col.findOne({ id: raw.id } as any);
        if (existing) {
          for (const [key, value] of Object.entries(raw)) {
            (existing as any)[key] = value;
          }
          (existing as any)._status = 'synced';
          (existing as any)._changed = '';
          col.update(existing);
        } else {
          col.insert({ ...raw, _status: 'synced', _changed: '' } as any);
        }
      }

      for (const id of tableChanges.deleted) {
        const doc = col.findOne({ id } as any);
        if (doc) col.remove(doc);
      }
    }
  }

  async markAsSynced(table: string, ids: string[]): Promise<void> {
    const col = this._getCollection(table);
    for (const id of ids) {
      const doc = col.findOne({ id } as any);
      if (doc) {
        (doc as any)._status = 'synced';
        (doc as any)._changed = '';
        col.update(doc);
      }
    }
  }

  // ─── Schema version ──────────────────────────────────────────────────

  async getSchemaVersion(): Promise<number> {
    return this._schemaVersion;
  }

  // ─── Migration ──────────────────────────────────────────────────────

  async migrate(migrations: Migration[]): Promise<void> {
    for (const migration of migrations) {
      for (const step of migration.steps) {
        switch (step.type) {
          case 'createTable':
            if (!this._db!.getCollection(step.schema.name)) {
              this._db!.addCollection(step.schema.name, { unique: ['id'] as any });
            }
            break;
          case 'destroyTable':
            this._db!.removeCollection(step.table);
            break;
        }
      }
    }
  }

  // ─── Reset ──────────────────────────────────────────────────────────

  async reset(): Promise<void> {
    if (!this._db) return;
    const collections = this._db.listCollections();
    for (const col of collections) {
      const collection = this._db.getCollection(col.name);
      if (collection) collection.clear();
    }
    this._initialized = false;
  }

  // ─── Close ──────────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this._db) {
      await new Promise<void>((resolve) => {
        this._db!.close(() => resolve());
      });
    }
  }
}

// ─── Loki Query Translation ──────────────────────────────────────────────

function conditionsToLoki(conditions: readonly Condition[]): object {
  if (conditions.length === 1) {
    return conditionToLoki(conditions[0]);
  }
  return { $and: conditions.map(conditionToLoki) };
}

function conditionToLoki(condition: Condition): object {
  switch (condition.type) {
    case 'where': {
      const w = condition as WhereClause;
      return { [w.column]: operatorToLoki(w.operator, w.value) };
    }
    case 'and':
      return { $and: (condition as any).conditions.map(conditionToLoki) };
    case 'or':
      return { $or: (condition as any).conditions.map(conditionToLoki) };
    case 'not': {
      const inner = conditionToLoki((condition as any).condition);
      const negated: Record<string, any> = {};
      for (const [key, val] of Object.entries(inner)) {
        if (typeof val === 'object' && val !== null) {
          negated[key] = { $not: val };
        } else {
          negated[key] = { $ne: val };
        }
      }
      return negated;
    }
    default:
      throw new Error(`Unknown condition type: ${(condition as any).type}`);
  }
}

function operatorToLoki(op: ComparisonOperator, value: unknown): any {
  const normalizedValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;

  switch (op) {
    case 'eq':
      return { $eq: normalizedValue };
    case 'neq':
      return { $ne: normalizedValue };
    case 'gt':
      return { $gt: normalizedValue };
    case 'gte':
      return { $gte: normalizedValue };
    case 'lt':
      return { $lt: normalizedValue };
    case 'lte':
      return { $lte: normalizedValue };
    case 'in':
      return {
        $in: Array.isArray(value)
          ? value.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v))
          : value,
      };
    case 'notIn':
      return {
        $nin: Array.isArray(value)
          ? value.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v))
          : value,
      };
    case 'like':
      return { $regex: new RegExp(String(value).replaceAll('%', '.*').replaceAll('_', '.'), 'i') };
    case 'notLike':
      return {
        $not: { $regex: new RegExp(String(value).replaceAll('%', '.*').replaceAll('_', '.'), 'i') },
      };
    case 'between': {
      const [low, high] = value as [unknown, unknown];
      return { $between: [low, high] };
    }
    case 'isNull':
      return { $eq: null };
    case 'isNotNull':
      return { $ne: null };
    default:
      throw new Error(`Unknown operator: ${op}`);
  }
}

// ─── Strip LokiJS internal metadata ($loki, meta) ────────────────────────

function stripLokiMeta(docs: any[]): Record<string, unknown>[] {
  return docs.map(stripLokiMetaSingle);
}

function stripLokiMetaSingle(doc: any): Record<string, unknown> {
  const { $loki, meta, ...rest } = doc;
  return rest;
}
