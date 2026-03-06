const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow imports from demos/shared/ (e.g. ../shared/benchmarks)
config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(__dirname, '..', 'shared'),
];

// Ensure modules imported from demos/shared/ can resolve dependencies
// (e.g. @babel/runtime) from this project's node_modules.
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths || []),
  path.resolve(__dirname, 'node_modules'),
];

// ─── WASM asset support ──────────────────────────────────────────────────────
// expo-sqlite on web uses wa-sqlite compiled to WASM.  Metro doesn't recognise
// .wasm files by default — register them as assets so Metro serves them as
// static binaries instead of trying to parse them as JavaScript.
config.resolver.assetExts.push('wasm');

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
