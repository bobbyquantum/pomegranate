/**
 * Tests for the Encryption layer.
 */

import { EncryptionManager } from '../encryption';

describe('EncryptionManager', () => {
  // Generate a test key (32 bytes for AES-256)
  const testKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) testKey[i] = i;

  const manager = new EncryptionManager(async () => testKey);

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
});
