/**
 * Migration chain helpers shared by `Database.initialize()` and the sync
 * engine's migration-aware pull.
 */

import type { Migration } from '../adapters/types';
import type { ColumnType } from '../schema/types';

/**
 * Pick, order and validate the migrations needed to go from `from` to `to`.
 *
 * Every step must advance exactly one version (`toVersion === fromVersion + 1`),
 * no two migrations may share a `toVersion`, and every version in
 * `[from, to)` must have a migration starting from it. Throws a descriptive
 * error otherwise; returns the applicable migrations in ascending order.
 */
export function resolveMigrationChain(
  migrations: readonly Migration[],
  from: number,
  to: number,
): Migration[] {
  if (from >= to) return [];

  const seen = new Set<number>();
  for (const migration of migrations) {
    if (migration.toVersion !== migration.fromVersion + 1) {
      throw new Error(
        `Invalid migration ${migration.fromVersion} → ${migration.toVersion}: ` +
          'each migration must advance the schema by exactly one version.',
      );
    }
    if (seen.has(migration.toVersion)) {
      throw new Error(`Duplicate migration to schema version ${migration.toVersion}.`);
    }
    seen.add(migration.toVersion);
  }

  const byFrom = new Map(migrations.map((migration) => [migration.fromVersion, migration]));
  const chain: Migration[] = [];
  const missing: string[] = [];
  for (let version = from; version < to; version++) {
    const migration = byFrom.get(version);
    if (migration) chain.push(migration);
    else missing.push(`${version} → ${version + 1}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing migrations between schema versions ${from} and ${to}: ${missing.join(', ')}. ` +
        'Add the missing Migration entries to DatabaseConfig.migrations.',
    );
  }

  return chain;
}

// ─── Migration info for sync ────────────────────────────────────────────

/**
 * The `migration` argument of a WatermelonDB-style pull request: which tables
 * and columns were added since the schema version the client last pulled with.
 * The server uses it to send full snapshots of those tables/columns so the
 * client is not left with empty ones.
 */
export interface MigrationSyncInfo {
  from: number;
  tables: string[];
  columns: { table: string; columns: string[] }[];
}

/**
 * Compute {@link MigrationSyncInfo} from the migrations between `from` and
 * `to` (exclusive of tables created in that range for the `columns` list).
 * Throws when the chain is incomplete: the server would otherwise never learn
 * about the missing steps and the tables would stay empty forever.
 */
export function migrationSyncInfo(
  migrations: readonly Migration[],
  from: number,
  to: number,
): MigrationSyncInfo {
  let chain: Migration[];
  try {
    chain = resolveMigrationChain(migrations, from, to);
  } catch (error) {
    throw new Error(
      `Missing migrations between schema versions ${from} and ${to} — cannot sync. ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  const tables = new Set<string>();
  const columnsByTable = new Map<string, Set<string>>();

  for (const migration of chain) {
    for (const step of migration.steps) {
      switch (step.type) {
        case 'createTable':
          tables.add(step.schema.name);
          break;
        case 'addColumn':
          addColumn(columnsByTable, step.table, step.column);
          break;
        case 'addColumns':
          for (const column of step.columns) addColumn(columnsByTable, step.table, column.name);
          break;
        default:
          break;
      }
    }
  }

  const columns: MigrationSyncInfo['columns'] = [];
  for (const [table, names] of columnsByTable) {
    // Columns added to a table created in the same range are covered by the
    // table snapshot; WatermelonDB drops them too.
    if (tables.has(table)) continue;
    columns.push({ table, columns: Array.from(names) });
  }

  return { from, tables: Array.from(tables), columns };
}

function addColumn(map: Map<string, Set<string>>, table: string, column: string): void {
  let set = map.get(table);
  if (!set) {
    set = new Set();
    map.set(table, set);
  }
  set.add(column);
}

/** Default value for a newly added column on rows that predate it. */
export function defaultValueForColumn(type: ColumnType, isOptional: boolean): unknown {
  if (isOptional) return null;
  switch (type) {
    case 'text':
      return '';
    case 'number':
    case 'boolean':
    case 'date':
      return 0;
    default:
      return '';
  }
}
