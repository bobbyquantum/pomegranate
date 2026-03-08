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

/** Changes for all tables keyed by table name. */
export type SyncTableChanges = Record<string, SyncTableChangeSet>;

/** Changes for a single table */
export interface SyncTableChangeSet {
  /** Records newly created on the source side. */
  created: RawRecord[];
  /** Existing records updated on the source side. */
  updated: RawRecord[];
  /** Record ids deleted on the source side. */
  deleted: string[];
}

// ─── Sync Push Payload ──────────────────────────────────────────────────

/** Payload sent to the push endpoint during a sync run. */
export interface SyncPushPayload {
  /** Local changes grouped by table. */
  changes: SyncTableChanges;
  /** Last pull timestamp acknowledged by the client. */
  lastPulledAt: number;
}

// ─── Sync Configuration ────────────────────────────────────────────────

/** Runtime callbacks and options needed to perform a sync cycle. */
export interface SyncConfig {
  /** Pull remote changes newer than the provided checkpoint. */
  pullChanges: (params: { lastPulledAt: number | null }) => Promise<SyncPullResult>;
  /** Push local changes to the remote backend. */
  pushChanges: (params: SyncPushPayload) => Promise<void>;
  /** Optional: called when sync encounters a conflict */
  onConflict?: (local: RawRecord, remote: RawRecord) => RawRecord;
  /** Optional: tables to sync. If not specified, all tables are synced. */
  tables?: string[];
}

// ─── Sync State ──────────────────────────────────────────────────────────

/** High-level lifecycle states emitted during a sync run. */
export type SyncState = 'idle' | 'pulling' | 'pushing' | 'applying' | 'complete' | 'error';

/** Lightweight sync run metadata exposed through `Database.observeSyncLog()`. */
export interface SyncLog {
  /** Unix timestamp when the sync run started. */
  startedAt: number;
  /** Unix timestamp when the sync run finished. */
  finishedAt?: number;
  /** Lifecycle state reached by the run. */
  state: SyncState;
  /** Server timestamp returned from the latest successful pull. */
  pullTimestamp?: number;
  /** Tables included in the push phase, when tracked. */
  pushedTables?: string[];
  /** Error message when the run fails. */
  error?: string;
}
