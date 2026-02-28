/**
 * Babel configuration for PomegranateDB.
 *
 * Used by Metro when bundling for React Native test apps.
 * Jest uses ts-jest directly, so this only affects native builds.
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
};
