/**
 * Tests for the Encryption layer.
 */

import { EncryptionManager } from '../encryption';
import { EncryptingAdapter, webCryptoProvider } from '../encryption';
import {
  EncryptingAdapter as NodeEncryptingAdapter,
  EncryptionManager as NodeEncryptionManager,
  nodeCryptoProvider,
} from '../encryption/node';
import {
  EncryptingAdapter as ReactNativeEncryptingAdapter,
  EncryptionManager as ReactNativeEncryptionManager,
  reactNativeCryptoProvider,
} from '../encryption/react-native';

describe('EncryptionManager', () => {
  // Generate a test key (32 bytes for AES-256)
  const testKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) testKey[i] = i;

  const manager = new EncryptionManager(async () => testKey, nodeCryptoProvider);

  it('encrypts and decrypts a string', async () => {
    const plaintext = 'Hello, World!';
    const encrypted = await manager.encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(':'); // IV:ciphertext[:tag] format

    const decrypted = await manager.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const plaintext = 'same input';
    const a = await manager.encrypt(plaintext);
    const b = await manager.encrypt(plaintext);

    expect(a).not.toBe(b); // Different IVs should produce different outputs
  });

  it('handles empty string', async () => {
    const encrypted = await manager.encrypt('');
    const decrypted = await manager.decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  it('handles unicode', async () => {
    const plaintext = '🍉 PomegranateDB 日本語';
    const encrypted = await manager.encrypt(plaintext);
    const decrypted = await manager.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('handles long strings', async () => {
    const plaintext = 'x'.repeat(10_000);
    const encrypted = await manager.encrypt(plaintext);
    const decrypted = await manager.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('requires an auth tag for direct node provider decryption', () => {
    expect(() =>
      nodeCryptoProvider.decrypt(testKey, new Uint8Array(12), new Uint8Array([1, 2, 3])),
    ).toThrow('AES-GCM auth tag is required');
  });

  it('re-exports the shared encryption entry points for platform-specific imports', () => {
    expect(NodeEncryptionManager).toBe(EncryptionManager);
    expect(NodeEncryptingAdapter).toBe(EncryptingAdapter);
    expect(ReactNativeEncryptionManager).toBe(EncryptionManager);
    expect(ReactNativeEncryptingAdapter).toBe(EncryptingAdapter);
    expect(reactNativeCryptoProvider).toBe(webCryptoProvider);
  });
});
