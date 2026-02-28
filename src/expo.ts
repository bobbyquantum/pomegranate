/**
 * PomegranateDB — Expo entry point.
 *
 * Convenience module that re-exports everything from the main
 * package plus the Expo-specific driver.
 *
 * Usage:
 *   import { Database, SQLiteAdapter, createExpoSQLiteDriver } from 'pomegranate-db/expo';
 */

// Re-export everything from main package
export * from './index';

// Export Expo-specific driver
export { createExpoSQLiteDriver } from './adapters/expo-sqlite';
export type { ExpoSQLiteDriverConfig } from './adapters/expo-sqlite';
