/**
 * LokiDispatcher unit tests.
 *
 * Tests the FIFO message-passing RPC protocol between the main thread
 * proxy and the worker. Uses a mock WorkerInterface so no real Web Worker
 * or threading is involved.
 */

import { LokiDispatcher } from '../LokiDispatcher';
import type { WorkerInterface, WorkerAction, WorkerResponse } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Minimal controllable mock of the WorkerInterface. */
class MockWorker implements WorkerInterface {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  posted: WorkerAction[] = [];
  terminated = false;

  postMessage(data: unknown): void {
    this.posted.push(data as WorkerAction);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulate the worker responding to the last posted message. */
  respond(result: WorkerResponse['result']): void {
    const action = this.posted[this.posted.length - 1];
    const response: WorkerResponse = { id: action.id, result };
    this.onmessage?.({ data: response });
  }

  /** Respond to all pending posted messages in order. */
  respondAll(results: WorkerResponse['result'][]): void {
    results.forEach((result, i) => {
      const action = this.posted[i];
      const response: WorkerResponse = { id: action.id, result };
      this.onmessage?.({ data: response });
    });
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('LokiDispatcher', () => {
  let worker: MockWorker;
  let dispatcher: LokiDispatcher;

  beforeEach(() => {
    worker = new MockWorker();
    dispatcher = new LokiDispatcher(worker);
  });

  // ─── call() ──────────────────────────────────────────────────────────────

  describe('call()', () => {
    it('posts a WorkerAction with an incrementing ID', async () => {
      const p1 = dispatcher.call('find', ['items', {}]);
      const p2 = dispatcher.call('count', ['items']);

      expect(worker.posted).toHaveLength(2);
      expect(worker.posted[0]).toMatchObject({ type: 'find', payload: ['items', {}] });
      expect(worker.posted[1]).toMatchObject({ type: 'count', payload: ['items'] });
      // IDs must be distinct and increasing
      expect(worker.posted[0].id).toBeLessThan(worker.posted[1].id);

      // respond so promises settle
      worker.respondAll([{ value: [] }, { value: 0 }]);
      await Promise.all([p1, p2]);
    });

    it('resolves with the value from the worker response', async () => {
      const p = dispatcher.call('find', ['items', {}]);
      worker.respond({ value: [{ id: 'a', title: 'hello' }] });

      await expect(p).resolves.toEqual([{ id: 'a', title: 'hello' }]);
    });

    it('rejects when the worker responds with an error', async () => {
      const p = dispatcher.call('findById', ['items', 'x']);
      worker.respond({ error: { message: 'record not found', stack: 'at ...' } });

      const err = await p.catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('record not found');
      expect((err as Error).stack).toBe('at ...');
    });

    it('matches responses to the correct pending call (FIFO)', async () => {
      const p1 = dispatcher.call('find', ['items', {}]);
      const p2 = dispatcher.call('count', ['todos']);

      // Respond in same order
      worker.respondAll([{ value: ['item1'] }, { value: 42 }]);

      await expect(p1).resolves.toEqual(['item1']);
      await expect(p2).resolves.toEqual(42);
    });

    it('rejects when response ID does not match pending call ID', async () => {
      const p = dispatcher.call('find', ['items', {}]);
      // Manually craft a response with the wrong ID
      dispatcher['_onMessage']({ data: { id: 9999, result: { value: [] } } });

      await expect(p).rejects.toThrow(/ID mismatch/i);
    });

    it('logs an error and does nothing when a response arrives with no pending call', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      // Simulate stray response with no pending calls
      dispatcher['_onMessage']({ data: { id: 1, result: { value: 'stray' } } });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('no pending call'));
      consoleSpy.mockRestore();
    });
  });

  // ─── terminate() ─────────────────────────────────────────────────────────

  describe('terminate()', () => {
    it('calls terminate() on the underlying worker', () => {
      dispatcher.terminate();
      expect(worker.terminated).toBe(true);
    });

    it('rejects all pending calls with "Worker terminated"', async () => {
      const p1 = dispatcher.call('find', ['items', {}]);
      const p2 = dispatcher.call('count', ['todos']);

      dispatcher.terminate();

      await expect(p1).rejects.toThrow('Worker terminated');
      await expect(p2).rejects.toThrow('Worker terminated');
    });

    it('is a no-op when there are no pending calls', () => {
      expect(() => dispatcher.terminate()).not.toThrow();
    });

    it('does not throw if the worker has no terminate method', () => {
      const noTermWorker: WorkerInterface = {
        onmessage: null,
        postMessage: jest.fn(),
        // terminate intentionally omitted
      };
      const d = new LokiDispatcher(noTermWorker);
      expect(() => d.terminate()).not.toThrow();
    });
  });
});
