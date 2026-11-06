/**
 * Query descriptor introspection helpers.
 *
 * Used by live queries to decide whether a change event can affect a query:
 * which outer-table columns a query references, and which related tables its
 * EXISTS clauses reach into.
 */

import type { QueryDescriptor, Condition } from './types';

/**
 * Column names (of the query's own table) referenced anywhere in the query:
 * where clauses at any nesting, ORDER BY, join and exists link columns.
 * Inner-table columns of exists clauses are NOT included — they belong to
 * another table (see `collectExistsTables`).
 */
export function collectQueryColumns(descriptor: QueryDescriptor): Set<string> {
  const columns = new Set<string>();
  collectConditionColumns(descriptor.conditions, columns);
  for (const ob of descriptor.orderBy) columns.add(ob.column);
  for (const join of descriptor.joins) columns.add(join.leftColumn);
  return columns;
}

function collectConditionColumns(conditions: readonly Condition[], into: Set<string>): void {
  for (const condition of conditions) {
    switch (condition.type) {
      case 'where':
        into.add(condition.column);
        break;
      case 'and':
      case 'or':
        collectConditionColumns(condition.conditions, into);
        break;
      case 'not':
        collectConditionColumns([condition.condition], into);
        break;
      case 'exists':
        into.add(condition.localColumn);
        break;
    }
  }
}

/** Tables reached by exists clauses at any nesting depth. */
export function collectExistsTables(descriptor: QueryDescriptor): Set<string> {
  const tables = new Set<string>();
  collectExistsTablesFrom(descriptor.conditions, tables);
  return tables;
}

function collectExistsTablesFrom(conditions: readonly Condition[], into: Set<string>): void {
  for (const condition of conditions) {
    switch (condition.type) {
      case 'and':
      case 'or':
        collectExistsTablesFrom(condition.conditions, into);
        break;
      case 'not':
        collectExistsTablesFrom([condition.condition], into);
        break;
      case 'exists':
        into.add(condition.table);
        collectExistsTablesFrom(condition.conditions, into);
        break;
      default:
        break;
    }
  }
}
