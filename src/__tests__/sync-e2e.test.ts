import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { Model } from '../model/Model';
import { m } from '../schema/builder';
import type { RawRecord } from '../schema/types';
import type { SyncPullResult, SyncPushPayload, SyncTableChanges } from '../sync/types';

const TaskSchema = m.model('tasks', {
  title: m.text(),
  done: m.boolean().default(false),
  priority: m.number().default(0),
});

class Task extends Model<typeof TaskSchema> {
  static schema = TaskSchema;
}

interface MockSyncServerState {
  pushedPayloads: SyncPushPayload[];
  pullRequests: Array<number | null>;
  remoteTimeline: Array<{
    timestamp: number;
    changes: SyncTableChanges;
  }>;
}

function createSyncDb() {
  return new Database({
    adapter: new LokiAdapter({ databaseName: 'sync-e2e-test.db' }),
    models: [Task],
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function mergeChanges(changeSets: SyncTableChanges[]): SyncTableChanges {
  const merged: SyncTableChanges = {};

  for (const changeSet of changeSets) {
    for (const [table, tableChanges] of Object.entries(changeSet)) {
      const existing =
        merged[table] ??
        {
          created: [],
          updated: [],
          deleted: [],
        };

      existing.created.push(...tableChanges.created);
      existing.updated.push(...tableChanges.updated);
      existing.deleted.push(...tableChanges.deleted);
      merged[table] = existing;
    }
  }

  return merged;
}

async function startMockSyncServer(state: MockSyncServerState) {
  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (method === 'POST' && url.pathname === '/push') {
      const payload = await readJsonBody<SyncPushPayload>(req);
      state.pushedPayloads.push(payload);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && url.pathname === '/pull') {
      const lastPulledAtParam = url.searchParams.get('lastPulledAt');
      const lastPulledAt = lastPulledAtParam == null ? null : Number(lastPulledAtParam);
      state.pullRequests.push(lastPulledAt);

      const availableEvents = state.remoteTimeline.filter(
        (event) => lastPulledAt == null || event.timestamp > lastPulledAt,
      );
      const timestamp =
        availableEvents.at(-1)?.timestamp ?? lastPulledAt ?? state.remoteTimeline.at(-1)?.timestamp ?? 0;

      const response: SyncPullResult = {
        changes: mergeChanges(availableEvents.map((event) => event.changes)),
        timestamp,
      };
      sendJson(res, 200, response);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

describe('Sync end-to-end against a mock HTTP server', () => {
  let db: Database;
  let serverHandle: Awaited<ReturnType<typeof startMockSyncServer>>;
  let serverState: MockSyncServerState;

  beforeEach(async () => {
    db = createSyncDb();
    await db.initialize();

    const remoteTask: RawRecord = {
      id: 'remote-1',
      title: 'Remote task from server',
      done: false,
      priority: 2,
      _status: 'synced',
      _changed: '',
    };

    serverState = {
      pushedPayloads: [],
      pullRequests: [],
      remoteTimeline: [
        {
          timestamp: 1001,
          changes: {
            tasks: {
              created: [remoteTask],
              updated: [],
              deleted: [],
            },
          },
        },
      ],
    };

    serverHandle = await startMockSyncServer(serverState);
  });

  afterEach(async () => {
    await serverHandle.close();
    await db.close();
  });

  it('pushes local changes, pulls remote changes, and reuses lastPulledAt on the next sync', async () => {
    const localTask = await db.write(async () => {
      return db.get(Task).create({ title: 'Local task to push', priority: 1 });
    });

    const pushChanges = async (payload: SyncPushPayload) => {
      const response = await globalThis.fetch(`${serverHandle.baseUrl}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(response.ok).toBe(true);
    };

    const pullChanges = async ({ lastPulledAt }: { lastPulledAt: number | null }) => {
      const url = new URL('/pull', serverHandle.baseUrl);
      if (lastPulledAt != null) {
        url.searchParams.set('lastPulledAt', String(lastPulledAt));
      }

      const response = await globalThis.fetch(url);
      expect(response.ok).toBe(true);
      return (await response.json()) as SyncPullResult;
    };

    await db.sync({ pushChanges, pullChanges, tables: ['tasks'] });

    expect(serverState.pushedPayloads).toHaveLength(1);
    expect(serverState.pullRequests).toEqual([null]);
    expect(serverState.pushedPayloads[0]).toMatchObject({
      lastPulledAt: 0,
      changes: {
        tasks: {
          created: [
            expect.objectContaining({
              id: localTask.id,
              title: 'Local task to push',
              priority: 1,
              _status: 'synced',
              _changed: '',
            }),
          ],
          updated: [],
          deleted: [],
        },
      },
    });

    const pushedLocalTask = await db._adapter.findById('tasks', localTask.id);
    const pulledRemoteTask = await db._adapter.findById('tasks', 'remote-1');

    expect(pushedLocalTask?._status).toBe('synced');
    expect(pulledRemoteTask).toMatchObject({
      id: 'remote-1',
      title: 'Remote task from server',
      priority: 2,
      _status: 'synced',
      _changed: '',
    });

    await db.sync({ pushChanges, pullChanges, tables: ['tasks'] });

    expect(serverState.pushedPayloads).toHaveLength(1);
    expect(serverState.pullRequests).toEqual([null, 1001]);
  });
});
