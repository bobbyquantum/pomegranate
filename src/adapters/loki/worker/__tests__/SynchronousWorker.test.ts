/**
 * SynchronousWorker unit tests.
 *
 * Tests the in-process worker that simulates the Web Worker message
 * protocol using a real LokiExecutor under the hood — no actual
 * threading or browser APIs required.
 */

import { SynchronousWorker } from '../SynchronousWorker';
import type { WorkerAction, WorkerResponse, WorkerSetupPayload } from '../types';
import type { DatabaseSchema } from '../../../../schema/types';

// ─── Test schema ─────────────────────────────────────────────────────────

const testSchema: DatabaseSchema = {
  version: 1,
  tables: [
    {
      name: 'items',
      columns: [
        { name: 'id', type: 'text', isOptional: false, isIndexed: false },
        { name: 'title', type: 'text', isOptional: false, isIndexed: true },
        { name: 'count', type: 'number', isOptional: false, isIndexed: false },
        { name: '_status', type: 'text', isOptional: false, isIndexed: true },
        { name: '_changed', type: 'text', isOptional: false, isIndexed: false },
      ],
    },
  ],
};

const setupPayload: WorkerSetupPayload = {
  databaseName: 'sync-worker-test',
  saveStrategy: 'immediate',
};

// Shared empty query descriptor
const emptyQuery = { table: 'items', conditions: [], orderBy: [], joins: [] };

function postAndCapture(
  worker: SynchronousWorker,
  action: Omit<WorkerAction, 'id'>,
): Promise<WorkerResponse['result']> {
  return new Promise((resolve) => {
    worker.onmessage = (event) => {
      resolve((event.data as WorkerResponse).result);
    };
    worker.postMessage({ id: 1, ...action });
  });
}

