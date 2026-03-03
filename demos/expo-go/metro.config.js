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

module.exports = config;
