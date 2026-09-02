/**
 * Minimal better-sqlite3 driver for exercising SQLiteAdapter in Node tests.
 * Booleans are bound as 0/1 (better-sqlite3 refuses boolean bindings).
 */

import BetterSqlite3 from 'better-sqlite3';
import type { SQLiteDriver } from '../../adapters/sqlite/SQLiteAdapter';

function normalize(bindings: unknown[]): unknown[] {
  return bindings.map((b) => (typeof b === 'boolean' ? (b ? 1 : 0) : b));
}

export function createBetterSqliteDriver(): SQLiteDriver {
  let db: BetterSqlite3.Database | null = null;

  const driver: SQLiteDriver = {
    async open(name: string) {
      db = new BetterSqlite3(name);
    },
    async execute(sql: string, bindings: unknown[] = []) {
      db!.prepare(sql).run(...normalize(bindings));
    },
    async query(sql: string, bindings: unknown[] = []) {
      return db!.prepare(sql).all(...normalize(bindings)) as Record<string, unknown>[];
    },
    async executeInTransaction(fn: () => Promise<void>) {
      await driver.execute('BEGIN');
      try {
        await fn();
        await driver.execute('COMMIT');
      } catch (error) {
        await driver.execute('ROLLBACK');
        throw error;
      }
    },
    async close() {
      db?.close();
      db = null;
    },
  };

  return driver;
}
