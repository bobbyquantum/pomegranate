/**
 * SQL generation utilities.
 *
 * Translates QueryDescriptor / SearchDescriptor into SQL strings + bindings.
 * Used by the SQLite adapter.
 */

import type {
  QueryDescriptor,
  SearchDescriptor,
  Condition,
  WhereClause,
  AndClause,
  OrClause,
  NotClause,
  ExistsClause,
  OrderByClause,
} from '../../query/types';
import type { DatabaseSchema, TableSchema } from '../../schema/types';
import { sanitizeTableName, sanitizeColumnName } from '../../utils';

// ─── CREATE TABLE ──────────────────────────────────────────────────────────

export function createTableSQL(table: TableSchema): string {
  const tableName = sanitizeTableName(table.name);
  const columnDefs = [
    '"id" TEXT PRIMARY KEY NOT NULL',
    '"_status" TEXT NOT NULL DEFAULT \'created\'',
    '"_changed" TEXT NOT NULL DEFAULT \'\'',
    ...table.columns.map((col) => {
      const name = sanitizeColumnName(col.name);
      let sqlType: string;
      switch (col.type) {
        case 'text':
          sqlType = 'TEXT';
          break;
        case 'number':
          sqlType = 'REAL';
          break;
        case 'boolean':
          sqlType = 'INTEGER';
          break;
        case 'date':
          sqlType = 'REAL';
          break;
        case 'json':
          sqlType = 'TEXT';
          break;
        default:
          sqlType = 'TEXT';
      }
      const nullable = col.isOptional ? '' : ' NOT NULL';
      const defaultVal = col.isOptional ? ' DEFAULT NULL' : getDefaultClause(col.type);
      return `"${name}" ${sqlType}${nullable}${defaultVal}`;
    }),
  ];

  const createSQL = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs.join(', ')})`;

  // Build index statements
  const indexes = table.columns
    .filter((col) => col.isIndexed)
    .map((col) => {
      const colName = sanitizeColumnName(col.name);
      return `CREATE INDEX IF NOT EXISTS "${tableName}_${colName}" ON "${tableName}" ("${colName}")`;
    });

  // Always index _status
  indexes.unshift(
    `CREATE INDEX IF NOT EXISTS "${tableName}__status" ON "${tableName}" ("_status")`,
  );

  return [createSQL, ...indexes].join(';\n') + ';';
}

function getDefaultClause(type: string): string {
  switch (type) {
    case 'text':
    case 'json':
      return " DEFAULT ''";
    case 'number':
      return ' DEFAULT 0';
    case 'boolean':
      return ' DEFAULT 0';
    case 'date':
      return ' DEFAULT NULL';
    default:
      return '';
  }
}

// ─── SELECT query ──────────────────────────────────────────────────────────

export function selectSQL(descriptor: QueryDescriptor): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = [];
  const table = sanitizeTableName(descriptor.table);

  let sql = `SELECT * FROM "${table}"`;

  // JOINs
  for (const join of descriptor.joins) {
    const joinTable = sanitizeTableName(join.table);
    const leftCol = sanitizeColumnName(join.leftColumn);
    const rightCol = sanitizeColumnName(join.rightColumn);
    sql += ` JOIN "${joinTable}" ON "${table}"."${leftCol}" = "${joinTable}"."${rightCol}"`;
  }

  // WHERE
  if (descriptor.conditions.length > 0) {
    const whereClause = conditionsToSQL(descriptor.conditions, bindings, table);
    sql += ` WHERE ${whereClause}`;
  }

  // ORDER BY
  if (descriptor.orderBy.length > 0) {
    sql += ` ORDER BY ${orderBySQL(descriptor.orderBy, table)}`;
  }

  // LIMIT / OFFSET
  if (descriptor.limit !== undefined) {
    sql += ' LIMIT ?';
    bindings.push(descriptor.limit);
  }
  if (descriptor.offset !== undefined) {
    sql += ' OFFSET ?';
    bindings.push(descriptor.offset);
  }

  return { sql, bindings };
}

// ─── COUNT query ───────────────────────────────────────────────────────────

export function countSQL(descriptor: QueryDescriptor): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = [];
  const table = sanitizeTableName(descriptor.table);

  let sql = `SELECT COUNT(*) as count FROM "${table}"`;

  if (descriptor.conditions.length > 0) {
    const whereClause = conditionsToSQL(descriptor.conditions, bindings, table);
    sql += ` WHERE ${whereClause}`;
  }

  return { sql, bindings };
}

// ─── SEARCH query (LIKE-based) ─────────────────────────────────────────────

export function searchSQL(descriptor: SearchDescriptor): {
  sql: string;
  countSql: string;
  bindings: unknown[];
  countBindings: unknown[];
} {
  const bindings: unknown[] = [];
  const countBindings: unknown[] = [];
  const table = sanitizeTableName(descriptor.table);
  const pattern = `%${escapeLike(descriptor.term)}%`;

  // Build search conditions
  const searchConditions = descriptor.fields.map((field) => {
    const col = sanitizeColumnName(field);
    bindings.push(pattern);
    countBindings.push(pattern);
    return `"${table}"."${col}" LIKE ?`;
  });

  const searchWhere = `(${searchConditions.join(' OR ')})`;

  // Additional conditions
  let extraWhere = '';
  if (descriptor.conditions.length > 0) {
    const extraBindings: unknown[] = [];
    extraWhere = ` AND ${conditionsToSQL(descriptor.conditions, extraBindings, table)}`;
    bindings.push(...extraBindings);
    countBindings.push(...extraBindings);
  }

  // Count query
  const countSql = `SELECT COUNT(*) as count FROM "${table}" WHERE ${searchWhere}${extraWhere}`;

  // Result query
  let sql = `SELECT * FROM "${table}" WHERE ${searchWhere}${extraWhere}`;

  if (descriptor.orderBy.length > 0) {
    sql += ` ORDER BY ${orderBySQL(descriptor.orderBy, table)}`;
  }

  sql += ' LIMIT ? OFFSET ?';
  bindings.push(descriptor.limit, descriptor.offset);

  return { sql, countSql, bindings, countBindings };
}

// ─── INSERT ────────────────────────────────────────────────────────────────

export function insertSQL(
  table: string,
  raw: Record<string, unknown>,
): { sql: string; bindings: unknown[] } {
  const tableName = sanitizeTableName(table);
  const keys = Object.keys(raw);
  const columns = keys.map((k) => `"${sanitizeColumnName(k)}"`).join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  const bindings = keys.map((k) => raw[k]);

  return {
    sql: `INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders})`,
    bindings,
  };
}

// ─── UPDATE ────────────────────────────────────────────────────────────────

export function updateSQL(
  table: string,
  raw: Record<string, unknown>,
): { sql: string; bindings: unknown[] } {
  const tableName = sanitizeTableName(table);
  const keys = Object.keys(raw).filter((k) => k !== 'id');
  const setClauses = keys.map((k) => `"${sanitizeColumnName(k)}" = ?`).join(', ');
  const bindings = [...keys.map((k) => raw[k]), raw.id];

  return {
    sql: `UPDATE "${tableName}" SET ${setClauses} WHERE "id" = ?`,
    bindings,
  };
}

// ─── DELETE ────────────────────────────────────────────────────────────────

export function deleteSQL(table: string, id: string): { sql: string; bindings: unknown[] } {
  return {
    sql: `DELETE FROM "${sanitizeTableName(table)}" WHERE "id" = ?`,
    bindings: [id],
  };
}

// ─── Condition helpers ─────────────────────────────────────────────────────
//
// Every column reference is qualified with its table ("table"."column") so
// that EXISTS sub-queries can refer to inner and outer columns without
// ambiguity, even when both tables share column names.

function orderBySQL(orderBy: readonly OrderByClause[], table: string): string {
  return orderBy
    .map((ob) => `${qualify(table, ob.column)} ${ob.order === 'desc' ? 'DESC' : 'ASC'}`)
    .join(', ');
}

function qualify(table: string, column: string): string {
  return `"${table}"."${sanitizeColumnName(column)}"`;
}

function conditionsToSQL(
  conditions: readonly Condition[],
  bindings: unknown[],
  table: string,
): string {
  return conditions.map((c) => conditionToSQL(c, bindings, table)).join(' AND ');
}

function conditionToSQL(condition: Condition, bindings: unknown[], table: string): string {
  switch (condition.type) {
    case 'where':
      return whereToSQL(condition, bindings, table);
    case 'and':
      return `(${(condition as AndClause).conditions.map((c) => conditionToSQL(c, bindings, table)).join(' AND ')})`;
    case 'or':
      return `(${(condition as OrClause).conditions.map((c) => conditionToSQL(c, bindings, table)).join(' OR ')})`;
    case 'not':
      return `NOT (${conditionToSQL((condition as NotClause).condition, bindings, table)})`;
    case 'exists':
      return existsToSQL(condition as ExistsClause, bindings, table);
    default:
      throw new Error(`Unknown condition type: ${(condition as any).type}`);
  }
}

/**
 * EXISTS (SELECT 1 FROM "inner" WHERE "inner"."fc" = "outer"."lc"
 *         AND "inner"."_status" != 'deleted' AND (<inner conditions>))
 */
function existsToSQL(clause: ExistsClause, bindings: unknown[], outerTable: string): string {
  const inner = sanitizeTableName(clause.table);
  let sql =
    `EXISTS (SELECT 1 FROM "${inner}" WHERE ` +
    `${qualify(inner, clause.foreignColumn)} = ${qualify(outerTable, clause.localColumn)}` +
    ` AND ${qualify(inner, '_status')} != 'deleted'`;
  if (clause.conditions.length > 0) {
    sql += ` AND (${conditionsToSQL(clause.conditions, bindings, inner)})`;
  }
  return sql + ')';
}

function whereToSQL(clause: WhereClause, bindings: unknown[], table: string): string {
  const col = qualify(table, clause.column);

  switch (clause.operator) {
    case 'eq':
      bindings.push(clause.value);
      return `${col} = ?`;
    case 'neq':
      bindings.push(clause.value);
      return `${col} != ?`;
    case 'gt':
      bindings.push(clause.value);
      return `${col} > ?`;
    case 'gte':
      bindings.push(clause.value);
      return `${col} >= ?`;
    case 'lt':
      bindings.push(clause.value);
      return `${col} < ?`;
    case 'lte':
      bindings.push(clause.value);
      return `${col} <= ?`;
    case 'in':
      const arr = clause.value as unknown[];
      const placeholders = arr.map(() => '?').join(', ');
      bindings.push(...arr);
      return `${col} IN (${placeholders})`;
    case 'notIn':
      const arr2 = clause.value as unknown[];
      const placeholders2 = arr2.map(() => '?').join(', ');
      bindings.push(...arr2);
      return `${col} NOT IN (${placeholders2})`;
    case 'like':
      bindings.push(clause.value);
      return `${col} LIKE ?`;
    case 'notLike':
      bindings.push(clause.value);
      return `${col} NOT LIKE ?`;
    case 'between':
      const [low, high] = clause.value as [unknown, unknown];
      bindings.push(low, high);
      return `${col} BETWEEN ? AND ?`;
    case 'isNull':
      return `${col} IS NULL`;
    case 'isNotNull':
      return `${col} IS NOT NULL`;
    default:
      throw new Error(`Unknown operator: ${clause.operator}`);
  }
}

function escapeLike(str: string): string {
  return str.replaceAll('%', String.raw`\%`).replaceAll('_', String.raw`\_`);
}
