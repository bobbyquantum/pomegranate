/**
 * WatermelonDB-style resolution of a pulled record against a local row.
 *
 * A locally edited row (`_status = 'updated'`, or `'created'` on an id
 * collision) keeps the columns it changed — listed comma-separated in
 * `_changed` — and takes every other column from the server. Both adapters
 * and the sync engine's `onConflict` override build on these helpers so the
 * rule is defined once.
 */

import type { RawRecord } from '../schema/types';

/** Parse the `_changed` column into a set of column names. */
export function parseChangedColumns(changed: unknown): Set<string> {
  if (typeof changed !== 'string' || changed === '') return new Set();
  return new Set(changed.split(',').filter(Boolean));
}

/**
 * The subset of a remote record that should be written over a locally edited
 * row: `id` plus every column not named in the local `_changed`. `_status` and
 * `_changed` are never included — the local ones stay so the edit is pushed.
 */
export function remoteValuesToApply(
  remote: RawRecord,
  localChanged: unknown,
): Record<string, unknown> {
  const keep = parseChangedColumns(localChanged);
  const out: Record<string, unknown> = { id: remote.id };
  for (const [key, value] of Object.entries(remote)) {
    if (key === 'id' || key === '_status' || key === '_changed') continue;
    if (keep.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/** The full record a locally edited row becomes after merging a remote one. */
export function mergeRemoteIntoLocal(local: RawRecord, remote: RawRecord): RawRecord {
  return {
    ...local,
    ...remoteValuesToApply(remote, local._changed),
    _status: local._status,
    _changed: local._changed,
  } as RawRecord;
}
