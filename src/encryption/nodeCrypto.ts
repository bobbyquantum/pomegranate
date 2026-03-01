/**
 * Node.js crypto provider — used on Node.js (tests, server-side).
 *
 * Metro bundler (React Native) will pick nodeCrypto.native.ts instead,
 * which doesn't import the Node `crypto` module.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto');

export function createCipheriv(
  algorithm: string,
  key: Uint8Array,
  iv: Uint8Array,
): { update(data: Uint8Array): Buffer; final(): Buffer; getAuthTag(): Buffer } {
  return crypto.createCipheriv(algorithm, key, iv);
}

export function createDecipheriv(
  algorithm: string,
  key: Uint8Array,
  iv: Uint8Array,
): { setAuthTag(tag: Uint8Array): void; update(data: Uint8Array): Buffer; final(): Buffer } {
  return crypto.createDecipheriv(algorithm, key, iv);
}

export function randomBytesNode(length: number): Uint8Array {
  return new Uint8Array(crypto.randomBytes(length));
}

export const isNodeCryptoAvailable = true;
