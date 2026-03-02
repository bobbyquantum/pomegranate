const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ─── Cross-Origin Isolation headers ──────────────────────────────────────────
// expo-sqlite on web uses wa-sqlite (WASM) backed by OPFS, which requires
// Cross-Origin Isolation.  These headers make it work on Metro's dev server.
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      return middleware(req, res, next);
    };
  },
};

module.exports = config;
