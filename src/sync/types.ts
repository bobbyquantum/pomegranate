/**
 * Sync types — compatible with the Watermelon backend sync protocol.
 */

import type { RawRecord } from '../schema/types';

// ─── Sync Pull Response ──────────────────────────────────────────────────

export interface SyncPullResult {
  /** Changes from the server, grouped by table */
  changes: SyncTableChanges;
  /** Server timestamp of this pull */
  timestamp: number;
}

/** Changes for all tables */
export type SyncTableChanges = Record<string, SyncTableChangeSet>;

/** Changes for a single table */
export interface SyncTableChangeSet {
  created: RawRecord[];
  updated: RawRecord[];
  deleted: string[];
}

// ─── Sync Push Payload ──────────────────────────────────────────────────

export interface SyncPushPayload {
  changes: SyncTableChanges;
  lastPulledAt: number;
}

/**
 * Optional result of `pushChanges`. Records the server rejected (by table)
 * are left unsynced locally so they are pushed again next time.
 * `experimentalRejectedIds` is accepted as an alias for WatermelonDB drop-in
 * compatibility.
 */
export interface SyncPushResult {
  rejectedIds?: Record<string, string[]>;
  experimentalRejectedIds?: Record<string, string[]>;
}

// ─── Turbo Sync ─────────────────────────────────────────────────────────

/**
 * A pull payload handed to the adapter as a whole instead of parsed changes.
 *
 * - `syncJsonId` — the bytes were already stored natively (iOS
 *   `pomegranateProvideSyncJson`, Android `PomegranateSyncJson.provide`, or the
 *   `nativePomegranateProvideSyncJson` JSI global). Requires a driver with
 *   native turbo support (currently `pomegranate-db/native-sqlite`).
 * - `syncJson` — the payload as a JSON string. Native drivers import it in C++;
 *   other adapters fall back to `JSON.parse` + `applyRemoteChanges`.
 */
export type TurboSyncSource = { syncJsonId: number } | { syncJson: string };

/** Statistics returned by a turbo import. */
export interface TurboSyncResult {
  /** The payload's `timestamp`, or null if it had none. */
  timestamp: number | null;
  tables: number;
  inserted: number;
  deleted: number;
  /** Tables present in the payload but not in the schema (ignored). */
  skippedTables: number;
  /** Columns present in the payload but not in the schema (dropped). */
  skippedColumns: number;
}

// ─── Sync Configuration ────────────────────────────────────────────────

/**
 * WatermelonDB's `MigrationSyncPullArgs`: the tables and columns added since
 * the schema version this client last pulled with. A server that supports it
 * returns full snapshots of those tables/columns (regardless of
 * `lastPulledAt`) so a migrated client is not left with empty ones.
 */
export interface SyncMigrationInfo {
  /** The schema version the client last pulled with. */
  from: number;
  /** Tables created between `from` and the current schema version. */
  tables: string[];
  /** Columns added to pre-existing tables in that range. */
  columns: { table: string; columns: string[] }[];
}

export interface SyncPullParams {
  lastPulledAt: number | null;
  /** The app's current schema version, for servers that shape the payload per version. */
  schemaVersion: number;
  /**
   * Set when `migrationsEnabledAtVersion` is configured, this is not the first
   * sync, and the schema version has changed since the last pull. `null`
   * otherwise. See {@link SyncMigrationInfo}.
   */
  migration: SyncMigrationInfo | null;
}

export interface SyncConfig {
  /**
   * Fetch changes from the server. Return parsed changes, or — for the first
   * sync with `unsafeTurbo` — a {@link TurboSyncSource}.
   */
  pullChanges: (params: SyncPullParams) => Promise<SyncPullResult | TurboSyncSource>;
  /** Send local changes to the server. May report rejected ids. */
  pushChanges: (params: SyncPushPayload) => Promise<void | SyncPushResult>;
  /**
   * Optional override of the built-in merge. Called for each record that was
   * edited locally and also changed on the server, with the local snapshot
   * and the record the merge would otherwise write (server values for every
   * column except the locally changed ones). Return the record to store.
   */
  onConflict?: (local: RawRecord, merged: RawRecord) => RawRecord;
  /** Optional: tables to sync. If not specified, all tables are synced. */
  tables?: string[];
  /**
   * Run the cycle in WatermelonDB's order — pull, apply, push — instead of
   * the default push-first order.
   *
   * Pull-first lets the merge see local edits before they are pushed, so the
   * `_changed`-aware resolution actually runs; it also means a push that
   * fails leaves the pulled data applied and `lastPulledAt` advanced, with the
   * local changes simply staying unsynced. Push-first shows the server your
   * changes before you take theirs, but every locally edited record has
   * already been marked synced by the time the pull is applied, so remote
   * updates overwrite it. Servers implementing WatermelonDB's protocol
   * expect pull-first.
   */
  pullFirst?: boolean;
  /**
   * Enable migration-aware pulls. The schema version at which the app started
   * shipping `migrations`; older installs that synced before then are assumed
   * to have been at this version. When set, `pullChanges` receives a
   * `migration` argument after every schema upgrade.
   */
  migrationsEnabledAtVersion?: number;
  /** Push locally created records in `updated` instead of `created`. */
  sendCreatedAsUpdated?: boolean;
  /**
   * An object to mutate in place with the {@link SyncLog} fields as the cycle
   * progresses (WatermelonDB's `log` option). Useful for error reports.
   */
  log?: Partial<SyncLog>;
  /**
   * Turbo mode: import the pull payload natively without building JS objects.
   *
   * Only valid for the first sync of a database (no `lastPulledAt`) with no
   * unsynced local changes — the payload replaces local state rather than
   * merging with it, which is why it is "unsafe". `pullChanges` must return a
   * {@link TurboSyncSource}. The `pushChanges` callback is not called.
   */
  unsafeTurbo?: boolean;
}

// ─── Sync State ──────────────────────────────────────────────────────────

export type SyncState = 'idle' | 'pulling' | 'pushing' | 'applying' | 'complete' | 'error';

export interface SyncLog {
  startedAt: number;
  finishedAt?: number;
  state: SyncState;
  /** Human-readable description of what the cycle is doing / did last. */
  phase?: string;
  /** Checkpoint the cycle started from (`null` on the first sync). */
  lastPulledAt?: number | null;
  /** Checkpoint returned by this pull. */
  newLastPulledAt?: number;
  /** Alias of `newLastPulledAt`, kept for existing consumers. */
  pullTimestamp?: number;
  /** Schema version of the previous pull, when recorded. */
  lastPulledSchemaVersion?: number;
  /** The `migration` argument sent with the pull. */
  migration?: SyncMigrationInfo | null;
  /** Number of created + updated + deleted records received. */
  remoteChangeCount?: number;
  /** Number of created + updated + deleted records found locally. */
  localChangeCount?: number;
  pushedTables?: string[];
  /** Ids the server rejected on push, by table. */
  rejectedIds?: Record<string, string[]>;
  /** How many records went through `onConflict`. */
  resolvedConflicts?: number;
  /** Present when the cycle ran as a turbo import. */
  turbo?: TurboSyncResult;
  error?: string;
}
