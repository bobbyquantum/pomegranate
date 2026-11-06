/**
 * WatermelonDB `synchronize()` / `hasUnsyncedChanges()` / `SyncLogger` over
 * the core sync engine (always pull-first, as a WatermelonDB server expects).
 */

import { performSync, hasUnsyncedChanges as coreHasUnsyncedChanges } from '../sync/sync';
import type {
  SyncLog as CoreSyncLog,
  SyncMigrationInfo,
  SyncPullResult as CoreSyncPullResult,
  SyncPushResult,
  SyncTableChanges,
  TurboSyncSource,
} from '../sync/types';
import type { Database } from './Database';

export type SyncDatabaseChangeSet = SyncTableChanges;
export type SyncLog = Partial<CoreSyncLog>;

export interface SyncPullArgs {
  lastPulledAt: number | null;
  schemaVersion: number;
  migration: SyncMigrationInfo | null;
}

export type SyncPullResult = CoreSyncPullResult | TurboSyncSource;

export interface SyncPushArgs {
  changes: SyncDatabaseChangeSet;
  lastPulledAt: number;
}

export interface SyncArgs {
  database: Database;
  pullChanges: (args: SyncPullArgs) => Promise<SyncPullResult>;
  pushChanges: (args: SyncPushArgs) => Promise<void | SyncPushResult>;
  migrationsEnabledAtVersion?: number;
  sendCreatedAsUpdated?: boolean;
  /** Mutated in place as the sync progresses (use `SyncLogger.newLog()`). */
  log?: SyncLog;
  /** First-sync native import; `pullChanges` returns `{ syncJson }` or `{ syncJsonId }`. */
  unsafeTurbo?: boolean;
  /** Accepted and ignored. */
  _unsafeBatchPerCollection?: boolean;
  /** Not supported — throws if given. */
  conflictResolver?: unknown;
  /** Not supported — throws if given. */
  onDidPullChanges?: unknown;
  /** Not supported — throws if given. */
  onWillApplyRemoteChanges?: unknown;
}

export async function synchronize(args: SyncArgs): Promise<void> {
  const {
    database,
    pullChanges,
    pushChanges,
    migrationsEnabledAtVersion,
    sendCreatedAsUpdated,
    log,
    unsafeTurbo,
  } = args;
  for (const option of ['conflictResolver', 'onDidPullChanges', 'onWillApplyRemoteChanges'] as const) {
    if (args[option] !== undefined) {
      throw new Error(`synchronize(): ${option} is not supported by pomegranate-db/watermelon`);
    }
  }
  await database.ready;
  await performSync(database.pomegranate, {
    pullFirst: true,
    pullChanges,
    pushChanges,
    migrationsEnabledAtVersion,
    sendCreatedAsUpdated,
    log,
    unsafeTurbo,
  });
}

export async function hasUnsyncedChanges({ database }: { database: Database }): Promise<boolean> {
  await database.ready;
  return coreHasUnsyncedChanges(database.pomegranate);
}

/** Keeps the last `limit` sync logs, newest first. */
export class SyncLogger {
  readonly #limit: number;
  readonly #logs: SyncLog[] = [];

  constructor(limit = 10) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError('SyncLogger limit must be a positive integer');
    }
    this.#limit = limit;
  }

  /** A fresh log object to pass as `synchronize({ log })`; it is filled in place. */
  newLog(): SyncLog {
    const log: SyncLog = {};
    this.#logs.unshift(log);
    if (this.#logs.length > this.#limit) this.#logs.length = this.#limit;
    return log;
  }

  get logs(): SyncLog[] {
    return this.#logs;
  }

  get formattedLogs(): string {
    return JSON.stringify(this.#logs, null, 2);
  }
}
