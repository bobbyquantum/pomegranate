/**
 * LokiJS Web Worker entry point.
 *
 * Minimal bootstrap — creates a LokiExecutor and processes commands
 * sequentially via the message queue. Designed to be loaded as a
 * Web Worker by the browser's Worker constructor.
 *
 * @example
 * // In your app (bundler must support worker URLs):
 * const worker = new Worker(
 *   new URL('pomegranate-db/dist/adapters/loki/worker/loki.worker.js', import.meta.url),
 * );
 */

import { LokiExecutor } from './LokiExecutor';
import type { WorkerAction, WorkerResponse, WorkerResult, WorkerSetupPayload } from './types';
import type { DatabaseSchema } from '../../../schema/types';

const ctx: any = self;

let executor: LokiExecutor | null = null;
const actionQueue: WorkerAction[] = [];
let isProcessing = false;

ctx.onmessage = (event: MessageEvent<WorkerAction>) => {
  actionQueue.push(event.data);
  if (!isProcessing) {
    void processNext();
  }
};

async function processNext(): Promise<void> {
  if (actionQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const action = actionQueue[0];

  let result: WorkerResult;

  try {
    if (action.type === 'setUp') {
      const [setupPayload, schema] = action.payload as [WorkerSetupPayload, DatabaseSchema];

      // Auto-create IncrementalIDBAdapter for browser persistence
      let persistenceAdapter: unknown;
      try {
        const { default: IncrementalIDBAdapter } =
          await import('lokijs/src/incremental-indexeddb-adapter');
        persistenceAdapter = new IncrementalIDBAdapter();
      } catch {
        // IndexedDB not available — fall back to memory-only
      }

      executor = new LokiExecutor({
        databaseName: setupPayload.databaseName,
        saveStrategy: setupPayload.saveStrategy,
        autosaveInterval: setupPayload.autosaveInterval,
        persistenceAdapter,
      });
      await executor.initialize(schema);
      result = { value: undefined };
    } else if (executor) {
      const method = (executor as any)[action.type];
      if (typeof method !== 'function') {
        throw new TypeError(`Unknown command: ${action.type}`);
      }
      const value = await method.call(executor, ...action.payload);
      result = { value };
    } else {
      throw new Error('Worker not initialized — call setUp first');
    }
  } catch (error_: unknown) {
    const error = error_ instanceof Error ? error_ : new Error(String(error_));
    // Log for worker-side debugging (stack traces are lost across postMessage)
    console.error(`[LokiWorker] Error in ${action.type}:`, error);
    result = { error: { message: error.message, stack: error.stack } };
  }

  const response: WorkerResponse = { id: action.id, result };
  ctx.postMessage(response);

  actionQueue.shift();
  await processNext();
}
