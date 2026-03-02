const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ─── Cross-Origin Isolation headers ──────────────────────────────────────────
// expo-sqlite on web uses wa-sqlite (WASM) backed by OPFS, which requires
// Cross-Origin Isolation (crossOriginIsolated === true).
// COOP: same-origin  +  COEP: credentialless  enables SharedArrayBuffer
// without requiring every sub-resource to carry Cross-Origin-Resource-Policy,
// which Metro's dev-server bundles don't have.
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      return middleware(req, res, next);
    };
  },
};

module.exports = config;
