/**
 * Encryption layer — transparent encrypt/decrypt for storage adapters.
 *
 * This shared entry only depends on Web Crypto primitives so it stays safe for
 * Expo Snack and React Native bundles. Node-specific crypto support lives in
 * `pomegranate-db/encryption/node`.
 */

import type { StorageAdapter, Migration } from '../adapters/types';
import type { QueryDescriptor, SearchDescriptor, BatchOperation } from '../query/types';
import type { DatabaseSchema, RawRecord } from '../schema/types';

export interface EncryptionProvider {
  readonly name: string;
  readonly supportsAuthTag: boolean;
  randomBytes(length: number): Promise<Uint8Array> | Uint8Array;
  encrypt(
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array,
  ): Promise<{ ciphertext: Uint8Array; tag?: Uint8Array }> | { ciphertext: Uint8Array; tag?: Uint8Array };
  decrypt(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    tag?: Uint8Array,
  ): Promise<Uint8Array> | Uint8Array;
}

function getWebCrypto(): NonNullable<typeof globalThis.crypto> {
  if (globalThis.crypto === undefined || globalThis.crypto.subtle === undefined) {
    throw new Error(
      'Web Crypto API is not available in this runtime. Import pomegranate-db/encryption/node in Node.js environments without globalThis.crypto.subtle.',
    );
  }
  return globalThis.crypto;
}

export const webCryptoProvider: EncryptionProvider = {
  name: 'web-crypto',
  supportsAuthTag: false,
  randomBytes(length: number): Uint8Array {
    if (globalThis.crypto?.getRandomValues) {
      const buf = new Uint8Array(length);
      globalThis.crypto.getRandomValues(buf);
      return buf;
    }

    // Last resort for non-cryptographic test environments.
    const buf = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
    return buf;
  },
  async encrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array) {
    const crypto = getWebCrypto();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key.buffer as ArrayBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      cryptoKey,
      plaintext.buffer as ArrayBuffer,
    );
    return { ciphertext: new Uint8Array(encrypted) };
  },
  async decrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array) {
    const crypto = getWebCrypto();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key.buffer as ArrayBuffer,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      cryptoKey,
      ciphertext.buffer as ArrayBuffer,
    );
    return new Uint8Array(decrypted);
  },
};

// ─── Columns that are never encrypted ──────────────────────────────────

const PLAINTEXT_COLUMNS = new Set(['id', '_status', '_changed']);

// ─── Encryption Manager ───────────────────────────────────────────────

export class EncryptionManager {
  private _key: Uint8Array | null = null;
  private _keyProvider: () => Promise<Uint8Array>;
  private _provider: EncryptionProvider;

  constructor(
    keyProvider: () => Promise<Uint8Array>,
    provider: EncryptionProvider = webCryptoProvider,
  ) {
    this._keyProvider = keyProvider;
    this._provider = provider;
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
    const iv = await this._provider.randomBytes(12);
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    try {
      const { ciphertext, tag } = await this._provider.encrypt(key, iv, data);
      if (this._provider.supportsAuthTag && tag) {
        return encodeBase64(iv) + ':' + encodeBase64(ciphertext) + ':' + encodeBase64(tag);
      }
      return encodeBase64(iv) + ':' + encodeBase64(ciphertext);
    } catch {
      throw new Error('No crypto implementation available for encryption');
    }
  }

  /** Decrypt a string value */
  async decrypt(ciphertext: string): Promise<string> {
    const key = await this.getKey();
    const parts = ciphertext.split(':');

    try {
      const iv = decodeBase64(parts[0]);
      const data = decodeBase64(parts[1]);
      const tag = parts[2] ? decodeBase64(parts[2]) : undefined;
      const decrypted = await this._provider.decrypt(key, iv, data, tag);
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

  constructor(
    inner: StorageAdapter,
    keyProvider: () => Promise<Uint8Array>,
    provider: EncryptionProvider = webCryptoProvider,
  ) {
    this._inner = inner;
    this._encryption = new EncryptionManager(keyProvider, provider);
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
