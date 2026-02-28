/**
 * Metro configuration for PomegranateDB integration tests.
 *
 * This config is used by the React Native Android test app
 * (native/androidTest/) to bundle the TypeScript source.
 */
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const config = {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
