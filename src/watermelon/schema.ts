/**
 * WatermelonDB `appSchema` / `tableSchema` and their conversion to the core
 * adapter schema.
 *
 * The returned objects have WatermelonDB's shape (`tables` and `columns` are
 * keyed by name) so code that introspects the schema keeps working.
 */

import type {
  ColumnType as CoreColumnType,
  DatabaseSchema,
  TableColumnSchema,
  TableSchema as CoreTableSchema,
} from '../schema/types';

export type ColumnType = 'string' | 'number' | 'boolean';

export interface ColumnSchema {
  readonly name: string;
  readonly type: ColumnType;
  readonly isOptional?: boolean;
  readonly isIndexed?: boolean;
}

export type ColumnMap = Record<string, ColumnSchema>;

export interface TableSchemaSpec {
  readonly name: string;
  readonly columns: ColumnSchema[];
  /** Accepted for compatibility; PomegranateDB generates its own DDL. */
  readonly unsafeSql?: (sql: string) => string;
}

export interface TableSchema {
  readonly name: string;
  readonly columns: ColumnMap;
  readonly columnArray: ColumnSchema[];
  readonly unsafeSql?: (sql: string) => string;
}

export interface AppSchemaSpec {
  readonly version: number;
  readonly tables: TableSchema[];
  readonly unsafeSql?: (sql: string, kind: string) => string;
}

export interface AppSchema {
  readonly version: number;
  readonly tables: Record<string, TableSchema>;
  readonly unsafeSql?: (sql: string, kind: string) => string;
}

const RESERVED_COLUMNS = new Set(['id', '_status', '_changed']);
const COLUMN_TYPES = new Set<ColumnType>(['string', 'number', 'boolean']);

export function validateColumnSchema(column: ColumnSchema, table: string): void {
  if (typeof column.name !== 'string' || column.name.length === 0) {
    throw new Error(`Table "${table}" has a column without a name`);
  }
  if (RESERVED_COLUMNS.has(column.name)) {
    throw new Error(
      `Column "${column.name}" on table "${table}" is reserved — id, _status and _changed are added automatically`,
    );
  }
  if (!COLUMN_TYPES.has(column.type)) {
    throw new Error(
      `Column "${column.name}" on table "${table}" has invalid type "${String(column.type)}" ` +
        '(expected string, number or boolean)',
    );
  }
}

export function tableSchema({ name, columns, unsafeSql }: TableSchemaSpec): TableSchema {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('tableSchema() requires a table name');
  }
  const columnMap: Record<string, ColumnSchema> = {};
  for (const column of columns) {
    validateColumnSchema(column, name);
    if (columnMap[column.name]) {
      throw new Error(`Duplicate column "${column.name}" on table "${name}"`);
    }
    columnMap[column.name] = column;
  }
  return { name, columns: columnMap, columnArray: [...columns], unsafeSql };
}

export function appSchema({ version, tables, unsafeSql }: AppSchemaSpec): AppSchema {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`appSchema() version must be a positive integer, got ${String(version)}`);
  }
  const tableMap: Record<string, TableSchema> = {};
  for (const table of tables) {
    if (tableMap[table.name]) {
      throw new Error(`Duplicate table "${table.name}" in appSchema()`);
    }
    tableMap[table.name] = table;
  }
  return { version, tables: tableMap, unsafeSql };
}

// ─── Conversion to the core schema ─────────────────────────────────────────

export function toCoreColumnType(type: ColumnType): CoreColumnType {
  switch (type) {
    case 'string':
      return 'text';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
  }
}

export function toCoreColumn(column: ColumnSchema): TableColumnSchema {
  return {
    name: column.name,
    type: toCoreColumnType(column.type),
    isOptional: column.isOptional ?? false,
    isIndexed: column.isIndexed ?? false,
  };
}

export function toCoreTableSchema(table: TableSchema | TableSchemaSpec): CoreTableSchema {
  const columns = Array.isArray(table.columns)
    ? table.columns
    : (table as TableSchema).columnArray;
  return { name: table.name, columns: columns.map(toCoreColumn) };
}

export function toCoreDatabaseSchema(schema: AppSchema): DatabaseSchema {
  return {
    version: schema.version,
    tables: Object.values(schema.tables).map(toCoreTableSchema),
  };
}
