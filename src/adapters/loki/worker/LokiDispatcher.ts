/**
 * LokiJS Dispatcher.
 *
 * Main-thread proxy that sends commands to a Web Worker (or SynchronousWorker)
 * and matches responses to resolve/reject the corresponding Promises.
 *
 * All responses are assumed to arrive in FIFO order (the worker processes
 * one command at a time). An ID-based sanity check catches any ordering bugs.
 */

import type { WorkerAction, WorkerCommandType, WorkerInterface, WorkerResponse } from './types';

interface PendingCall {
  id: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class LokiDispatcher {
  private _worker: WorkerInterface;
  private _pendingCalls: PendingCall[] = [];
  private _nextId = 1;

  constructor(worker: WorkerInterface) {
    this._worker = worker;
    this._worker.onmessage = this._onMessage.bind(this);
  }

  /** Send a command to the worker and return a Promise for the result. */
  call(type: WorkerCommandType, payload: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pendingCalls.push({ id, resolve, reject });
      const action: WorkerAction = { id, type, payload };
      this._worker.postMessage(action);
    });
  }

  /** Terminate the worker and reject all pending calls. */
  terminate(): void {
    this._worker.terminate?.();
    for (const pending of this._pendingCalls) {
      pending.reject(new Error('Worker terminated'));
    }
    this._pendingCalls = [];
  }

  private _onMessage(event: { data: unknown }): void {
    const response = event.data as WorkerResponse;
    const pending = this._pendingCalls.shift();

    if (!pending) {
      console.error('[LokiDispatcher] Received response with no pending call');
      return;
    }

    if (pending.id !== response.id) {
      console.error(
        `[LokiDispatcher] Response ID mismatch: expected ${pending.id}, got ${response.id}`,
      );
      pending.reject(new Error('Worker response ID mismatch'));
      return;
    }

    if ('error' in response.result) {
      const err = response.result.error;
      const error = new Error(err.message);
      if (err.stack) error.stack = err.stack;
      pending.reject(error);
    } else {
      pending.resolve(response.result.value);
    }
  }
}
