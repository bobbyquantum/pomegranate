/**
 * WatermelonDB `schemaMigrations` / `createTable` / `addColumns` /
 * `unsafeExecuteSql` and their conversion to core `Migration[]`.
 *
 * WatermelonDB migrations only carry `toVersion`; the core needs
 * `fromVersion` too, which is always `toVersion - 1`.
 */

import type { Migration as CoreMigration, MigrationStep as CoreMigrationStep } from '../adapters/types';
import type { ColumnSchema, TableSchema, TableSchemaSpec } from './schema';
import { tableSchema, toCoreColumn, toCoreTableSchema, validateColumnSchema } from './schema';

export interface CreateTableMigrationStep {
  readonly type: 'create_table';
  readonly schema: TableSchema;
}

export interface AddColumnsMigrationStep {
  readonly type: 'add_columns';
  readonly table: string;
  readonly columns: ColumnSchema[];
  readonly unsafeSql?: (sql: string) => string;
}

export interface SqlMigrationStep {
  readonly type: 'sql';
  readonly sql: string;
}

export type MigrationStep = CreateTableMigrationStep | AddColumnsMigrationStep | SqlMigrationStep;

export interface Migration {
  readonly toVersion: number;
  readonly steps: MigrationStep[];
}

export interface SchemaMigrations {
  readonly validated: true;
  readonly minVersion: number;
  readonly maxVersion: number;
  readonly sortedMigrations: Migration[];
}

export function createTable(spec: TableSchemaSpec): CreateTableMigrationStep {
  return { type: 'create_table', schema: tableSchema(spec) };
}

export function addColumns({
  table,
  columns,
  unsafeSql,
}: {
  table: string;
  columns: ColumnSchema[];
  unsafeSql?: (sql: string) => string;
}): AddColumnsMigrationStep {
  if (typeof table !== 'string' || table.length === 0) {
    throw new Error('addColumns() requires a table name');
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error(`addColumns() for table "${table}" requires at least one column`);
  }
  for (const column of columns) validateColumnSchema(column, table);
  return { type: 'add_columns', table, columns: [...columns], unsafeSql };
}

export function unsafeExecuteSql(sql: string): SqlMigrationStep {
  if (typeof sql !== 'string') {
    throw new TypeError('unsafeExecuteSql() requires a SQL string');
  }
  return { type: 'sql', sql };
}

/**
 * Validate and sort a list of migrations. Versions must be integers ≥ 2 with
 * no duplicates or gaps, exactly as WatermelonDB requires.
 */
export function schemaMigrations({ migrations }: { migrations: Migration[] }): SchemaMigrations {
  if (!Array.isArray(migrations)) {
    throw new TypeError('schemaMigrations() requires a `migrations` array');
  }
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted() is not available on every RN runtime
  const sorted = [...migrations].sort((a, b) => a.toVersion - b.toVersion);
  for (const migration of sorted) {
    if (!Number.isInteger(migration.toVersion) || migration.toVersion < 2) {
      throw new Error(
        `Invalid migration toVersion ${String(migration.toVersion)} — must be an integer ≥ 2`,
      );
    }
    if (!Array.isArray(migration.steps)) {
      throw new Error(`Migration to version ${migration.toVersion} has no steps array`);
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1].toVersion;
    const current = sorted[i].toVersion;
    if (current === previous) {
      throw new Error(`Duplicate migration to schema version ${current}`);
    }
    if (current !== previous + 1) {
      throw new Error(
        `Missing migration between schema versions ${previous} and ${current} — migrations must be contiguous`,
      );
    }
  }
  const minVersion = sorted.length > 0 ? sorted[0].toVersion - 1 : 1;
  const maxVersion = sorted.length > 0 ? sorted.at(-1)!.toVersion : 1;
  return { validated: true, minVersion, maxVersion, sortedMigrations: sorted };
}

// ─── Conversion to core migrations ─────────────────────────────────────────

export function toCoreMigrationStep(step: MigrationStep): CoreMigrationStep {
  switch (step.type) {
    case 'create_table':
      return { type: 'createTable', schema: toCoreTableSchema(step.schema) };
    case 'add_columns':
      return { type: 'addColumns', table: step.table, columns: step.columns.map(toCoreColumn) };
    case 'sql':
      return { type: 'sql', query: step.sql };
    default:
      throw new Error(`Unknown migration step type "${String((step as { type: unknown }).type)}"`);
  }
}

export function toCoreMigrations(
  migrations: SchemaMigrations | Migration[] | undefined,
): CoreMigration[] {
  if (!migrations) return [];
  const list = Array.isArray(migrations) ? migrations : migrations.sortedMigrations;
  return list.map((migration) => ({
    fromVersion: migration.toVersion - 1,
    toVersion: migration.toVersion,
    steps: migration.steps.map(toCoreMigrationStep),
  }));
}
