#!/usr/bin/env node
/**
 * Generates a synthetic sync bundle shaped like a real app schema, for the
 * turbo importer benchmark.
 *
 * Input is a WatermelonDB-style schema.ts (tableSchema({ name, columns })
 * blocks) so the payload has the same tables, column names and types as the
 * app being migrated. Output:
 *
 *   <out>/create.sql     CREATE TABLE statements (PomegranateDB column rules)
 *   <out>/columns.json   { table: [columns] } for the importer's schema filter
 *   <out>/bundle.json    { changes: { table: { created, updated: [], deleted: [] } }, timestamp }
 *
 * Usage:
 *   node gen-bundle.mjs <schema.ts> <out-dir> [--rows 150000] [--seed 1]
 *
 * Rows are spread unevenly across tables (a handful of large reference
 * tables, a long tail of small ones) which is how real sync bundles look.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('usage: gen-bundle.mjs <schema.ts> <out-dir> [--rows N] [--seed S]');
  process.exit(2);
}
const [schemaPath, outDir] = args;
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const totalRows = flag('--rows', 150_000);
let seed = flag('--seed', 1);

// ─── Tiny deterministic PRNG ─────────────────────────────────────────────
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.,';
function text(min, max) {
  const len = min + Math.floor(rand() * (max - min));
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[Math.floor(rand() * ALPHA.length)];
  return s;
}
function id() {
  return text(24, 24).replaceAll(/[ -.,]/g, 'x');
}

// ─── Parse schema.ts ─────────────────────────────────────────────────────
const source = fs.readFileSync(schemaPath, 'utf8');
const tables = [];
const tableRe = /tableSchema\(\s*\{\s*name:\s*'([^']+)',\s*columns:\s*\[([\s\S]*?)\]\s*,?\s*\}\s*\)/g;
const columnRe = /\{\s*name:\s*'([^']+)',\s*type:\s*'([^']+)'([^}]*)\}/g;
for (const match of source.matchAll(tableRe)) {
  const columns = [];
  for (const col of match[2].matchAll(columnRe)) {
    columns.push({
      name: col[1],
      type: col[2], // string | number | boolean
      isOptional: /isOptional:\s*true/.test(col[3]),
      isIndexed: /isIndexed:\s*true/.test(col[3]),
    });
  }
  tables.push({ name: match[1], columns });
}
if (tables.length === 0) {
  console.error('no tableSchema blocks found in', schemaPath);
  process.exit(1);
}

// ─── Row distribution: 5% of tables get 60% of rows, 20% get 30%, rest 10% ─
const shuffled = [...tables].sort(() => rand() - 0.5);
const big = shuffled.slice(0, Math.max(1, Math.round(tables.length * 0.05)));
const mid = shuffled.slice(big.length, big.length + Math.max(1, Math.round(tables.length * 0.2)));
const small = shuffled.slice(big.length + mid.length);
const rowsFor = new Map();
for (const t of big) rowsFor.set(t.name, Math.floor((totalRows * 0.6) / big.length));
for (const t of mid) rowsFor.set(t.name, Math.floor((totalRows * 0.3) / mid.length));
for (const t of small) rowsFor.set(t.name, Math.max(1, Math.floor((totalRows * 0.1) / Math.max(1, small.length))));

// ─── Emit ────────────────────────────────────────────────────────────────
fs.mkdirSync(outDir, { recursive: true });

const sqlType = { string: 'TEXT', number: 'REAL', boolean: 'INTEGER' };
const sqlDefault = { string: "''", number: '0', boolean: '0' };
const createSql = tables
  .map((t) => {
    const defs = [
      '"id" TEXT PRIMARY KEY NOT NULL',
      "\"_status\" TEXT NOT NULL DEFAULT 'created'",
      "\"_changed\" TEXT NOT NULL DEFAULT ''",
      ...t.columns.map((c) =>
        `"${c.name}" ${sqlType[c.type] ?? 'TEXT'}${c.isOptional ? ' DEFAULT NULL' : ` NOT NULL DEFAULT ${sqlDefault[c.type] ?? "''"}`}`,
      ),
    ];
    const indexes = [
      `CREATE INDEX IF NOT EXISTS "${t.name}__status" ON "${t.name}" ("_status");`,
      ...t.columns
        .filter((c) => c.isIndexed)
        .map((c) => `CREATE INDEX IF NOT EXISTS "${t.name}_${c.name}" ON "${t.name}" ("${c.name}");`),
    ];
    return [`CREATE TABLE IF NOT EXISTS "${t.name}" (${defs.join(', ')});`, ...indexes].join('\n');
  })
  .join('\n');
fs.writeFileSync(path.join(outDir, 'create.sql'), createSql);

const columns = Object.fromEntries(tables.map((t) => [t.name, t.columns.map((c) => c.name)]));
fs.writeFileSync(path.join(outDir, 'columns.json'), JSON.stringify(columns));

// Stream the bundle to disk so large payloads don't need to fit in one string.
const out = fs.createWriteStream(path.join(outDir, 'bundle.json'));
const write = (s) => new Promise((resolve) => (out.write(s) ? resolve() : out.once('drain', resolve)));

const NOW = Date.now();
function value(col) {
  if (col.isOptional && rand() < 0.15) return null;
  switch (col.type) {
    case 'boolean':
      return rand() < 0.5;
    case 'number':
      return /_at$|_date|date_/.test(col.name) ? NOW - Math.floor(rand() * 1e10) : Math.floor(rand() * 10_000);
    default:
      if (/_id$/.test(col.name)) return id();
      if (/description|note|text|narrative/.test(col.name)) return text(20, 200);
      return text(4, 30);
  }
}

let emitted = 0;
await write('{"changes":{');
for (const [ti, t] of tables.entries()) {
  const n = rowsFor.get(t.name);
  await write(`${ti ? ',' : ''}${JSON.stringify(t.name)}:{"created":[`);
  let chunk = [];
  for (let i = 0; i < n; i++) {
    const row = { id: id(), _status: 'synced', _changed: '' };
    for (const c of t.columns) row[c.name] = value(c);
    chunk.push(JSON.stringify(row));
    if (chunk.length === 500) {
      await write((i >= 500 ? ',' : '') + chunk.join(','));
      chunk = [];
    }
  }
  if (chunk.length) await write((n > 500 ? ',' : '') + chunk.join(','));
  await write('],"updated":[],"deleted":[]}');
  emitted += n;
}
await write(`},"timestamp":${NOW}}`);
await new Promise((resolve) => out.end(resolve));

const size = fs.statSync(path.join(outDir, 'bundle.json')).size;
console.log(`tables: ${tables.length}, rows: ${emitted}, bundle: ${(size / 1048576).toFixed(1)} MB → ${outDir}`);
console.log(`largest tables: ${big.map((t) => `${t.name} (${rowsFor.get(t.name)})`).join(', ')}`);
