/**
 * Node.js crypto provider — React Native stub.
 *
 * Metro picks .native.ts files over .ts for React Native bundles.
 * This avoids importing the Node `crypto` module which doesn't exist
 * in React Native and would cause Metro bundling to fail.
 *
 * React Native should use globalThis.crypto (Web Crypto API) instead.
 */

export function createCipheriv(
  _algorithm: string,
  _key: Uint8Array,
  _iv: Uint8Array,
): never {
  throw new Error(
    'Node.js crypto is not available in React Native. Use Web Crypto API via globalThis.crypto.subtle.',
  );
}

export function createDecipheriv(
  _algorithm: string,
  _key: Uint8Array,
  _iv: Uint8Array,
): never {
  throw new Error(
    'Node.js crypto is not available in React Native. Use Web Crypto API via globalThis.crypto.subtle.',
  );
}

export function randomBytesNode(_length: number): never {
  throw new Error(
    'Node.js crypto is not available in React Native. Use globalThis.crypto.getRandomValues.',
  );
}

export const isNodeCryptoAvailable = false;
