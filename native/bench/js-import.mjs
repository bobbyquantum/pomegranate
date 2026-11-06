#!/usr/bin/env node
/**
 * JS-side comparison for the turbo importer benchmark.
 *
 * Measures the same bundle through:
 *   1. JSON.parse alone
 *   2. "best-case JS": JSON.parse + hand-written prepared INSERTs via better-sqlite3
 *      (synchronous, one transaction — an upper bound on what a JS import can do)
 *   3. PomegranateDB's SQLiteAdapter.applyRemoteChanges (the current non-turbo sync path)
 *
 * Node/V8 numbers are optimistic for React Native: Hermes parses JSON several
 * times slower than V8 and every SQLite call crosses JSI. Treat these as a
 * floor for JS cost, not a device measurement.
 *
 * Usage: node js-import.mjs <bundle-dir> <out-dir>
 *   (bundle-dir is the output of gen-bundle.mjs; requires `npm run build:lib` first)
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3');
const { SQLiteAdapter } = require('../../dist/adapters/sqlite/SQLiteAdapter.js');

const [bundleDir, outDir] = process.argv.slice(2);
if (!bundleDir || !outDir) {
  console.error('usage: js-import.mjs <bundle-dir> <out-dir>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const createSql = fs.readFileSync(path.join(bundleDir, 'create.sql'), 'utf8');
const columns = JSON.parse(fs.readFileSync(path.join(bundleDir, 'columns.json'), 'utf8'));
const ms = (start) => (performance.now() - start).toFixed(0);

const readStart = performance.now();
const text = fs.readFileSync(path.join(bundleDir, 'bundle.json'), 'utf8');
console.log(`read bundle: ${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB in ${ms(readStart)} ms`);

// 1. JSON.parse
let parseStart = performance.now();
let payload = JSON.parse(text);
console.log(`JSON.parse: ${ms(parseStart)} ms`);
let rows = 0;
for (const t of Object.values(payload.changes)) rows += t.created.length + t.updated.length;

function freshDb(name) {
  const file = path.join(outDir, name);
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  const db = new BetterSqlite3(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -8000');
  db.exec(createSql);
  return db;
}

// 2. Best-case hand-written JS import
{
  const db = freshDb('js-best.db');
  const start = performance.now();
  const tx = db.transaction((changes) => {
    for (const [table, tc] of Object.entries(changes)) {
      const cols = ['id', ...columns[table]];
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}, "_status", "_changed") VALUES (${cols.map(() => '?').join(', ')}, 'synced', '')`,
      );
      for (const r of [...tc.created, ...tc.updated]) {
        stmt.run(cols.map((c) => {
          const v = r[c];
          return typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v;
        }));
      }
      if (tc.deleted.length) {
        const del = db.prepare(`DELETE FROM "${table}" WHERE "id" = ?`);
        for (const id of tc.deleted) del.run(id);
      }
    }
  });
  tx(payload.changes);
  console.log(`best-case JS import (excl. parse): ${ms(start)} ms — ${rows} rows`);
  db.close();
}

// 3. PomegranateDB SQLiteAdapter.applyRemoteChanges (current sync path)
{
  const file = path.join(outDir, 'pomegranate-js.db');
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  let db;
  const driver = {
    async open(name) {
      db = new BetterSqlite3(name);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
    },
    async execute(sql, bindings = []) {
      db.prepare(sql).run(...bindings);
    },
    async query(sql, bindings = []) {
      return db.prepare(sql).all(...bindings);
    },
    async executeInTransaction(fn) {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async close() {
      db.close();
    },
  };
  const adapter = new SQLiteAdapter({ databaseName: file, driver });
  await driver.open(file);
  db.exec(createSql);
  // Coerce booleans the way the JS sync path expects raw records (0/1).
  for (const tc of Object.values(payload.changes)) {
    for (const r of [...tc.created, ...tc.updated]) {
      for (const k of Object.keys(r)) if (typeof r[k] === 'boolean') r[k] = r[k] ? 1 : 0;
    }
  }
  const start = performance.now();
  await adapter.applyRemoteChanges(payload.changes);
  console.log(`SQLiteAdapter.applyRemoteChanges (excl. parse): ${ms(start)} ms`);
  const count = db.prepare('SELECT COUNT(*) AS n FROM attribute_codes').get().n;
  console.log(`  attribute_codes rows: ${count}`);
  await driver.close();
}
