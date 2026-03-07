/**
 * Node.js-specific crypto provider for environments that do not expose
 * `globalThis.crypto.subtle`.
 */

import { EncryptingAdapter, EncryptionManager } from './index';
import type { EncryptionProvider } from './index';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto');

export const nodeCryptoProvider: EncryptionProvider = {
  name: 'node-crypto',
  supportsAuthTag: true,
  randomBytes(length: number): Uint8Array {
    return new Uint8Array(crypto.randomBytes(length));
  },
  encrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array) {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { ciphertext, tag: cipher.getAuthTag() };
  },
  decrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, tag?: Uint8Array) {
    if (!tag) {
      throw new Error('AES-GCM auth tag is required when using nodeCryptoProvider');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(tag));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  },
};

export { EncryptingAdapter, EncryptionManager };
export type { EncryptionProvider };
