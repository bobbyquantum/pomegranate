/**
 * Sync engine — pull/push protocol compatible with Watermelon backend sync.
 *
 * Two orderings are available:
 *
 * **Push-first** (default, `pullFirst: false`):
 * 1. Snapshot local changes and push them
 * 2. Mark pushed records as synced
 * 3. Pull remote changes and apply them (in a transaction)
 * 4. Persist `lastPulledAt`
 *
 * **Pull-first** (`pullFirst: true`, WatermelonDB's order):
 * 1. Pull remote changes and apply them, merging with pending local edits
 *    (locally changed columns win, everything else comes from the server)
 * 2. Persist `lastPulledAt`
 * 3. Snapshot local changes — now carrying the merged server values — and
 *    push them with `lastPulledAt` = the new checkpoint
 * 4. Mark the pushed records as synced — only those that were not modified
 *    again while the push was in flight
 *
 * Pull-first is what a WatermelonDB-protocol server expects, and it is the
 * only ordering under which the `_changed`-aware merge in
 * `StorageAdapter.applyRemoteChanges` has anything to merge. Its trade-off: a
 * push that fails after a successful pull leaves the pulled data applied and
 * the checkpoint advanced; the local changes stay unsynced and go out on the
 * next cycle. Push-first shows the server your changes before you take
 * theirs, but every locally edited record has already been marked synced by
 * the time remote changes are applied, so a remote update simply overwrites.
 *
 * Turbo mode (`unsafeTurbo: true`) is a separate first-sync path: the pull
 * payload is handed to the adapter whole (`applySyncJson`) and, on a native
 * SQLite driver, parsed and written in C++ without JS ever seeing the rows.
 */

import type { Database } from '../database/Database';
import type { Collection } from '../collection/Collection';
import { migrationSyncInfo } from '../database/migrations';
import type { RawRecord } from '../schema/types';
import { mergeRemoteIntoLocal } from '../adapters/remoteMerge';
import { filterChangesToSchema } from './schemaFilter';
import type {
  SyncConfig,
  SyncLog,
  SyncMigrationInfo,
  SyncPullResult,
  SyncPushResult,
  SyncState,
  SyncTableChanges,
  TurboSyncSource,
} from './types';
import { logger } from '../utils';

interface SyncLifecycleObserver {
  onStateChange?: (state: SyncState) => void;
  onLogChange?: (log: SyncLog) => void;
}

// ─── Metadata storage ───────────────────────────────────────────────────

const LAST_PULLED_AT_KEY = 'pomegranate_last_pulled_at';
const LAST_PULLED_SCHEMA_VERSION_KEY = 'pomegranate_last_pulled_schema_version';

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

