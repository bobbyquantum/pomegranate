/**
 * LokiJS Adapter.
 *
 * In-memory database adapter using LokiJS, suitable for web and testing.
 * Supports running LokiJS in a Web Worker for better UI performance.
 *
 * Architecture:
 * - Direct mode (default): LokiExecutor runs in the main thread.
 * - Worker mode: All operations are dispatched via postMessage to a Web Worker
 *   (or SynchronousWorker for testing) that runs LokiExecutor internally.
 *
 * ```
 * LokiAdapter  ──▶  LokiExecutor (direct mode)
 *       │
 *       └──▶  LokiDispatcher  ──▶  [Worker]  ──▶  LokiExecutor (worker mode)
 * ```
 */

import type { StorageAdapter, AdapterConfig, Migration } from '../types';
import type { QueryDescriptor, SearchDescriptor, BatchOperation } from '../../query/types';
import type { DatabaseSchema, RawRecord } from '../../schema/types';
import type { WorkerCommandType, WorkerInterface } from './worker/types';
import { LokiExecutor, type LokiExecutorConfig } from './worker/LokiExecutor';
import { LokiDispatcher } from './worker/LokiDispatcher';

// ─── LokiJS Adapter Config ──────────────────────────────────────────────

export interface LokiAdapterConfig extends AdapterConfig {
  /** Optional: provide your own Loki instance (direct mode only, not serializable). */
  lokiInstance?: unknown;
  /** Optional: LokiJS persistence adapter (e.g., IncrementalIndexedDBAdapter). Direct mode only. */
  persistenceAdapter?: unknown;
  /**
   * When to persist data to storage. Only applies when `persistenceAdapter` is set
   * (direct mode) or when running in a worker (which auto-creates IndexedDB persistence).
   *
   * - `'immediate'` — save after every mutation. Safest; data survives instant refresh.
   *   Slightly slower for rapid writes. **(default)**
   * - `'auto'` — use LokiJS autosave timer (`autosaveInterval` ms). Faster for bulk
   *   writes but data written in the last interval may be lost on hard refresh.
   */
  saveStrategy?: 'immediate' | 'auto';
  /** Autosave interval in ms when `saveStrategy: 'auto'`. Default: 500. */
  autosaveInterval?: number;
  /**
   * Web Worker instance for off-main-thread LokiJS execution.
   * When provided, all database operations dispatch to this worker via postMessage.
   * The worker auto-creates IncrementalIDBAdapter for IndexedDB persistence.
   *
   * @example
   * // Real Web Worker (bundler must support worker URLs):
   * import { LokiAdapter } from 'pomegranate-db';
   * const worker = new Worker(
   *   new URL('pomegranate-db/dist/adapters/loki/worker/loki.worker.js', import.meta.url),
   * );
   * const adapter = new LokiAdapter({ databaseName: 'app', worker });
   *
   * @example
   * // Synchronous fallback (for testing the worker protocol):
   * import { LokiAdapter, SynchronousWorker } from 'pomegranate-db';
   * const adapter = new LokiAdapter({ databaseName: 'test', worker: new SynchronousWorker() });
   */
  worker?: WorkerInterface | Worker;
}

// Re-export for consumers
export type { LokiExecutorConfig };

// ─── LokiJS Adapter ──────────────────────────────────────────────────────

export class LokiAdapter implements StorageAdapter {
  private _executor: LokiExecutor | null = null;
  private _dispatcher: LokiDispatcher | null = null;
  private _config: LokiAdapterConfig;
  private _initialized = false;

  constructor(config: LokiAdapterConfig) {
    this._config = config;
    if (config.worker) {
      this._dispatcher = new LokiDispatcher(config.worker as WorkerInterface);
    }
  }

  // ─── Initialize ──────────────────────────────────────────────────────

  async initialize(schema: DatabaseSchema): Promise<void> {
    if (this._initialized) return;

    if (this._dispatcher) {
      // Worker mode: send serializable config + schema to the worker
      await this._dispatcher.call('setUp', [
        {
          databaseName: this._config.databaseName,
          saveStrategy: this._config.saveStrategy,
          autosaveInterval: this._config.autosaveInterval,
        },
        schema,
      ]);
    } else {
      // Direct mode: create executor locally
      this._executor = new LokiExecutor({
        databaseName: this._config.databaseName,
        saveStrategy: this._config.saveStrategy,
        autosaveInterval: this._config.autosaveInterval,
        persistenceAdapter: this._config.persistenceAdapter,
        lokiInstance: this._config.lokiInstance as any,
      });
      await this._executor.initialize(schema);
    }

    this._initialized = true;
  }

  // ─── Delegation helper ──────────────────────────────────────────────

  /**
   * Route a command to either the local executor or the remote worker.
   * In worker mode, arguments are serialized via postMessage (structured cloning).
   * In direct mode, the executor method is called directly.
   */
  private _call<T>(method: WorkerCommandType, args: unknown[]): Promise<T> {
    if (this._dispatcher) {
      return this._dispatcher.call(method, args) as Promise<T>;
    }
    if (!this._executor) throw new Error('Database not initialized');
    return (this._executor as any)[method](...args);
  }

  // ─── Query ──────────────────────────────────────────────────────────

  async find(query: QueryDescriptor): Promise<RawRecord[]> {
    return this._call('find', [query]);
  }

  async count(query: QueryDescriptor): Promise<number> {
    return this._call('count', [query]);
  }

  async findById(table: string, id: string): Promise<RawRecord | null> {
    return this._call('findById', [table, id]);
  }

  // ─── Insert / Update / Delete ────────────────────────────────────────

  async insert(table: string, raw: RawRecord): Promise<void> {
    return this._call('insert', [table, raw]);
  }

  async update(table: string, raw: RawRecord): Promise<void> {
    return this._call('update', [table, raw]);
  }

  async markAsDeleted(table: string, id: string): Promise<void> {
    return this._call('markAsDeleted', [table, id]);
  }

  async destroyPermanently(table: string, id: string): Promise<void> {
    return this._call('destroyPermanently', [table, id]);
  }

  // ─── Batch ──────────────────────────────────────────────────────────

  async batch(operations: BatchOperation[]): Promise<void> {
    return this._call('batch', [operations]);
  }

  // ─── Search ──────────────────────────────────────────────────────────

  async search(descriptor: SearchDescriptor): Promise<{ records: RawRecord[]; total: number }> {
    return this._call('search', [descriptor]);
  }

  // ─── Sync helpers ──────────────────────────────────────────────────

  async getLocalChanges(
    tables: string[],
  ): Promise<Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>> {
    return this._call('getLocalChanges', [tables]);
  }

  async applyRemoteChanges(
    changes: Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>,
  ): Promise<void> {
    return this._call('applyRemoteChanges', [changes]);
  }

  async markAsSynced(table: string, ids: string[]): Promise<void> {
    return this._call('markAsSynced', [table, ids]);
  }

  // ─── Schema version ──────────────────────────────────────────────────

  async getSchemaVersion(): Promise<number> {
    return this._call('getSchemaVersion', []);
  }

  // ─── Migration ──────────────────────────────────────────────────────

  async migrate(migrations: Migration[]): Promise<void> {
    return this._call('migrate', [migrations]);
  }

  // ─── Reset ──────────────────────────────────────────────────────────

  async reset(): Promise<void> {
    return this._call('reset', []);
  }

  // ─── Close ──────────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this._dispatcher) {
      await this._dispatcher.call('close', []);
      this._dispatcher.terminate();
    } else if (this._executor) {
      await this._executor.close();
    }
    this._initialized = false;
  }
}
