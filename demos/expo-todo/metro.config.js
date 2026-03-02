const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ─── Cross-Origin Isolation headers ──────────────────────────────────────────
// expo-sqlite on web uses wa-sqlite (WASM) backed by OPFS, which requires
// Cross-Origin Isolation (crossOriginIsolated === true).
// COOP: same-origin  +  COEP: credentialless  enables SharedArrayBuffer
// without requiring every sub-resource to carry Cross-Origin-Resource-Policy,
// which Metro's dev-server bundles don't have.
//
// NOTE: expo-sqlite on web requires a bundler that can handle Web Workers and
// .wasm imports (e.g., webpack).  Metro currently cannot resolve .wasm imports
// inside expo-sqlite's wa-sqlite worker, so the web expo-sqlite CI test is
// not yet supported.  See: https://github.com/nicolo-ribaudo/tc39-proposal-wasm-esm-integration
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
