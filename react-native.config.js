/**
 * React Native configuration for PomegranateDB.
 *
 * This is used by the RN autolinking system when building
 * the Android / iOS test apps in native/androidTest/ and native/iosTest/.
 */
module.exports = {
  project: {
    android: {
      sourceDir: './native/androidTest',
      appName: 'app',
    },
    ios: {
      sourceDir: './native/iosTest',
    },
  },
  // Pomegranate ships a native module — expose it for autolinking in consuming apps.
  dependency: {
    platforms: {
      ios: {
        podspecPath: './PomegranateDB.podspec',
      },
      android: {
        sourceDir: './native/android-jsi',
        packageImportPath: 'import com.pomegranate.jsi.PomegranateJSIPackage;',
        packageInstance: 'new PomegranateJSIPackage()',
      },
    },
  },
};
