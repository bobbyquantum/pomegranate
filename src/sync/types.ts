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

// ─── Sync Configuration ────────────────────────────────────────────────

export interface SyncConfig {
  pullChanges: (params: { lastPulledAt: number | null }) => Promise<SyncPullResult>;
  pushChanges: (params: SyncPushPayload) => Promise<void>;
  /** Optional: called when sync encounters a conflict */
  onConflict?: (local: RawRecord, remote: RawRecord) => RawRecord;
  /** Optional: tables to sync. If not specified, all tables are synced. */
  tables?: string[];
}

// ─── Sync State ──────────────────────────────────────────────────────────

export type SyncState = 'idle' | 'pulling' | 'pushing' | 'applying' | 'complete' | 'error';

export interface SyncLog {
  startedAt: number;
  finishedAt?: number;
  state: SyncState;
  pullTimestamp?: number;
  pushedTables?: string[];
  error?: string;
}
