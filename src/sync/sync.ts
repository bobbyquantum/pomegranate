/**
 * Sync engine — pull/push protocol compatible with Watermelon backend sync.
 *
 * The sync cycle:
 * 1. Push local changes to the server
 * 2. Pull remote changes from the server
 * 3. Apply remote changes locally (in a transaction)
 * 4. Mark pushed records as synced
 *
 * This follows a "push-first" strategy to minimize conflicts:
 * the server sees our changes before we pull theirs.
 *
 * Turbo mode (`unsafeTurbo: true`) is a separate first-sync path: the pull
 * payload is handed to the adapter whole (`applySyncJson`) and, on a native
 * SQLite driver, parsed and written in C++ without JS ever seeing the rows.
 */

import type { Database } from '../database/Database';
import type { RawRecord } from '../schema/types';
import type {
  SyncConfig,
  SyncLog,
  SyncPullResult,
  SyncState,
  SyncTableChangeSet,
  SyncTableChanges,
  TurboSyncSource,
} from './types';
import { logger } from '../utils';

interface SyncLifecycleObserver {
  onStateChange?: (state: SyncState) => void;
  onLogChange?: (log: SyncLog) => void;
}

// ─── Last Pulled At Storage ──────────────────────────────────────────────

const LAST_PULLED_AT_KEY = 'pomegranate_last_pulled_at';

/**
 * Adapters expose a key/value metadata store for this. The legacy fallback
 * below (a fake record in `__pomegranate_metadata`) only ever worked on Loki;
 * it is kept for third-party adapters that predate `getMetadata`.
 */
export async function getLastPulledAt(db: Database): Promise<number | null> {
  const adapter = db._adapter;
  if (adapter.getMetadata) {
    const value = await adapter.getMetadata(LAST_PULLED_AT_KEY);
    return value === null ? null : Number(value) || null;
  }
  try {
    const raw = await adapter.findById('__pomegranate_metadata', LAST_PULLED_AT_KEY);
    if (raw) return Number(raw.value) || null;
  } catch {
    // metadata table might not have this record
  }
  return null;
}

export async function setLastPulledAt(db: Database, timestamp: number): Promise<void> {
  const adapter = db._adapter;
  if (adapter.setMetadata) {
    await adapter.setMetadata(LAST_PULLED_AT_KEY, String(timestamp));
    return;
  }
  try {
    await adapter.batch([
      {
        type: 'create',
        table: '__pomegranate_metadata',
        rawRecord: { id: LAST_PULLED_AT_KEY, key: LAST_PULLED_AT_KEY, value: String(timestamp) },
      },
    ]);
  } catch {
    // If record exists, update it
    try {
      await adapter.update('__pomegranate_metadata', {
        id: LAST_PULLED_AT_KEY,
        key: LAST_PULLED_AT_KEY,
        value: String(timestamp),
        _status: 'synced',
        _changed: '',
      } as RawRecord);
    } catch {
      logger.warn('Could not persist lastPulledAt timestamp');
    }
  }
}

function isTurboSource(value: SyncPullResult | TurboSyncSource): value is TurboSyncSource {
  return 'syncJsonId' in value || 'syncJson' in value;
}

function hasAnyChanges(changes: SyncTableChanges): boolean {
  return Object.values(changes).some(
    (tc) => tc.created.length > 0 || tc.updated.length > 0 || tc.deleted.length > 0,
  );
}

// ─── Sync Implementation ────────────────────────────────────────────────

