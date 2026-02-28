// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: {
    About: [
      'getting-started',
    ],
    Setup: [
      'installation',
      'schema',
      'models',
      'database',
    ],
    'Usage': [
      'crud',
      'queries',
      'react-hooks',
      'observation',
    ],
    'Adapters': [
      'adapters/overview',
      'adapters/loki',
      'adapters/sqlite',
      'adapters/expo-sqlite',
      'adapters/op-sqlite',
      'adapters/native-jsi',
    ],
    'Sync': [
      'sync',
    ],
    'Advanced': [
      'advanced/encryption',
      'advanced/migrations',
      'advanced/performance',
    ],
    'Contributing': [
      'contributing',
      'architecture',
    ],
  },
}

module.exports = sidebars
