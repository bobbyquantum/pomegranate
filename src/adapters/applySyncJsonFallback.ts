/**
 * JS fallback for turbo sync.
 *
 * Adapters without a native importer implement `applySyncJson` by parsing the
 * payload in JS and routing it through their existing `applyRemoteChanges`.
 * This keeps the semantics identical to the native path — unknown tables are
 * ignored, unknown columns dropped, booleans stored as 0/1, `_status` and
 * `_changed` rewritten — so callers can rely on one contract regardless of
 * adapter. The filtering itself lives in `filterChangesToSchema`, which the
 * regular sync path uses too.
 */

import type { DatabaseSchema } from '../schema/types';
import type { SyncPullResult, TurboSyncResult, TurboSyncSource } from '../sync/types';
import { filterChangesToSchema } from '../sync/schemaFilter';
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
  const filtered = filterChangesToSchema(payload.changes ?? {}, schema);

  const result: TurboSyncResult = {
    timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : null,
    tables: 0,
    inserted: 0,
    deleted: 0,
    skippedTables: filtered.skippedTables,
    skippedColumns: filtered.skippedColumns,
  };

  for (const tableChanges of Object.values(filtered.changes)) {
    result.tables++;
    result.inserted += tableChanges.created.length + tableChanges.updated.length;
    result.deleted += tableChanges.deleted.length;
  }

  await adapter.applyRemoteChanges(filtered.changes);
  return result;
}
