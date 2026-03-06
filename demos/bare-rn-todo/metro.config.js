const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // Allow imports from demos/shared/ (e.g. ../shared/benchmarks)
  watchFolders: [path.resolve(__dirname, '..', 'shared')],
  resolver: {
    // Ensure modules imported from demos/shared/ can resolve dependencies
    // (e.g. @babel/runtime) from this project's node_modules.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    // pomegranate-db ships optional adapters (expo-sqlite, etc.) that
    // reference peer dependencies not present in this Expo-free project.
    // Tell Metro to resolve those imports to an empty module instead of
    // failing with "Unable to resolve module".
    resolveRequest: (context, moduleName, platform) => {
      const expoOnlyModules = ['expo-sqlite', 'expo-modules-core'];
      if (expoOnlyModules.includes(moduleName)) {
        return {
          filePath: path.resolve(__dirname, 'empty-module.js'),
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