export async function performSync(
  db: Database,
  config: SyncConfig,
  observer: SyncLifecycleObserver = {},
): Promise<void> {
  const tables = config.tables ?? db.tables;
  const lastPulledAt = await getLastPulledAt(db);
  const log: SyncLog = {
    startedAt: Date.now(),
    state: 'idle',
  };

  const publishLog = () => {
    observer.onLogChange?.({ ...log });
  };

  const setState = (state: SyncState) => {
    log.state = state;
    observer.onStateChange?.(state);
    publishLog();
  };

  publishLog();

  logger.debug(`Sync starting. lastPulledAt: ${lastPulledAt}`);

  if (config.unsafeTurbo) {
    await performTurboSync(db, config, tables, lastPulledAt, log, setState);
    return;
  }

  try {
    // ── Step 1: Get local changes ──
    const localChanges = await db._adapter.getLocalChanges(tables);
    const hasLocalChanges = hasAnyChanges(localChanges);

    // Track which records were locally modified (needed for conflict detection after push)
    const locallyModifiedIds = new Set<string>();
    const locallyModifiedRecords = new Map<string, RawRecord>();
    for (const [_table, tc] of Object.entries(localChanges)) {
      for (const r of tc.updated) {
        locallyModifiedIds.add(r.id);
        locallyModifiedRecords.set(r.id, r);
      }
    }

    // ── Step 2: Push local changes (if any) ──
    if (hasLocalChanges) {
      setState('pushing');
      logger.debug('Pushing local changes...');

      // Strip internal sync fields before pushing
      const pushPayload = sanitizeForPush(localChanges);

      await config.pushChanges({
        changes: pushPayload,
        lastPulledAt: lastPulledAt ?? 0,
      });

      const pushedTables = tables.filter((table) => {
        const tableChanges = localChanges[table];
        return Boolean(
          tableChanges &&
            (tableChanges.created.length > 0 ||
              tableChanges.updated.length > 0 ||
              tableChanges.deleted.length > 0),
        );
      });
      if (pushedTables.length > 0) {
        log.pushedTables = pushedTables;
        publishLog();
      }

      // Mark all pushed records as synced
      for (const table of tables) {
        const tableChanges = localChanges[table];
        if (!tableChanges) continue;

        const syncedIds = [
          ...tableChanges.created.map((r) => r.id),
          ...tableChanges.updated.map((r) => r.id),
        ];

        if (syncedIds.length > 0) {
          await db._adapter.markAsSynced(table, syncedIds);
        }

        // Permanently remove locally-deleted records that were pushed
        if (tableChanges.deleted.length > 0) {
          for (const id of tableChanges.deleted) {
            await db._adapter.destroyPermanently(table, id);
          }
        }
      }

      logger.debug('Push complete.');
    }

    // ── Step 3: Pull remote changes ──
    setState('pulling');
    logger.debug('Pulling remote changes...');
    const pulled = await config.pullChanges({ lastPulledAt, schemaVersion: db.schemaVersion });
    const pullResult: SyncPullResult = isTurboSource(pulled) ? parseTurboSource(pulled) : pulled;
    log.pullTimestamp = pullResult.timestamp;
    publishLog();

    // ── Step 4: Apply remote changes ──
    const remoteChanges = pullResult.changes;
    const hasRemoteChanges = hasAnyChanges(remoteChanges);

    if (hasRemoteChanges) {
      setState('applying');
      logger.debug('Applying remote changes...');

      // Handle conflicts: if a record was modified both locally and remotely
      if (config.onConflict) {
        await resolveConflicts(
          db,
          remoteChanges,
          config.onConflict,
          locallyModifiedIds,
          locallyModifiedRecords,
        );
      }

      await db._adapter.applyRemoteChanges(remoteChanges);
      clearCaches(db, Object.keys(remoteChanges));

      logger.debug('Remote changes applied.');
    }

    // ── Step 5: Update lastPulledAt ──
    await setLastPulledAt(db, pullResult.timestamp);

    log.finishedAt = Date.now();
    setState('complete');
    logger.debug(`Sync complete. New lastPulledAt: ${pullResult.timestamp}`);
  } catch (error) {
    log.finishedAt = Date.now();
    log.error = error instanceof Error ? error.message : String(error);
    setState('error');
    throw error;
  }
}

// ─── Turbo Sync ─────────────────────────────────────────────────────────

/**
 * First-sync fast path. The server payload is handed to the adapter as a
 * whole; on `pomegranate-db/native-sqlite` it is parsed and written in C++.
 *
 * Preconditions (both enforced): this database has never pulled, and it has
 * no unsynced local changes. Turbo replaces local state rather than merging,
 * so running it against existing data would silently lose edits.
 */