/** The schema version the last successful pull ran with, if recorded. */
export async function getLastPulledSchemaVersion(db: Database): Promise<number | null> {
  const adapter = db._adapter;
  if (!adapter.getMetadata) return null;
  const value = await adapter.getMetadata(LAST_PULLED_SCHEMA_VERSION_KEY);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function setLastPulledSchemaVersion(db: Database, version: number): Promise<void> {
  await db._adapter.setMetadata?.(LAST_PULLED_SCHEMA_VERSION_KEY, String(version));
}

// ─── Public helpers ─────────────────────────────────────────────────────

/** Whether any record in `tables` (default: all) is waiting to be pushed. */
export async function hasUnsyncedChanges(db: Database, tables?: string[]): Promise<boolean> {
  const changes = await db._adapter.getLocalChanges(tables ?? db.tables);
  return hasAnyChanges(changes);
}

function isTurboSource(value: SyncPullResult | TurboSyncSource): value is TurboSyncSource {
  return 'syncJsonId' in value || 'syncJson' in value;
}

function hasAnyChanges(changes: SyncTableChanges): boolean {
  return Object.values(changes).some(
    (tc) => tc.created.length > 0 || tc.updated.length > 0 || tc.deleted.length > 0,
  );
}

function countChanges(changes: SyncTableChanges): number {
  let count = 0;
  for (const tc of Object.values(changes)) {
    count += tc.created.length + tc.updated.length + tc.deleted.length;
  }
  return count;
}

// ─── Sync run context ───────────────────────────────────────────────────

interface SyncRun {
  db: Database;
  config: SyncConfig;
  tables: string[];
  lastPulledAt: number | null;
  migration: SyncMigrationInfo | null;
  log: SyncLog;
  setState: (state: SyncState, phase: string) => void;
  setPhase: (phase: string) => void;
}

// ─── Sync Implementation ────────────────────────────────────────────────

export async function performSync(
  db: Database,
  config: SyncConfig,
  observer: SyncLifecycleObserver = {},
): Promise<void> {
  const tables = config.tables ?? db.tables;
  const lastPulledAt = await getLastPulledAt(db);
  const lastPulledSchemaVersion = await getLastPulledSchemaVersion(db);
  const log: SyncLog = {
    startedAt: Date.now(),
    state: 'idle',
    phase: 'starting',
    lastPulledAt,
  };
  if (lastPulledSchemaVersion !== null) log.lastPulledSchemaVersion = lastPulledSchemaVersion;

  const publishLog = () => {
    if (config.log) Object.assign(config.log, log);
    observer.onLogChange?.({ ...log });
  };

  const setPhase = (phase: string) => {
    log.phase = phase;
    publishLog();
  };

  const setState = (state: SyncState, phase: string) => {
    log.state = state;
    log.phase = phase;
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
    const migration = computeMigrationInfo(db, config, lastPulledAt, lastPulledSchemaVersion);
    log.migration = migration;
    publishLog();

    const run: SyncRun = { db, config, tables, lastPulledAt, migration, log, setState, setPhase };

    if (config.pullFirst) {
      await runPullFirst(run);
    } else {
      await runPushFirst(run);
    }

    log.finishedAt = Date.now();
    setState('complete', 'done');
    logger.debug(`Sync complete. New lastPulledAt: ${log.newLastPulledAt}`);
  } catch (error) {
    log.finishedAt = Date.now();
    log.error = error instanceof Error ? error.message : String(error);
    setState('error', `failed: ${log.error}`);
    throw error;
  }
}

// ─── Orderings ──────────────────────────────────────────────────────────

async function runPushFirst(run: SyncRun): Promise<void> {
  const { db, config, lastPulledAt } = run;

  const localChanges = await readLocalChanges(run);
  if (hasAnyChanges(localChanges)) {
    await pushLocalChanges(run, localChanges, lastPulledAt ?? 0);
  }

  const pullResult = await pullRemoteChanges(run);
  const remoteChanges = await prepareRemoteChanges(run, pullResult);

  if (hasAnyChanges(remoteChanges)) {
    run.setState('applying', 'applying remote changes');
    // The push has marked every local edit as synced, so the record the merge
    // would write is the remote one; onConflict still gets the local snapshot.
    const resolved = config.onConflict
      ? resolveConflicts(run, localChanges, remoteChanges, (_local, remote) => remote, 'synced')
      : [];
    await db._adapter.applyRemoteChanges(remoteChanges);
    await writeResolved(run, resolved);
    clearCaches(db, Object.keys(remoteChanges));
    logger.debug('Remote changes applied.');
  }

  await recordPull(run, pullResult.timestamp);
}

async function runPullFirst(run: SyncRun): Promise<void> {
  const { db, config } = run;

  // Only needed to hand `onConflict` the pre-merge local record.
  const pendingBeforePull = config.onConflict ? await readLocalChanges(run) : undefined;

  const pullResult = await pullRemoteChanges(run);
  const remoteChanges = await prepareRemoteChanges(run, pullResult);

  if (hasAnyChanges(remoteChanges)) {
    run.setState('applying', 'applying remote changes');
    // Local edits are still pending here, so the adapter merges them; the
    // onConflict override sees exactly the record that merge would produce.
    const resolved = pendingBeforePull
      ? resolveConflicts(run, pendingBeforePull, remoteChanges, mergeRemoteIntoLocal, 'local')
      : [];
    await db._adapter.applyRemoteChanges(remoteChanges);
    await writeResolved(run, resolved);
    clearCaches(db, Object.keys(remoteChanges));
    logger.debug('Remote changes applied.');
  }

  // The pull has been applied, so the checkpoint advances even if the push
  // below fails — the local changes simply stay unsynced until next time.
  await recordPull(run, pullResult.timestamp);

  // Read local changes *after* the merge so the push carries the merged
  // server values, exactly as WatermelonDB does.
  const localChanges = await readLocalChanges(run);
  if (hasAnyChanges(localChanges)) {
    await pushLocalChanges(run, localChanges, pullResult.timestamp);
  }
}

// ─── Steps ──────────────────────────────────────────────────────────────

async function readLocalChanges(run: SyncRun): Promise<SyncTableChanges> {
  run.setPhase('reading local changes');
  const localChanges = await run.db._adapter.getLocalChanges(run.tables);
  run.log.localChangeCount = countChanges(localChanges);
  return localChanges;
}

async function pullRemoteChanges(run: SyncRun): Promise<SyncPullResult> {
  const { db, config, lastPulledAt, migration, log } = run;
  run.setState('pulling', 'pulling remote changes');
  logger.debug('Pulling remote changes...');

  const pulled = await config.pullChanges({
    lastPulledAt,
    schemaVersion: db.schemaVersion,
    migration,
  });
  const pullResult: SyncPullResult = isTurboSource(pulled) ? parseTurboSource(pulled) : pulled;
  if (typeof pullResult.timestamp !== 'number') {
    throw new TypeError('pullChanges result has no numeric "timestamp" field.');
  }
  log.pullTimestamp = pullResult.timestamp;
  log.newLastPulledAt = pullResult.timestamp;
  return pullResult;
}

/** Shape the pulled changes to the schema and record their size in the log. */
async function prepareRemoteChanges(
  run: SyncRun,
  pullResult: SyncPullResult,
): Promise<SyncTableChanges> {
  const filtered = filterChangesToSchema(pullResult.changes ?? {}, run.db.schema);
  if (filtered.skippedTables > 0 || filtered.skippedColumns > 0) {
    logger.warn(
      `Sync ignored ${filtered.skippedTables} unknown table(s) and dropped ` +
        `${filtered.skippedColumns} unknown column value(s) from the pull payload.`,
    );
  }
  run.log.remoteChangeCount = countChanges(filtered.changes);
  run.setPhase('received remote changes');
  return filtered.changes;
}

async function recordPull(run: SyncRun, timestamp: number): Promise<void> {
  await setLastPulledAt(run.db, timestamp);
  await setLastPulledSchemaVersion(run.db, run.db.schemaVersion);
  run.log.lastPulledSchemaVersion = run.db.schemaVersion;
}

async function pushLocalChanges(
  run: SyncRun,
  localChanges: SyncTableChanges,
  lastPulledAt: number,
): Promise<void> {
  const { db, config, tables, log } = run;
  run.setState('pushing', 'pushing local changes');
  logger.debug('Pushing local changes...');

  const pushResult = await config.pushChanges({
    changes: buildPushPayload(localChanges, config.sendCreatedAsUpdated ?? false),
    lastPulledAt,
  });

  const rejectedIds = normalizeRejectedIds(pushResult);
  if (rejectedIds) log.rejectedIds = rejectedIds;

  const pushedTables = tables.filter((table) => {
    const tc = localChanges[table];
    return Boolean(tc && (tc.created.length > 0 || tc.updated.length > 0 || tc.deleted.length > 0));
  });
  if (pushedTables.length > 0) log.pushedTables = pushedTables;

  run.setPhase('marking pushed records as synced');
  await markLocalChangesAsSynced(db, localChanges, rejectedIds);
  logger.debug('Push complete.');
}

/**
 * Mark the pushed snapshot as synced — but only records whose current row is
 * identical to the snapshot. A record edited again while the push was in
 * flight keeps its `updated` status and `_changed` so the new edit goes out
 * on the next cycle. Rejected ids are left alone too.
 */
async function markLocalChangesAsSynced(
  db: Database,
  snapshot: SyncTableChanges,
  rejectedIds: Record<string, string[]> | undefined,
): Promise<void> {
  const tablesWithChanges = Object.entries(snapshot)
    .filter(([, tc]) => tc.created.length > 0 || tc.updated.length > 0 || tc.deleted.length > 0)
    .map(([table]) => table);
  if (tablesWithChanges.length === 0) return;

  const current = await db._adapter.getLocalChanges(tablesWithChanges);

  for (const table of tablesWithChanges) {
    const before = snapshot[table];
    const now = current[table] ?? { created: [], updated: [], deleted: [] };
    const rejected = new Set(rejectedIds?.[table]);

    const nowById = new Map<string, RawRecord>();
    for (const raw of [...now.created, ...now.updated]) nowById.set(raw.id, raw);

    const toMark: string[] = [];
    for (const raw of [...before.created, ...before.updated]) {
      if (rejected.has(raw.id)) continue;
      const currentRaw = nowById.get(raw.id);
      if (currentRaw && rawEquals(raw, currentRaw)) toMark.push(raw.id);
    }
    const collection = collectionFor(db, table);
    if (toMark.length > 0) {
      await db._adapter.markAsSynced(table, toMark);
      // Keep already-loaded instances in step with the adapter (WatermelonDB
      // updates `record.syncStatus` after a push).
      for (const id of toMark) collection?._refreshCached(id, { _status: 'synced', _changed: '' });
    }

    const stillDeleted = new Set(now.deleted);
    for (const id of before.deleted) {
      if (rejected.has(id) || !stillDeleted.has(id)) continue;
      await db._adapter.destroyPermanently(table, id);
      collection?._evictCached(id);
    }
  }
}

function collectionFor(db: Database, table: string): Collection | null {
  try {
    return db.collection(table);
  } catch {
    return null; // table without a registered collection
  }
}

function rawEquals(a: RawRecord, b: RawRecord): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!(key in b) || a[key] !== b[key]) return false;
  }
  return true;
}

