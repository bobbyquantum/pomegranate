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

export interface SyncPullParams {
  lastPulledAt: number | null;
  /** The app's current schema version, for servers that shape the payload per version. */
  schemaVersion: number;
}

export interface SyncConfig {
  /**
   * Fetch changes from the server. Return parsed changes, or — for the first
   * sync with `unsafeTurbo` — a {@link TurboSyncSource}.
   */
  pullChanges: (params: SyncPullParams) => Promise<SyncPullResult | TurboSyncSource>;
  pushChanges: (params: SyncPushPayload) => Promise<void>;
  /** Optional: called when sync encounters a conflict */
  onConflict?: (local: RawRecord, remote: RawRecord) => RawRecord;
  /** Optional: tables to sync. If not specified, all tables are synced. */
  tables?: string[];
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
  pullTimestamp?: number;
  pushedTables?: string[];
  /** Present when the cycle ran as a turbo import. */
  turbo?: TurboSyncResult;
  error?: string;
}
