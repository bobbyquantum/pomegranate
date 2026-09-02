/**
 * Test helper: a `SQLiteDriver` over better-sqlite3 that also exposes the raw
 * connection and every statement it ran. Booleans are bound as 0/1 the way
 * real React Native drivers do (better-sqlite3 refuses boolean bindings).
 */

import BetterSqlite3 from 'better-sqlite3';
import type { SQLiteDriver } from '../../adapters/sqlite/SQLiteAdapter';

export interface TestSqliteDriver extends SQLiteDriver {
  raw(): BetterSqlite3.Database;
  statements: string[];
}

function normalize(bindings: unknown[]): unknown[] {
  return bindings.map((b) => (typeof b === 'boolean' ? (b ? 1 : 0) : b));
}

export function createBetterSqliteDriver(): TestSqliteDriver {
  let db: BetterSqlite3.Database | null = null;
  const statements: string[] = [];
  const need = () => {
    if (!db) throw new Error('database is not open');
    return db;
  };
  return {
    statements,
    raw: need,
    async open(name) {
      db = new BetterSqlite3(name);
    },
    async execute(sql, bindings = []) {
      statements.push(sql);
      need().prepare(sql).run(...normalize(bindings));
    },
    async query(sql, bindings = []) {
      statements.push(sql);
      return need().prepare(sql).all(...normalize(bindings)) as Record<string, unknown>[];
    },
    async executeInTransaction(fn) {
      need().exec('BEGIN');
      try {
        await fn();
        need().exec('COMMIT');
      } catch (error) {
        need().exec('ROLLBACK');
        throw error;
      }
    },
    async close() {
      db?.close();
      db = null;
    },
  };
}
