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

/**
 * better-sqlite3 is a native module, so Jest loads it once per worker and its
 * `SqliteError` class belongs to the realm of the first test file that
 * required it. In a later file in the same worker `err instanceof Error` is
 * then false and `expect(...).rejects.toThrow()` reports "did not throw".
 * Re-throw as an Error of the current realm, keeping message and code.
 */
function rethrow(error: unknown): never {
  if (error instanceof Error) throw error;
  const source = error as { message?: unknown; code?: unknown };
  const wrapped = new Error(typeof source?.message === 'string' ? source.message : String(error));
  (wrapped as Error & { code?: unknown }).code = source?.code;
  throw wrapped;
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
      try {
        need().prepare(sql).run(...normalize(bindings));
      } catch (error) {
        rethrow(error);
      }
    },
    async query(sql, bindings = []) {
      statements.push(sql);
      try {
        return need().prepare(sql).all(...normalize(bindings)) as Record<string, unknown>[];
      } catch (error) {
        rethrow(error);
      }
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
