/**
 * Shared types for the LokiJS Web Worker message protocol.
 *
 * Communication follows an RPC-over-postMessage pattern:
 * - Main thread sends WorkerAction messages
 * - Worker processes them sequentially and returns WorkerResponse messages
 * - Matching is done via monotonically increasing message IDs (FIFO order)
 */

/** All valid command types that can be sent to the worker */
export type WorkerCommandType =
  | 'setUp'
  | 'find'
  | 'count'
  | 'findById'
  | 'insert'
  | 'update'
  | 'markAsDeleted'
  | 'destroyPermanently'
  | 'batch'
  | 'search'
  | 'getLocalChanges'
  | 'applyRemoteChanges'
  | 'markAsSynced'
  | 'getSchemaVersion'
  | 'migrate'
  | 'reset'
  | 'close';

/** Message sent from main thread to worker */
export interface WorkerAction {
  id: number;
  type: WorkerCommandType;
  payload: unknown[];
}

/** Discriminated union for success/error results */
export type WorkerResult<T = unknown> =
  | { value: T }
  | { error: { message: string; stack?: string } };

/** Message sent from worker back to main thread */
export interface WorkerResponse {
  id: number;
  result: WorkerResult;
}

/** Serializable configuration passed to the worker during setUp */
export interface WorkerSetupPayload {
  databaseName: string;
  saveStrategy?: 'immediate' | 'auto';
  autosaveInterval?: number;
}

/** Interface matching what Worker and SynchronousWorker both implement */
export interface WorkerInterface {
  postMessage(data: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  terminate?(): void;
}
