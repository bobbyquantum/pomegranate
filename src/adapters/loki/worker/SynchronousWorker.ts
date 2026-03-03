/**
 * Synchronous Worker.
 *
 * Simulates the Web Worker API entirely in-process. Used for:
 * - Testing the worker message protocol without actual threading
 * - Environments where Web Workers are not available (e.g. Node.js tests)
 *
 * Internally creates a LokiExecutor and processes messages sequentially,
 * cloning data via JSON round-trip to simulate structured cloning.
 */

import { LokiExecutor } from './LokiExecutor';
import type {
  WorkerAction,
  WorkerResponse,
  WorkerResult,
  WorkerSetupPayload,
  WorkerInterface,
} from './types';
import type { DatabaseSchema } from '../../../schema/types';

export class SynchronousWorker implements WorkerInterface {
  onmessage: ((event: { data: unknown }) => void) | null = null;

  private _executor: LokiExecutor | null = null;
  private _queue: WorkerAction[] = [];
  private _isProcessing = false;

  postMessage(data: unknown): void {
    // Clone the data to simulate structured cloning across worker boundary
    const action = JSON.parse(JSON.stringify(data)) as WorkerAction;
    this._queue.push(action);
    if (!this._isProcessing) {
      void this._processNext();
    }
  }

  terminate(): void {
    this._queue = [];
    this._executor = null;
  }

  private async _processNext(): Promise<void> {
    if (this._queue.length === 0) {
      this._isProcessing = false;
      return;
    }

    this._isProcessing = true;
    const action = this._queue[0];

    let result: WorkerResult;

    try {
      if (action.type === 'setUp') {
        const [setupPayload, schema] = action.payload as [WorkerSetupPayload, DatabaseSchema];
        this._executor = new LokiExecutor({
          databaseName: setupPayload.databaseName,
          saveStrategy: setupPayload.saveStrategy,
          autosaveInterval: setupPayload.autosaveInterval,
        });
        await this._executor.initialize(schema);
        result = { value: undefined };
      } else if (this._executor) {
        const method = (this._executor as any)[action.type];
        if (typeof method !== 'function') {
          throw new TypeError(`Unknown command: ${action.type}`);
        }
        const value = await method.call(this._executor, ...action.payload);
        result = { value };
      } else {
        throw new Error('Worker not initialized — call setUp first');
      }
    } catch (error_: unknown) {
      const error = error_ instanceof Error ? error_ : new Error(String(error_));
      result = { error: { message: error.message, stack: error.stack } };
    }

    const response: WorkerResponse = { id: action.id, result };
    // Clone the response to simulate structured cloning
    const clonedResponse = JSON.parse(JSON.stringify(response)) as WorkerResponse;
    this.onmessage?.({ data: clonedResponse });

    this._queue.shift();
    await this._processNext();
  }
}
