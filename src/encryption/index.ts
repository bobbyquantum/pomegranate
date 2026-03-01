/**
 * Encryption layer — transparent encrypt/decrypt for storage adapters.
 *
 * Wraps a StorageAdapter, encrypting record values before writes
 * and decrypting after reads. Uses AES-GCM (Web Crypto API or Node crypto).
 *
 * The encryption is transparent to the model/collection layer.
 * Only user-data columns are encrypted; id, _status, _changed are stored in plaintext
 * so the adapter can still query by them.
 */

import type { StorageAdapter, Migration, EncryptionConfig } from '../adapters/types';
import type { QueryDescriptor, SearchDescriptor, BatchOperation } from '../query/types';
import type { DatabaseSchema, RawRecord } from '../schema/types';

// ─── Columns that are never encrypted ──────────────────────────────────

const PLAINTEXT_COLUMNS = new Set(['id', '_status', '_changed']);

// ─── Encryption Manager ───────────────────────────────────────────────

export class EncryptionManager {
  private _key: Uint8Array | null = null;
  private _keyProvider: () => Promise<Uint8Array>;

  constructor(keyProvider: () => Promise<Uint8Array>) {
    this._keyProvider = keyProvider;
  }

  async getKey(): Promise<Uint8Array> {
    if (!this._key) {
      this._key = await this._keyProvider();
    }
    return this._key;
  }

  /** Encrypt a string value */
  async encrypt(plaintext: string): Promise<string> {
    const key = await this.getKey();
    const iv = await randomBytes(12);
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    if (globalThis.crypto !== undefined && globalThis.crypto.subtle) {
      // Web Crypto API
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        key.buffer as ArrayBuffer,
        { name: 'AES-GCM' },
        false,
        ['encrypt'],
      );
      const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        cryptoKey,
        data.buffer as ArrayBuffer,
      );
      return encodeBase64(iv) + ':' + encodeBase64(new Uint8Array(encrypted));
    }

    // Fallback: Node.js crypto
    try {
      const crypto = await import('crypto');
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const tag = cipher.getAuthTag();
      return encodeBase64(iv) + ':' + encodeBase64(encrypted) + ':' + encodeBase64(tag);
    } catch {
      throw new Error('No crypto implementation available for encryption');
    }
  }

  /** Decrypt a string value */
  async decrypt(ciphertext: string): Promise<string> {
    const key = await this.getKey();
    const parts = ciphertext.split(':');

    if (globalThis.crypto !== undefined && globalThis.crypto.subtle) {
      // Web Crypto API
      const iv = decodeBase64(parts[0]);
      const data = decodeBase64(parts[1]);
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        key.buffer as ArrayBuffer,
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        cryptoKey,
        data.buffer as ArrayBuffer,
      );
      return new TextDecoder().decode(decrypted);
    }

    // Fallback: Node.js crypto
    try {
      const crypto = await import('crypto');
      const iv = decodeBase64(parts[0]);
      const data = decodeBase64(parts[1]);
      const tag = decodeBase64(parts[2]);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      throw new Error(`Decryption failed: ${error}`, { cause: error });
    }
  }
}

// ─── Encrypting Adapter Wrapper ──────────────────────────────────────────

/**
 * Wraps a StorageAdapter to provide transparent encryption.
 * Only user-data columns are encrypted. Sync metadata and IDs remain in plaintext.
 */
export class EncryptingAdapter implements StorageAdapter {
  private _inner: StorageAdapter;
  private _encryption: EncryptionManager;

  constructor(inner: StorageAdapter, keyProvider: () => Promise<Uint8Array>) {
    this._inner = inner;
    this._encryption = new EncryptionManager(keyProvider);
  }

  async initialize(schema: DatabaseSchema): Promise<void> {
    await this._inner.initialize(schema);
  }

  async find(query: QueryDescriptor): Promise<RawRecord[]> {
    // NOTE: Encrypted columns cannot be queried by value.
    // Queries should only filter on plaintext columns (id, _status, etc.)
    // or indexed columns stored unencrypted.
    const rows = await this._inner.find(query);
    return Promise.all(rows.map((r) => this._decryptRecord(r)));
  }

  async count(query: QueryDescriptor): Promise<number> {
    return this._inner.count(query);
  }

  async findById(table: string, id: string): Promise<RawRecord | null> {
    const raw = await this._inner.findById(table, id);
    if (!raw) return null;
    return this._decryptRecord(raw);
  }

  async insert(table: string, raw: RawRecord): Promise<void> {
    const encrypted = await this._encryptRecord(raw);
    await this._inner.insert(table, encrypted);
  }

