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
import type { TurboSyncResult, TurboSyncSource } from '../../sync/types';

// ─── JSI Bridge Types ─────────────────────────────────────────────────────

/**
 * The shape of the JSI adapter object returned by nativePomegranateCreateAdapter.
 * All methods are synchronous JSI calls.
 */
interface NativeJSIAdapter {
  execute(sql: string, args: unknown[]): void;
  query(sql: string, args: unknown[]): Record<string, unknown>[];
  executeBatch(commands: Array<{ sql: string; args: unknown[] }>): number;
  /** Turbo sync: import the payload stored under `syncJsonId` (see provideSyncJson). */
  applySyncJson(syncJsonId: number, tableColumns?: Record<string, string[]>): TurboSyncResult;
  /** Turbo sync: import a payload passed as a JS string. */
  applySyncJsonText(json: string, tableColumns?: Record<string, string[]>): TurboSyncResult;
  close(): void;
}

declare global {
  // Installed by C++ via Database::install()
  var nativePomegranateCreateAdapter: ((dbName: string) => NativeJSIAdapter) | undefined;
  var nativePomegranateProvideSyncJson: ((syncJsonId: number, json: string) => void) | undefined;
  var nativePomegranateDiscardSyncJson: ((syncJsonId: number) => boolean) | undefined;
}

// ─── Turbo sync store (JS side) ───────────────────────────────────────────

/**
 * Store a sync payload in native memory under `syncJsonId`, to be imported by
 * `db.sync({ unsafeTurbo: true, pullChanges: async () => ({ syncJsonId }) })`.
 *
 * This is the JS entry point; native download modules should call the
 * platform API instead (`pomegranateProvideSyncJson` on iOS,
 * `PomegranateSyncJson.provide` on Android) so the bytes never cross into JS.
 * Requires the JSI binding to be installed.
 */
export function provideSyncJson(syncJsonId: number, json: string): void {
  if (typeof globalThis.nativePomegranateProvideSyncJson !== 'function') {
    throw new TypeError(
      'PomegranateDB JSI binding is not installed — open a native-sqlite database first.',
    );
  }
  globalThis.nativePomegranateProvideSyncJson(syncJsonId, json);
}

/** Drop a payload stored with provideSyncJson. Returns true if one existed. */
export function discardSyncJson(syncJsonId: number): boolean {
  if (typeof globalThis.nativePomegranateDiscardSyncJson !== 'function') {
    return false;
  }
  return globalThis.nativePomegranateDiscardSyncJson(syncJsonId);
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
        try {
          db.execute('ROLLBACK', []);
        } catch {
          // Preserve the original write error when rollback also fails.
        }
        throw error;
      }
    },

    async executeBatch(commands: Array<[string, unknown[]]>): Promise<void> {
      const db = requireAdapter();
      // Single JSI call: sends all commands to C++ which runs them
      // in one transaction — avoids per-statement JSI round-trips.
      db.executeBatch(
        commands.map(([sql, bindings]) => ({ sql, args: bindings })),
      );
    },

    async applySyncJson(
      source: TurboSyncSource,
      tableColumns: Record<string, string[]>,
    ): Promise<TurboSyncResult> {
      const db = requireAdapter();
      // Single JSI call: C++ parses the payload with simdjson and writes every
      // row inside one transaction. The JS thread never sees the records.
      return 'syncJsonId' in source
        ? db.applySyncJson(source.syncJsonId, tableColumns)
        : db.applySyncJsonText(source.syncJson, tableColumns);
    },

    async close(): Promise<void> {
      if (adapter) {
        adapter.close();
        adapter = null;
      }
    },

    // ── Raw sync/async for benchmarking ──────────────────────────────────
    // NativeSQLite is always sync (JSI direct calls), so executeSync is
    // the natural path and executeAsync is just a Promise wrapper.

    executeSync(sql: string, bindings?: unknown[]): void {
      const db = requireAdapter();
      db.execute(sql, bindings ?? []);
    },

    async executeAsync(sql: string, bindings?: unknown[]): Promise<void> {
      const db = requireAdapter();
      db.execute(sql, bindings ?? []);
    },
  };
}