function normalizeRejectedIds(result: void | SyncPushResult): Record<string, string[]> | undefined {
  if (!result) return undefined;
  const ids = result.rejectedIds ?? result.experimentalRejectedIds;
  if (!ids) return undefined;
  return Object.values(ids).some((list) => list.length > 0) ? ids : undefined;
}

// ─── Migration info ─────────────────────────────────────────────────────

/**
 * Build the pull `migration` argument.
 *
 * Rules (documented in docs/sync.md):
 * - `migrationsEnabledAtVersion` unset → `null` always
 * - first sync (`lastPulledAt === null`) → `null`; the server sends everything
 * - otherwise `from` is the schema version recorded by the last pull. If none
 *   was recorded (the app synced before migration-aware pulls were enabled)
 *   it is assumed to be `migrationsEnabledAtVersion`, as in WatermelonDB.
 * - `from === schemaVersion` → `null`; `from > schemaVersion` → error
 * - `from < schemaVersion` → tables/columns added by `db.migrations` between
 *   the two; any gap in that chain is an error (the server would never learn
 *   about the missing steps and the affected tables would stay empty).
 */
function computeMigrationInfo(
  db: Database,
  config: SyncConfig,
  lastPulledAt: number | null,
  lastPulledSchemaVersion: number | null,
): SyncMigrationInfo | null {
  const enabledAt = config.migrationsEnabledAtVersion;
  if (enabledAt === undefined || lastPulledAt === null) return null;

  const schemaVersion = db.schemaVersion;
  if (enabledAt > schemaVersion) {
    throw new Error(
      `migrationsEnabledAtVersion (${enabledAt}) is greater than the schema version (${schemaVersion}).`,
    );
  }

  const from = lastPulledSchemaVersion ?? enabledAt;
  if (from > schemaVersion) {
    throw new Error(
      `Last pulled schema version (${from}) is greater than the current schema version (${schemaVersion}) ` +
        '— downgrades are not supported.',
    );
  }
  if (from === schemaVersion) return null;

  return migrationSyncInfo(db.migrations, from, schemaVersion);
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
  setState: (state: SyncState, phase: string) => void,
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
    log.localChangeCount = 0;
    log.migration = null;

    setState('pulling', 'pulling turbo payload');
    logger.debug('Turbo sync: pulling payload...');
    const pulled = await config.pullChanges({
      lastPulledAt: null,
      schemaVersion: db.schemaVersion,
      migration: null,
    });

    setState('applying', 'importing turbo payload');
    let timestamp: number;
    if (isTurboSource(pulled)) {
      const adapter = db._adapter;
      if (!adapter.applySyncJson) {
        throw new Error('This adapter does not support turbo sync (applySyncJson is not implemented).');
      }
      const result = await adapter.applySyncJson(pulled, db.schema);
      log.turbo = result;
      log.remoteChangeCount = result.inserted + result.deleted;
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
      const filtered = filterChangesToSchema(pulled.changes ?? {}, db.schema);
      log.remoteChangeCount = countChanges(filtered.changes);
      await db._adapter.applyRemoteChanges(filtered.changes);
      timestamp = pulled.timestamp;
    }

    db._clearAllCaches();
    log.pullTimestamp = timestamp;
    log.newLastPulledAt = timestamp;
    await setLastPulledAt(db, timestamp);
    await setLastPulledSchemaVersion(db, db.schemaVersion);
    log.lastPulledSchemaVersion = db.schemaVersion;

    log.finishedAt = Date.now();
    setState('complete', 'done');
    logger.debug(`Turbo sync complete. New lastPulledAt: ${timestamp}`);
  } catch (error) {
    log.finishedAt = Date.now();
    log.error = error instanceof Error ? error.message : String(error);
    setState('error', `failed: ${log.error}`);
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

// ─── Push payload ───────────────────────────────────────────────────────

/**
 * Strip internal sync columns before sending to the server and, with
 * `sendCreatedAsUpdated`, report locally created records as updates.
 */
function buildPushPayload(
  changes: SyncTableChanges,
  sendCreatedAsUpdated: boolean,
): SyncTableChanges {
  const payload: SyncTableChanges = {};

  for (const [table, tableChanges] of Object.entries(changes)) {
    const created = tableChanges.created.map(stripSyncColumns);
    const updated = tableChanges.updated.map(stripSyncColumns);
    payload[table] = sendCreatedAsUpdated
      ? { created: [], updated: [...created, ...updated], deleted: tableChanges.deleted }
      : { created, updated, deleted: tableChanges.deleted };
  }

  return payload;
}

function stripSyncColumns(raw: RawRecord): RawRecord {
  const { _status, _changed, ...rest } = raw;
  return { ...rest, _status: 'synced', _changed: '' } as RawRecord;
}

// ─── onConflict override ────────────────────────────────────────────────

interface ResolvedRecord {
  table: string;
  record: RawRecord;
}

/**
 * Run `onConflict` for every remote record whose id is locally edited
 * (`updated`, or `created` on a collision) in `localChanges`. Each resolved
 * record is pulled out of the remote change set and written verbatim
 * afterwards by {@link writeResolved}. With `keep === 'local'` (pull-first)
 * the local `_status`/`_changed` are kept so the result is pushed; in
 * push-first mode the edit has already been pushed, so it is stored `synced`.
 */
function resolveConflicts(
  run: SyncRun,
  localChanges: SyncTableChanges,
  remoteChanges: SyncTableChanges,
  merge: (local: RawRecord, remote: RawRecord) => RawRecord,
  keep: 'local' | 'synced',
): ResolvedRecord[] {
  const onConflict = run.config.onConflict!;
  const resolved: ResolvedRecord[] = [];

  for (const [table, tableChanges] of Object.entries(remoteChanges)) {
    const localTable = localChanges[table];
    if (!localTable) continue;

    const localById = new Map<string, RawRecord>();
    for (const raw of [...localTable.updated, ...localTable.created]) {
      localById.set(raw.id, raw);
    }
    if (localById.size === 0) continue;

    const remoteDeleted = new Set(tableChanges.deleted);
    const keepRemote = (remote: RawRecord): boolean => {
      const local = localById.get(remote.id);
      if (!local || remoteDeleted.has(remote.id)) return true;

      const chosen = onConflict(local, merge(local, remote));
      const record = {
        ...chosen,
        id: remote.id,
        _status: keep === 'local' ? local._status : 'synced',
        _changed: keep === 'local' ? local._changed : '',
      } as RawRecord;
      resolved.push({ table, record });
      return false;
    };

    tableChanges.created = tableChanges.created.filter(keepRemote);
    tableChanges.updated = tableChanges.updated.filter(keepRemote);
  }

  run.log.resolvedConflicts = (run.log.resolvedConflicts ?? 0) + resolved.length;
  return resolved;
}

async function writeResolved(run: SyncRun, resolved: ResolvedRecord[]): Promise<void> {
  for (const { table, record } of resolved) {
    await run.db._adapter.update(table, record);
  }
}