  async update(table: string, raw: RawRecord): Promise<void> {
    const encrypted = await this._encryptRecord(raw);
    await this._inner.update(table, encrypted);
  }

  async markAsDeleted(table: string, id: string): Promise<void> {
    await this._inner.markAsDeleted(table, id);
  }

  async destroyPermanently(table: string, id: string): Promise<void> {
    await this._inner.destroyPermanently(table, id);
  }

  async batch(operations: BatchOperation[]): Promise<void> {
    const encrypted: BatchOperation[] = [];
    for (const op of operations) {
      if (op.rawRecord && (op.type === 'create' || op.type === 'update')) {
        const encRecord = await this._encryptRecord(op.rawRecord as RawRecord);
        encrypted.push({ ...op, rawRecord: encRecord });
      } else {
        encrypted.push(op);
      }
    }
    await this._inner.batch(encrypted);
  }

  async search(descriptor: SearchDescriptor): Promise<{ records: RawRecord[]; total: number }> {
    // Full-text search on encrypted data is not possible.
    // This will only work if search fields are stored unencrypted.
    const result = await this._inner.search(descriptor);
    const records = await Promise.all(result.records.map((r) => this._decryptRecord(r)));
    return { records, total: result.total };
  }

  async getLocalChanges(
    tables: string[],
  ): Promise<Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>> {
    const changes = await this._inner.getLocalChanges(tables);
    const result: Record<
      string,
      { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }
    > = {};

    for (const [table, tc] of Object.entries(changes)) {
      result[table] = {
        created: await Promise.all(tc.created.map((r) => this._decryptRecord(r))),
        updated: await Promise.all(tc.updated.map((r) => this._decryptRecord(r))),
        deleted: tc.deleted,
      };
    }

    return result;
  }

  async applyRemoteChanges(
    changes: Record<string, { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }>,
  ): Promise<void> {
    const encrypted: Record<
      string,
      { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }
    > = {};

    for (const [table, tc] of Object.entries(changes)) {
      encrypted[table] = {
        created: await Promise.all(tc.created.map((r) => this._encryptRecord(r))),
        updated: await Promise.all(tc.updated.map((r) => this._encryptRecord(r))),
        deleted: tc.deleted,
      };
    }

    await this._inner.applyRemoteChanges(encrypted);
  }

  async markAsSynced(table: string, ids: string[]): Promise<void> {
    await this._inner.markAsSynced(table, ids);
  }

  async getSchemaVersion(): Promise<number> {
    return this._inner.getSchemaVersion();
  }

  async migrate(migrations: Migration[]): Promise<void> {
    await this._inner.migrate(migrations);
  }

  async reset(): Promise<void> {
    await this._inner.reset();
  }

  async close(): Promise<void> {
    await this._inner.close();
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  private async _encryptRecord(raw: RawRecord): Promise<RawRecord> {
    const encrypted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(raw)) {
      if (PLAINTEXT_COLUMNS.has(key)) {
        encrypted[key] = value;
      } else if (value === null || value === undefined) {
        encrypted[key] = value;
      } else {
        encrypted[key] = await this._encryption.encrypt(String(value));
      }
    }

    return encrypted as RawRecord;
  }

  private async _decryptRecord(raw: RawRecord): Promise<RawRecord> {
    const decrypted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(raw)) {
      if (PLAINTEXT_COLUMNS.has(key)) {
        decrypted[key] = value;
      } else if (value === null || value === undefined) {
        decrypted[key] = value;
      } else if (typeof value === 'string' && value.includes(':')) {
        // Looks like encrypted data
        try {
          decrypted[key] = await this._encryption.decrypt(value);
        } catch {
          // Not encrypted or corrupted — pass through
          decrypted[key] = value;
        }
      } else {
        decrypted[key] = value;
      }
    }

    return decrypted as RawRecord;
  }
}

// ─── Utility functions ──────────────────────────────────────────────────

async function randomBytes(length: number): Promise<Uint8Array> {
  if (globalThis.crypto !== undefined && globalThis.crypto.getRandomValues) {
    const buf = new Uint8Array(length);
    globalThis.crypto.getRandomValues(buf);
    return buf;
  }

  try {
    const crypto = await import('crypto');
    return new Uint8Array(crypto.randomBytes(length));
  } catch {
    // Last resort: Math.random (NOT cryptographically secure)
    const buf = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
    return buf;
  }
}

function encodeBase64(data: Uint8Array | Buffer): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data).toString('base64');
  }
  // Browser
  let binary = '';
  for (const datum of data) {
    binary += String.fromCodePoint(datum);
  }
  return btoa(binary);
}

function decodeBase64(str: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64'));
  }
  // Browser
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.codePointAt(i)!;
  }
  return bytes;
}
