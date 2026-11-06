/**
 * Shape a pull payload to the local schema before it reaches an adapter.
 *
 * Servers routinely know about tables and columns a given app version does
 * not (newer builds, other clients). Rather than failing the whole sync on an
 * unknown column, both the regular path and the turbo JS fallback run the
 * changes through this filter, which:
 *
 * - drops tables the schema does not declare
 * - drops columns the table schema does not declare (`id` always kept)
 * - strips `_status` / `_changed` — the adapter decides those
 * - stores booleans as `0`/`1` and nested objects/arrays as JSON text, the
 *   way the native importer does
 */

import type { DatabaseSchema, RawRecord } from '../schema/types';
import type { SyncTableChanges } from './types';

export interface FilteredChanges {
  changes: SyncTableChanges;
  /** Tables present in the payload but not in the schema (ignored). */
  skippedTables: number;
  /** Column occurrences present in the payload but not in the schema (dropped). */
  skippedColumns: number;
}

export function filterChangesToSchema(
  changes: SyncTableChanges,
  schema: DatabaseSchema,
): FilteredChanges {
  const allowed = new Map(
    schema.tables.map((table) => [table.name, new Set(table.columns.map((c) => c.name))] as const),
  );

  const result: FilteredChanges = { changes: {}, skippedTables: 0, skippedColumns: 0 };

  for (const [table, tableChanges] of Object.entries(changes ?? {})) {
    const columns = allowed.get(table);
    if (!columns) {
      result.skippedTables++;
      continue;
    }

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

    result.changes[table] = {
      created: (tableChanges?.created ?? []).map(sanitize),
      updated: (tableChanges?.updated ?? []).map(sanitize),
      deleted: tableChanges?.deleted ?? [],
    };
  }

  return result;
}
