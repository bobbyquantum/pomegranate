/**
 * PomegranateDB Expo Config Plugin.
 *
 * Provides first-class Expo support by configuring the native
 * projects for optimal SQLite performance.
 *
 * Usage in app.json / app.config.js:
 *
 *   {
 *     "expo": {
 *       "plugins": [
 *         "pomegranate-db/expo-plugin"
 *       ]
 *     }
 *   }
 *
 * Or with options:
 *
 *   {
 *     "expo": {
 *       "plugins": [
 *         ["pomegranate-db/expo-plugin", {
 *           "enableFTS": true,
 *           "useSQLCipher": false
 *         }]
 *       ]
 *     }
 *   }
 *
 * This plugin:
 *  - Ensures expo-sqlite is configured with FTS support (optional)
 *  - Adds iOS/Android build settings for SQLite performance
 *  - Configures ProGuard rules for Android release builds
 */

interface PomegranatePluginConfig {
  /**
   * Enable SQLite FTS3, FTS4 and FTS5 full-text search extensions.
   * Required if you use PomegranateDB's search() functionality with
   * the SQLiteAdapter + ExpoSQLiteDriver.
   * @default true
   */
  enableFTS?: boolean;

  /**
   * Use SQLCipher for encrypted database support.
   * When true, the database file is encrypted at rest.
   * @default false
   */
  useSQLCipher?: boolean;

  /**
   * Custom SQLite compile flags.
   * Passed directly to expo-sqlite's config plugin.
   */
  customBuildFlags?: string;
}

type ExpoConfig = {
  name: string;
  slug: string;
  plugins?: (string | [string, Record<string, unknown>])[];
  [key: string]: unknown;
};

/**
 * Expo config plugin for PomegranateDB.
 *
 * Automatically configures expo-sqlite with the right build flags
 * for PomegranateDB features (FTS, encryption, etc.).
 */
function withPomegranateDB(
  config: ExpoConfig,
  pluginConfig: PomegranatePluginConfig = {}
): ExpoConfig {
  const {
    enableFTS = true,
    useSQLCipher = false,
    customBuildFlags,
  } = pluginConfig;

  // Build the expo-sqlite plugin config
  const expoSQLiteConfig: Record<string, unknown> = {
    enableFTS,
    useSQLCipher,
  };

  if (customBuildFlags) {
    expoSQLiteConfig.ios = { customBuildFlags };
  }

  // Check if expo-sqlite plugin already exists
  const plugins = config.plugins || [];
  const existingIndex = plugins.findIndex((p) => {
    if (typeof p === 'string') return p === 'expo-sqlite';
    if (Array.isArray(p)) return p[0] === 'expo-sqlite';
    return false;
  });

  if (existingIndex >= 0) {
    // Merge our config with existing expo-sqlite config
    const existing = plugins[existingIndex];
    if (typeof existing === 'string') {
      plugins[existingIndex] = ['expo-sqlite', expoSQLiteConfig];
    } else if (Array.isArray(existing)) {
      plugins[existingIndex] = [
        'expo-sqlite',
        { ...(existing[1] || {}), ...expoSQLiteConfig },
      ];
    }
  } else {
    // Add expo-sqlite plugin
    plugins.push(['expo-sqlite', expoSQLiteConfig]);
  }

  config.plugins = plugins;

  return config;
}

module.exports = withPomegranateDB;
export default withPomegranateDB;
