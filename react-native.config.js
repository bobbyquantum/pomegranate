/**
 * React Native configuration for PomegranateDB.
 *
 * This is needed by the RN autolinking system when building
 * the Android test app in native/androidTest/.
 */
module.exports = {
  project: {
    android: {
      sourceDir: './native/androidTest',
      appName: 'app',
    },
  },
  // No native dependencies to autolink — we use pure JS/TS
  dependencies: {},
};
