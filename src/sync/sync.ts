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
 */

import type { Database } from '../database/Database';
import type { RawRecord } from '../schema/types';
import type { SyncConfig, SyncTableChanges, SyncTableChangeSet, SyncPullResult } from './types';
import { logger } from '../utils';

// ─── Last Pulled At Storage ──────────────────────────────────────────────

const LAST_PULLED_AT_KEY = 'pomegranate_last_pulled_at';

async function getLastPulledAt(db: Database): Promise<number | null> {
  try {
    // Store in adapter metadata if available, else use in-memory
    const raw = await db._adapter.findById('__pomegranate_metadata', LAST_PULLED_AT_KEY);
    if (raw) return Number((raw as any).value) || null;
  } catch {
    // metadata table might not have this record
  }
  return null;
}

async function setLastPulledAt(db: Database, timestamp: number): Promise<void> {
  try {
    await db._adapter.batch([
      {
        type: 'create',
        table: '__pomegranate_metadata',
        rawRecord: { id: LAST_PULLED_AT_KEY, key: LAST_PULLED_AT_KEY, value: String(timestamp) },
      },
    ]);
  } catch {
    // If record exists, update it
    try {
      await db._adapter.update('__pomegranate_metadata', {
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

// ─── Sync Implementation ────────────────────────────────────────────────

export async function performSync(db: Database, config: SyncConfig): Promise<void> {
  const tables = config.tables ?? db.tables;
  const lastPulledAt = await getLastPulledAt(db);

  logger.debug(`Sync starting. lastPulledAt: ${lastPulledAt}`);

  // ── Step 1: Get local changes ──
  const localChanges = await db._adapter.getLocalChanges(tables);
  const hasLocalChanges = Object.values(localChanges).some(
    (tc) => tc.created.length > 0 || tc.updated.length > 0 || tc.deleted.length > 0,
  );

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
    logger.debug('Pushing local changes...');

    // Strip internal sync fields before pushing
    const pushPayload = sanitizeForPush(localChanges);

    await config.pushChanges({
      changes: pushPayload,
      lastPulledAt: lastPulledAt ?? 0,
    });

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
  logger.debug('Pulling remote changes...');
  const pullResult: SyncPullResult = await config.pullChanges({ lastPulledAt });

  // ── Step 4: Apply remote changes ──
  const remoteChanges = pullResult.changes;
  const hasRemoteChanges = Object.values(remoteChanges).some(
    (tc) => tc.created.length > 0 || tc.updated.length > 0 || tc.deleted.length > 0,
  );

  if (hasRemoteChanges) {
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

    // Clear caches for affected collections
    for (const table of Object.keys(remoteChanges)) {
      try {
        const collection = db.collection(table);
        collection._clearCache();
      } catch {
        // Table might not have a registered collection
      }
    }

    logger.debug('Remote changes applied.');
  }

  // ── Step 5: Update lastPulledAt ──
  await setLastPulledAt(db, pullResult.timestamp);

  logger.debug(`Sync complete. New lastPulledAt: ${pullResult.timestamp}`);
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
