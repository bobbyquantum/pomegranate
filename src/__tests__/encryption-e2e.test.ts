/**
 * Encryption end-to-end tests.
 *
 * Exercises the full stack with EncryptingAdapter wrapping LokiAdapter.
 * Verifies that:
 *   - User data columns are encrypted at rest (raw storage has ciphertext)
 *   - Plaintext columns (id, _status, _changed) remain queryable
 *   - Data round-trips correctly through encrypt → store → read → decrypt
 *   - Wrong key cannot decrypt data
 *   - Batch, sync, null values, and unicode all work through encryption
 */

import { EncryptionManager, EncryptingAdapter } from '../encryption';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { Database } from '../database/Database';
import { Model } from '../model/Model';
import { m } from '../schema/builder';
import type { RawRecord } from '../schema/types';

// ─── Test Key ─────────────────────────────────────────────────────────────

function makeKey(seed = 0): Uint8Array {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = (i + seed) % 256;
  return key;
}

// ─── Schema & Model ───────────────────────────────────────────────────────

const NoteSchema = m.model('notes', {
  title: m.text(),
  body: m.text().default(''),
  secret: m.text().optional(),
  count: m.number().default(0),
});

class Note extends Model<typeof NoteSchema> {
  static schema = NoteSchema;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function createEncryptedStack(keySeed = 0) {
  const innerAdapter = new LokiAdapter({ databaseName: `enc-test-${Date.now()}` });
  const encAdapter = new EncryptingAdapter(innerAdapter, async () => makeKey(keySeed));
  return { innerAdapter, encAdapter };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Encryption E2E', () => {
  describe('EncryptingAdapter — raw storage inspection', () => {
    let innerAdapter: LokiAdapter;
    let encAdapter: EncryptingAdapter;

    beforeEach(async () => {
      ({ innerAdapter, encAdapter } = createEncryptedStack());
      const schema = {
        version: 1,
        tables: [
          {
            name: 'notes',
            columns: [
              { name: 'title', type: 'text' as const, isOptional: false, isIndexed: false },
              { name: 'body', type: 'text' as const, isOptional: false, isIndexed: false },
              { name: 'secret', type: 'text' as const, isOptional: true, isIndexed: false },
              { name: 'count', type: 'number' as const, isOptional: false, isIndexed: false },
            ],
          },
        ],
      };
      await encAdapter.initialize(schema);
    });

    afterEach(async () => {
      await encAdapter.close();
    });

    it('encrypts user data columns at rest', async () => {
      await encAdapter.insert('notes', {
        id: 'n1',
        title: 'My Secret Note',
        body: 'This is private',
        secret: 'password123',
        count: '42',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      // Read raw data from the inner (unencrypted) adapter
      const raw = await innerAdapter.findById('notes', 'n1');
      expect(raw).not.toBeNull();

      // Plaintext columns should be readable
      expect(raw!.id).toBe('n1');
      expect(raw!._status).toBe('created');
      expect(raw!._changed).toBe('');

      // Encrypted columns should NOT contain the original plaintext
      expect(raw!.title).not.toBe('My Secret Note');
      expect(raw!.body).not.toBe('This is private');
      expect(raw!.secret).not.toBe('password123');

      // Encrypted values should contain ':' (IV:ciphertext format)
      expect(String(raw!.title)).toContain(':');
      expect(String(raw!.body)).toContain(':');
      expect(String(raw!.secret)).toContain(':');
    });

    it('decrypts data correctly on read', async () => {
      await encAdapter.insert('notes', {
        id: 'n2',
        title: 'Decryption Test',
        body: 'Should come back',
        secret: null,
        count: '7',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const record = await encAdapter.findById('notes', 'n2');
      expect(record).not.toBeNull();
      expect(record!.title).toBe('Decryption Test');
      expect(record!.body).toBe('Should come back');
      expect(record!.count).toBe('7');
      // null passes through
      expect(record!.secret).toBeNull();
    });

    it('handles null and undefined values without encryption', async () => {
      await encAdapter.insert('notes', {
        id: 'n3',
        title: 'Nulls',
        body: '',
        secret: null,
        count: '0',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const raw = await innerAdapter.findById('notes', 'n3');
      // null should remain null (not encrypted)
      expect(raw!.secret).toBeNull();

      const decrypted = await encAdapter.findById('notes', 'n3');
      expect(decrypted!.secret).toBeNull();
    });

    it('handles unicode content', async () => {
      await encAdapter.insert('notes', {
        id: 'n4',
        title: '🍉 PomegranateDB 日本語',
        body: 'Ünîcödé tëxt',
        secret: '密码',
        count: '0',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const decrypted = await encAdapter.findById('notes', 'n4');
      expect(decrypted!.title).toBe('🍉 PomegranateDB 日本語');
      expect(decrypted!.body).toBe('Ünîcödé tëxt');
      expect(decrypted!.secret).toBe('密码');
    });

    it('produces different ciphertexts for identical records', async () => {
      await encAdapter.insert('notes', {
        id: 'dup1',
        title: 'Same Title',
        body: '',
        secret: null,
        count: '0',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      await encAdapter.insert('notes', {
        id: 'dup2',
        title: 'Same Title',
        body: '',
        secret: null,
        count: '0',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const raw1 = await innerAdapter.findById('notes', 'dup1');
      const raw2 = await innerAdapter.findById('notes', 'dup2');

      // Random IVs mean identical plaintext → different ciphertext
      expect(raw1!.title).not.toBe(raw2!.title);
    });
  });

  describe('EncryptingAdapter — wrong key', () => {
    it('cannot decrypt data written with a different key', async () => {
      // Write with key seed 0
      const { innerAdapter, encAdapter: writer } = createEncryptedStack(0);
      const schema = {
        version: 1,
        tables: [
          {
            name: 'notes',
            columns: [
              { name: 'title', type: 'text' as const, isOptional: false, isIndexed: false },
              { name: 'body', type: 'text' as const, isOptional: false, isIndexed: false },
              { name: 'secret', type: 'text' as const, isOptional: true, isIndexed: false },
              { name: 'count', type: 'number' as const, isOptional: false, isIndexed: false },
            ],
          },
        ],
      };
      await writer.initialize(schema);

      await writer.insert('notes', {
        id: 'wrongkey1',
        title: 'Secret Data',
        body: 'Very private',
        secret: null,
        count: '1',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      await writer.close();

      // Read with key seed 99 (different key)
      const wrongKeyAdapter = new EncryptingAdapter(
        innerAdapter,
        async () => makeKey(99),
      );
      // Don't re-initialize; just read from the existing inner adapter
      const record = await wrongKeyAdapter.findById('notes', 'wrongkey1');

      // The EncryptingAdapter's _decryptRecord catches errors and passes through
      // So the title should be the raw ciphertext, NOT the original value
      expect(record).not.toBeNull();
      expect(record!.title).not.toBe('Secret Data');

      // id and _status still accessible (plaintext)
      expect(record!.id).toBe('wrongkey1');
      expect(record!._status).toBe('created');
    });
  });

  describe('EncryptingAdapter — batch operations', () => {
    let encAdapter: EncryptingAdapter;
    let innerAdapter: LokiAdapter;

    beforeEach(async () => {
      ({ innerAdapter, encAdapter } = createEncryptedStack());
      const schema = {
        version: 1,
        tables: [
          {
            name: 'notes',
            columns: [
              { name: 'title', type: 'text' as const, isOptional: false, isIndexed: false },
              { name: 'body', type: 'text' as const, isOptional: false, isIndexed: false },
              { name: 'secret', type: 'text' as const, isOptional: true, isIndexed: false },
              { name: 'count', type: 'number' as const, isOptional: false, isIndexed: false },
            ],
          },
        ],
      };
      await encAdapter.initialize(schema);
    });

    afterEach(async () => {
      await encAdapter.close();
    });

    it('encrypts records in batch creates', async () => {
      await encAdapter.batch([
        {
          type: 'create',
          table: 'notes',
          rawRecord: {
            id: 'b1',
            title: 'Batch One',
            body: 'body1',
            secret: null,
            count: '1',
            _status: 'created',
            _changed: '',
          } as RawRecord,
        },
        {
          type: 'create',
          table: 'notes',
          rawRecord: {
            id: 'b2',
            title: 'Batch Two',
            body: 'body2',
            secret: 'shhh',
            count: '2',
            _status: 'created',
            _changed: '',
          } as RawRecord,
        },
      ]);

      // Raw should be encrypted
      const raw1 = await innerAdapter.findById('notes', 'b1');
      expect(String(raw1!.title)).toContain(':');

      // Decrypted reads should be correct
      const dec1 = await encAdapter.findById('notes', 'b1');
      const dec2 = await encAdapter.findById('notes', 'b2');
      expect(dec1!.title).toBe('Batch One');
      expect(dec2!.title).toBe('Batch Two');
      expect(dec2!.secret).toBe('shhh');
    });

    it('encrypts records in batch updates', async () => {
      await encAdapter.insert('notes', {
        id: 'upd1',
        title: 'Before',
        body: '',
        secret: null,
        count: '0',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      await encAdapter.batch([
        {
          type: 'update',
          table: 'notes',
          rawRecord: {
            id: 'upd1',
            title: 'After',
            body: 'updated',
            secret: 'new-secret',
            count: '99',
            _status: 'updated',
            _changed: 'title,body,secret,count',
          } as RawRecord,
        },
      ]);

      const decrypted = await encAdapter.findById('notes', 'upd1');
      expect(decrypted!.title).toBe('After');
      expect(decrypted!.secret).toBe('new-secret');
    });
  });

  describe('EncryptingAdapter — sync operations', () => {
    let encAdapter: EncryptingAdapter;
    let innerAdapter: LokiAdapter;

    beforeEach(async () => {
      ({ innerAdapter, encAdapter } = createEncryptedStack());
      const schema = {
        version: 1,
        tables: [
          {
            name: 'notes',
            columns: [
              { name: 'title', type: 'text' as const, isOptional: false, isIndexed: false },
              { name: 'body', type: 'text' as const, isOptional: false, isIndexed: false },
              { name: 'secret', type: 'text' as const, isOptional: true, isIndexed: false },
              { name: 'count', type: 'number' as const, isOptional: false, isIndexed: false },
            ],
          },
        ],
      };
      await encAdapter.initialize(schema);
    });

    afterEach(async () => {
      await encAdapter.close();
    });

    it('getLocalChanges returns decrypted records', async () => {
      await encAdapter.insert('notes', {
        id: 'sync1',
        title: 'Local Change',
        body: 'sync body',
        secret: null,
        count: '5',
        _status: 'created',
        _changed: '',
      } as RawRecord);

      const changes = await encAdapter.getLocalChanges(['notes']);
      expect(changes.notes.created).toHaveLength(1);
      expect(changes.notes.created[0].title).toBe('Local Change');
    });

    it('applyRemoteChanges encrypts incoming data', async () => {
      await encAdapter.applyRemoteChanges({
        notes: {
          created: [
            {
              id: 'remote1',
              title: 'From Server',
              body: 'remote body',
              secret: 'server-secret',
              count: '10',
              _status: 'synced',
              _changed: '',
            } as RawRecord,
          ],
          updated: [],
          deleted: [],
        },
      });

      // Raw should be encrypted
      const raw = await innerAdapter.findById('notes', 'remote1');
      expect(String(raw!.title)).toContain(':');
      expect(raw!.title).not.toBe('From Server');

      // Decrypted read should work
      const decrypted = await encAdapter.findById('notes', 'remote1');
      expect(decrypted!.title).toBe('From Server');
      expect(decrypted!.secret).toBe('server-secret');
    });
  });

  describe('Full Database + Encryption stack', () => {
    it('CRUD works through Database with encrypted adapter', async () => {
      const innerAdapter = new LokiAdapter({ databaseName: `db-enc-full-${Date.now()}` });
      const encAdapter = new EncryptingAdapter(innerAdapter, async () => makeKey());

      const db = new Database({
        adapter: encAdapter,
        models: [Note],
      });
      await db.initialize();

      // Create
      const notes = db.collection('notes');
      const note = await db.write(() =>
        notes.create({ title: 'Encrypted Note', body: 'Private body', count: 42 }),
      );
      expect(note.getField('title')).toBe('Encrypted Note');

      // Verify raw is encrypted
      const raw = await innerAdapter.findById('notes', note.id);
      expect(raw!.title).not.toBe('Encrypted Note');
      expect(String(raw!.title)).toContain(':');

      // Read back
      const found = await notes.findById(note.id);
      expect(found!.getField('title')).toBe('Encrypted Note');
      expect(found!.getField('body')).toBe('Private body');

      // Update
      await db.write(() => found!.update({ title: 'Updated Encrypted' }));
      const updated = await notes.findById(note.id);
      expect(updated!.getField('title')).toBe('Updated Encrypted');

      // Delete
      await db.write(() => updated!.markAsDeleted());
      const count = await notes.count();
      expect(count).toBe(0);

      await db.close();
    });

    it('sync round-trip works through Database with encryption', async () => {
      const innerAdapter = new LokiAdapter({ databaseName: `db-enc-sync-${Date.now()}` });
      const encAdapter = new EncryptingAdapter(innerAdapter, async () => makeKey());

      const db = new Database({
        adapter: encAdapter,
        models: [Note],
      });
      await db.initialize();

      const notes = db.collection('notes');
      await db.write(() => notes.create({ title: 'Will Sync', count: 1 }));

      let pushed: any = null;
      await db.sync({
        pushChanges: async ({ changes }) => {
          pushed = changes;
        },
        pullChanges: async () => ({
          changes: {
            notes: {
              created: [
                {
                  id: 'server-note-1',
                  title: 'From Server',
                  body: 'synced',
                  secret: null,
                  count: '77',
                  _status: 'synced',
                  _changed: '',
                } as unknown as RawRecord,
              ],
              updated: [],
              deleted: [],
            },
          },
          timestamp: Date.now(),
        }),
      });

      // Pushed data should be decrypted (readable to server)
      expect(pushed!.notes.created[0].title).toBe('Will Sync');

      // Pulled data should be encrypted at rest
      const rawRemote = await innerAdapter.findById('notes', 'server-note-1');
      expect(rawRemote!.title).not.toBe('From Server');

      // But readable through the encrypting adapter
      const decRemote = await encAdapter.findById('notes', 'server-note-1');
      expect(decRemote!.title).toBe('From Server');

      await db.close();
    });
  });

  describe('EncryptionManager — key management', () => {
    it('caches the key after first call', async () => {
      let callCount = 0;
      const manager = new EncryptionManager(async () => {
        callCount++;
        return makeKey();
      });

      await manager.encrypt('first');
      await manager.encrypt('second');
      await manager.encrypt('third');

      expect(callCount).toBe(1);
    });

    it('supports lazy async key derivation', async () => {
      // Simulate a real-world scenario: key derived from PIN
      const manager = new EncryptionManager(async () => {
        // In real app: const key = await PBKDF2(pin, salt, iterations);
        return makeKey(42);
      });

      const encrypted = await manager.encrypt('test data');
      const decrypted = await manager.decrypt(encrypted);
      expect(decrypted).toBe('test data');
    });
  });
});