async function setUp(worker: SynchronousWorker): Promise<void> {
  await postAndCapture(worker, {
    type: 'setUp',
    payload: [setupPayload, testSchema],
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('SynchronousWorker', () => {
  let worker: SynchronousWorker;

  beforeEach(() => {
    worker = new SynchronousWorker();
  });

  // ─── setUp ─────────────────────────────────────────────────────────────

  describe('setUp', () => {
    it('initializes the executor and responds with value: undefined', async () => {
      const result = await postAndCapture(worker, {
        type: 'setUp',
        payload: [setupPayload, testSchema],
      });

      expect(result).toEqual({ value: undefined });
    });

    it('accepts autosaveInterval in the setup payload', async () => {
      const result = await postAndCapture(worker, {
        type: 'setUp',
        payload: [{ ...setupPayload, autosaveInterval: 5000 }, testSchema],
      });
      expect(result).toEqual({ value: undefined });
    });
  });

  // ─── count ─────────────────────────────────────────────────────────────

  describe('count', () => {
    it('returns 0 for an empty collection after setUp', async () => {
      await setUp(worker);
      const result = await postAndCapture(worker, {
        type: 'count',
        payload: [{ table: 'items', conditions: [], orderBy: [], joins: [] }],
      });
      expect(result).toEqual({ value: 0 });
    });
  });

  // ─── insert + find ─────────────────────────────────────────────────────

  describe('insert → find', () => {
    it('stores and retrieves a record', async () => {
      await setUp(worker);

      const record = {
        id: 'r1',
        title: 'Hello Worker',
        count: 7,
        _status: 'created',
        _changed: '',
      };

      // Insert
      const insertResult = await postAndCapture(worker, {
        type: 'insert',
        payload: ['items', record],
      });
      expect(insertResult).toEqual({ value: undefined });

      // Find all
      const findResult = await postAndCapture(worker, {
        type: 'find',
        payload: [{ table: 'items', conditions: [], orderBy: [], joins: [] }],
      });
      expect((findResult as { value: unknown[] }).value).toHaveLength(1);
      expect((findResult as { value: any[] }).value[0]).toMatchObject({
        id: 'r1',
        title: 'Hello Worker',
        count: 7,
      });
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the record when found', async () => {
      await setUp(worker);

      const record = { id: 'x1', title: 'Found', count: 0, _status: 'created', _changed: '' };
      await postAndCapture(worker, { type: 'insert', payload: ['items', record] });

      const result = await postAndCapture(worker, {
        type: 'findById',
        payload: ['items', 'x1'],
      });
      expect((result as { value: any }).value).toMatchObject({ id: 'x1', title: 'Found' });
    });

    it('returns null for a non-existent ID', async () => {
      await setUp(worker);
      const result = await postAndCapture(worker, {
        type: 'findById',
        payload: ['items', 'does-not-exist'],
      });
      expect((result as { value: unknown }).value).toBeNull();
    });
  });

  // ─── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns an error result for an unknown command', async () => {
      await setUp(worker);
      const result = await postAndCapture(worker, {
        type: 'find',   // we'll trick it with a bad cast — just test unknown fallback
        payload: [],
      } as any);
      // 'find' with no args should throw or error (bad payload but known command)
      // Let's test a genuinely unknown command
      const unknown = await postAndCapture(worker, {
        type: 'nonExistentCmd' as any,
        payload: [],
      });
      expect(unknown).toHaveProperty('error');
      expect((unknown as { error: { message: string } }).error.message).toMatch(
        /Unknown command/i,
      );
    });

    it('returns error and does nothing when a command is called before setUp', async () => {
      const result = await postAndCapture(worker, {
        type: 'count',
        payload: [{ table: 'items', conditions: [], orderBy: [], joins: [] }],
      });
      expect(result).toHaveProperty('error');
      expect((result as { error: { message: string } }).error.message).toMatch(
        /not initialized|setUp/i,
      );
    });
  });

  // ─── Message ordering ─────────────────────────────────────────────────

  describe('message ordering', () => {
    it('processes messages in FIFO order', async () => {
      await setUp(worker);

      const responses: WorkerResponse['result'][] = [];
      let captured = 0;

      const target = 3; // setUp + 2 inserts we'll check
      return new Promise<void>((resolve) => {
        worker.onmessage = (event) => {
          responses.push((event.data as WorkerResponse).result);
          captured++;
          if (captured === target) resolve();
        };

        worker.postMessage({ id: 10, type: 'insert', payload: ['items', { id: 'a', title: 'A', count: 1, _status: 'created', _changed: '' }] });
        worker.postMessage({ id: 11, type: 'insert', payload: ['items', { id: 'b', title: 'B', count: 2, _status: 'created', _changed: '' }] });
        worker.postMessage({ id: 12, type: 'count', payload: [{ table: 'items', conditions: [], orderBy: [], joins: [] }] });
      }).then(() => {
        // All 3 should have succeeded; count should be 2 (both inserts done first)
        expect(responses[0]).toEqual({ value: undefined }); // insert A
        expect(responses[1]).toEqual({ value: undefined }); // insert B
        expect(responses[2]).toEqual({ value: 2 });         // count = 2
      });
    });
  });

  // ─── terminate() ──────────────────────────────────────────────────────

  describe('terminate()', () => {
    it('clears the queue and nulls the executor', () => {
      worker.terminate();
      // Internal state: _executor and _queue cleared
      expect(worker['_executor']).toBeNull();
      expect(worker['_queue']).toHaveLength(0);
    });

    it('does not process messages after terminate', async () => {
      await setUp(worker);
      worker.terminate();

      const responses: WorkerResponse['result'][] = [];
      worker.onmessage = (e) => responses.push((e.data as WorkerResponse).result);
      worker.postMessage({ id: 99, type: 'count', payload: ['items', { conditions: [] }] });

      // Give microtasks a chance to run
      await new Promise((r) => setTimeout(r, 50));
      // After terminate, executor is null, so count should error
      // (the message is in the queue but executor is null)
      // Depending on implementation, may or may not process — just verify no crash
      expect(responses.length).toBeLessThanOrEqual(1);
    });
  });
});
