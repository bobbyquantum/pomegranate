/**
 * React Native / Expo encryption entry.
 *
 * Re-exports the shared Web Crypto-based implementation with a clearer import
 * path for native apps.
 */

export { EncryptingAdapter, EncryptionManager, webCryptoProvider as reactNativeCryptoProvider } from './index';
export type { EncryptionProvider } from './index';