/**
 * Native SQLite Driver (JSI).
 *
 * Implements the SQLiteDriver interface using PomegranateDB's own JSI
 * C++ bridge. This is the fastest possible option — direct synchronous
 * calls from JS to C++ SQLite with zero bridge overhead.
 *
 * Requires:
 *   - PomegranateJSIPackage added to MainApplication (Android)
 *   - The native C++ module built and linked (via android-jsi module)
 *
 * Usage:
 *   import { SQLiteAdapter } from 'pomegranate-db';
 *   import { createNativeSQLiteDriver } from 'pomegranate-db/src/adapters/native-sqlite';
 *
 *   const adapter = new SQLiteAdapter({
 *     databaseName: 'myapp',
 *     driver: createNativeSQLiteDriver(),
 *   });
 */

import type { SQLiteDriver } from '../sqlite/SQLiteAdapter';

// ─── JSI Bridge Types ─────────────────────────────────────────────────────

/**
 * The shape of the JSI adapter object returned by nativePomegranateCreateAdapter.
 * All methods are synchronous JSI calls.
 */
interface NativeJSIAdapter {
  execute(sql: string, args: unknown[]): void;
  query(sql: string, args: unknown[]): Record<string, unknown>[];
  executeBatch(commands: Array<{ sql: string; args: unknown[] }>): number;
  close(): void;
}

declare global {
  // Installed by C++ via Database::install()
  var nativePomegranateCreateAdapter: ((dbName: string) => NativeJSIAdapter) | undefined;
}

// ─── Driver Config ────────────────────────────────────────────────────────

export interface NativeSQLiteDriverConfig {
  /**
   * If true, will attempt to auto-install the JSI binding by calling
   * NativeModules.PomegranateJSIBridge.install().
   * @default true
   */
  autoInstall?: boolean;
}

// ─── Driver ───────────────────────────────────────────────────────────────

/**
 * Create a SQLiteDriver backed by PomegranateDB's native JSI C++ bridge.
 *
 * This adapter communicates with C++ SQLite directly through JSI — no
 * React Native bridge, no JSON serialization, no async queues.
 * All calls are synchronous under the hood, wrapped in Promises for
 * the SQLiteDriver interface.
 */
export function createNativeSQLiteDriver(config?: NativeSQLiteDriverConfig): SQLiteDriver {
  let adapter: NativeJSIAdapter | null = null;
  const autoInstall = config?.autoInstall !== false;

  /**
   * Ensure the JSI binding is installed.
   * On Android, this requires calling NativeModules.PomegranateJSIBridge.install()
   * which loads the .so and registers the global function.
   */
  async function ensureInstalled(): Promise<void> {
    if (typeof globalThis.nativePomegranateCreateAdapter === 'function') {
      return; // Already installed
    }

    if (!autoInstall) {
      throw new Error(
        'PomegranateDB JSI binding is not installed. ' +
          'Call NativeModules.PomegranateJSIBridge.install() first, ' +
          'or pass autoInstall: true to createNativeSQLiteDriver().',
      );
    }

    // Auto-install by calling the native module
    try {
      const { NativeModules } = await import('react-native');
      const bridge = NativeModules.PomegranateJSIBridge;
      if (!bridge) {
        throw new Error(
          'PomegranateJSIBridge native module not found. ' +
            'Make sure PomegranateJSIPackage is added to your MainApplication.',
        );
      }
      const success = bridge.install();
      if (!success) {
        throw new Error('PomegranateJSIBridge.install() returned false');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error('Failed to install PomegranateDB JSI binding: ' + message, { cause: error });
    }

    if (typeof globalThis.nativePomegranateCreateAdapter !== 'function') {
      throw new TypeError(
        'PomegranateDB JSI binding installation succeeded but ' +
          'global.nativePomegranateCreateAdapter is not available. ' +
          'This may indicate a native build issue.',
      );
    }
  }

  function requireAdapter(): NativeJSIAdapter {
    if (!adapter) {
      throw new Error('Database not open. Call open() first.');
    }
    return adapter;
  }

  return {
    async open(name: string): Promise<void> {
      await ensureInstalled();
      adapter = globalThis.nativePomegranateCreateAdapter!(name);
    },

    async execute(sql: string, bindings?: unknown[]): Promise<void> {
      const db = requireAdapter();
      db.execute(sql, bindings ?? []);
    },

    async query(sql: string, bindings?: unknown[]): Promise<Record<string, unknown>[]> {
      const db = requireAdapter();
      return db.query(sql, bindings ?? []);
    },

    async executeInTransaction(fn: () => Promise<void>): Promise<void> {
      const db = requireAdapter();
      db.execute('BEGIN EXCLUSIVE TRANSACTION', []);
      try {
        await fn();
        db.execute('COMMIT', []);
      } catch (error) {
        db.execute('ROLLBACK', []);
        throw error;
      }
    },

    async close(): Promise<void> {
      if (adapter) {
        adapter.close();
        adapter = null;
      }
    },
  };
}
