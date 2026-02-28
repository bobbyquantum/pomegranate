const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const pomegranateRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the parent pomegranate-db source
config.watchFolders = [pomegranateRoot];

// Resolve modules from both node_modules directories
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(pomegranateRoot, 'node_modules'),
];

module.exports = config;
