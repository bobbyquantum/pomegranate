/**
 * JS fallback for turbo sync.
 *
 * Adapters without a native importer implement `applySyncJson` by parsing the
 * payload in JS and routing it through their existing `applyRemoteChanges`.
 * This keeps the semantics identical to the native path — unknown tables are
 * ignored, unknown columns dropped, booleans stored as 0/1, `_status` and
 * `_changed` rewritten — so callers can rely on one contract regardless of
 * adapter.
 */

import type { DatabaseSchema, RawRecord } from '../schema/types';
import type {
  SyncPullResult,
  SyncTableChanges,
  TurboSyncResult,
  TurboSyncSource,
} from '../sync/types';
import type { StorageAdapter } from './types';

/** { table: [column, …] } as the native importer expects it. */
export function tableColumnsFromSchema(schema: DatabaseSchema): Record<string, string[]> {
  return Object.fromEntries(schema.tables.map((table) => [table.name, table.columns.map((c) => c.name)]));
}

export async function applySyncJsonInJs(
  adapter: Pick<StorageAdapter, 'applyRemoteChanges'>,
  source: TurboSyncSource,
  schema: DatabaseSchema,
): Promise<TurboSyncResult> {
  if (!('syncJson' in source)) {
    throw new Error(
      'This adapter cannot import a syncJsonId: the payload lives in native memory and only a native ' +
        'driver (pomegranate-db/native-sqlite) can read it. Pass { syncJson } text instead.',
    );
  }

  const payload = JSON.parse(source.syncJson) as Partial<SyncPullResult>;
  const changes = payload.changes ?? {};
  const allowed = new Map(
    schema.tables.map((table) => [table.name, new Set(table.columns.map((c) => c.name))] as const),
  );

  const result: TurboSyncResult = {
    timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : null,
    tables: 0,
    inserted: 0,
    deleted: 0,
    skippedTables: 0,
    skippedColumns: 0,
  };

  const filtered: SyncTableChanges = {};
  for (const [table, tableChanges] of Object.entries(changes)) {
    const columns = allowed.get(table);
    if (!columns) {
      result.skippedTables++;
      continue;
    }
    result.tables++;

    const sanitize = (raw: RawRecord): RawRecord => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (key === '_status' || key === '_changed') continue;
        if (key !== 'id' && !columns.has(key)) {
          result.skippedColumns++;
          continue;
        }
        if (typeof value === 'boolean') {
          out[key] = value ? 1 : 0;
        } else if (value !== null && typeof value === 'object') {
          out[key] = JSON.stringify(value);
        } else {
          out[key] = value;
        }
      }
      return out as RawRecord;
    };

    const created = (tableChanges.created ?? []).map(sanitize);
    const updated = (tableChanges.updated ?? []).map(sanitize);
    const deleted = tableChanges.deleted ?? [];
    result.inserted += created.length + updated.length;
    result.deleted += deleted.length;
    filtered[table] = { created, updated, deleted };
  }

  await adapter.applyRemoteChanges(filtered);
  return result;
}
