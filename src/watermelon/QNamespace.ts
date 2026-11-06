/**
 * `Q` as a namespace: WatermelonDB exposes `Q` as a module, so consumers write
 * both `Q.where(...)` (value) and `Q.Clause` (type). Re-exporting the object's
 * members and the clause types from one module gives `import { Q }` the same
 * dual nature via `export * as Q`.
 */

import { Q as QObject } from './Q';

export type {
  ComparisonOperator,
  Comparison,
  Value,
  WhereClause,
  AndClause,
  OrClause,
  OnClause,
  Where,
  SortOrder,
  SortByClause,
  TakeClause,
  SkipClause,
  JoinTablesClause,
  NestedJoinTableClause,
  Clause,
  QType,
} from './Q';

export const eq = QObject.eq;
export const notEq = QObject.notEq;
export const gt = QObject.gt;
export const gte = QObject.gte;
export const lt = QObject.lt;
export const lte = QObject.lte;
export const oneOf = QObject.oneOf;
export const notIn = QObject.notIn;
export const between = QObject.between;
export const like = QObject.like;
export const notLike = QObject.notLike;
export const where = QObject.where;
export const and = QObject.and;
export const or = QObject.or;
export const on = QObject.on;
export const asc = QObject.asc;
export const desc = QObject.desc;
export const sortBy = QObject.sortBy;
export const take = QObject.take;
export const skip = QObject.skip;
export const experimentalJoinTables = QObject.experimentalJoinTables;
export const experimentalNestedJoin = QObject.experimentalNestedJoin;
export const sanitizeLikeString = QObject.sanitizeLikeString;