async function performTurboSync(
  db: Database,
  config: SyncConfig,
  tables: string[],
  lastPulledAt: number | null,
  log: SyncLog,
  setState: (state: SyncState) => void,
): Promise<void> {
  try {
    if (lastPulledAt !== null) {
      throw new Error(
        'unsafeTurbo can only be used for the first sync of a database (lastPulledAt is already set). ' +
          'Call db.reset() first, or run a regular sync.',
      );
    }
    const localChanges = await db._adapter.getLocalChanges(tables);
    if (hasAnyChanges(localChanges)) {
      throw new Error(
        'unsafeTurbo cannot run while there are unsynced local changes — they would be lost. ' +
          'Run a regular sync first.',
      );
    }

    setState('pulling');
    logger.debug('Turbo sync: pulling payload...');
    const pulled = await config.pullChanges({ lastPulledAt: null, schemaVersion: db.schemaVersion });

    setState('applying');
    let timestamp: number;
    if (isTurboSource(pulled)) {
      const adapter = db._adapter;
      if (!adapter.applySyncJson) {
        throw new Error('This adapter does not support turbo sync (applySyncJson is not implemented).');
      }
      const result = await adapter.applySyncJson(pulled, db.schema);
      log.turbo = result;
      if (result.skippedTables > 0 || result.skippedColumns > 0) {
        logger.warn(
          `Turbo sync ignored ${result.skippedTables} unknown table(s) and dropped ` +
            `${result.skippedColumns} unknown column(s).`,
        );
      }
      if (result.timestamp === null) {
        throw new Error('Turbo sync payload has no "timestamp" field.');
      }
      timestamp = result.timestamp;
      logger.debug(
        `Turbo sync: imported ${result.inserted} row(s) into ${result.tables} table(s), deleted ${result.deleted}.`,
      );
    } else {
      // The server returned parsed changes after all — apply them the normal way.
      await db._adapter.applyRemoteChanges(pulled.changes);
      timestamp = pulled.timestamp;
    }

    db._clearAllCaches();
    log.pullTimestamp = timestamp;
    await setLastPulledAt(db, timestamp);

    log.finishedAt = Date.now();
    setState('complete');
    logger.debug(`Turbo sync complete. New lastPulledAt: ${timestamp}`);
  } catch (error) {
    log.finishedAt = Date.now();
    log.error = error instanceof Error ? error.message : String(error);
    setState('error');
    throw error;
  }
}

/** A regular sync received a turbo payload: parse JSON text, refuse native ids. */
function parseTurboSource(source: TurboSyncSource): SyncPullResult {
  if ('syncJson' in source) {
    return JSON.parse(source.syncJson) as SyncPullResult;
  }
  throw new Error(
    'pullChanges returned { syncJsonId } but unsafeTurbo is not enabled. ' +
      'Natively provided payloads can only be imported with `unsafeTurbo: true` on the first sync.',
  );
}

function clearCaches(db: Database, tables: string[]): void {
  for (const table of tables) {
    try {
      db.collection(table)._clearCache();
    } catch {
      // Table might not have a registered collection
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Remove internal sync columns (_status, _changed) from records
 * before sending to the server.
 */
function sanitizeForPush(changes: Record<string, SyncTableChangeSet>): SyncTableChanges {
  const sanitized: SyncTableChanges = {};

  for (const [table, tableChanges] of Object.entries(changes)) {
    sanitized[table] = {
      created: tableChanges.created.map(stripSyncColumns),
      updated: tableChanges.updated.map(stripSyncColumns),
      deleted: tableChanges.deleted,
    };
  }

  return sanitized;
}

function stripSyncColumns(raw: RawRecord): RawRecord {
  const { _status, _changed, ...rest } = raw;
  return { ...rest, _status: 'synced', _changed: '' } as RawRecord;
}

/**
 * Resolve conflicts between local and remote changes.
 * Uses locallyModifiedIds (collected before push) to detect records that
 * were modified locally, since push has already marked them as synced.
 */
async function resolveConflicts(
  db: Database,
  remoteChanges: Record<string, SyncTableChangeSet>,
  onConflict: (local: RawRecord, remote: RawRecord) => RawRecord,
  locallyModifiedIds: Set<string>,
  locallyModifiedRecords: Map<string, RawRecord>,
): Promise<void> {
  for (const [table, tableChanges] of Object.entries(remoteChanges)) {
    const resolvedUpdates: RawRecord[] = [];

    for (const remoteRecord of tableChanges.updated) {
      // Check if this record was locally modified (before push)
      if (locallyModifiedIds.has(remoteRecord.id)) {
        const localRecord =
          locallyModifiedRecords.get(remoteRecord.id) ??
          (await db._adapter.findById(table, remoteRecord.id));

        if (localRecord) {
          // Conflict! Both modified locally and remotely
          const resolved = onConflict(localRecord, remoteRecord);
          resolvedUpdates.push({ ...resolved, _status: 'synced', _changed: '' } as RawRecord);
        } else {
          resolvedUpdates.push(remoteRecord);
        }
      } else {
        resolvedUpdates.push(remoteRecord);
      }
    }

    tableChanges.updated = resolvedUpdates;
  }
}
