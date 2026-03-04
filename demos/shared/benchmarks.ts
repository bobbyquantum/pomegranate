/**
 * PomegranateDB Benchmark Suite
 *
 * Runs a series of database operations and measures wall-clock time.
 * Designed to work with any adapter (Loki, ExpoSQLite, OpSQLite, NativeSQLite).
 *
 * Operations 1–9 go through the ORM (Collection.create, db.batch, etc.)
 * and are identical for every adapter — fair apples-to-apples comparison.
 *
 * Operations 10–11 bypass the ORM and hit the SQL driver directly to
 * isolate sync-vs-async overhead. They are skipped for non-SQL adapters (Loki).
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  name: string;
  ops: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
}

export interface BenchmarkSuite {
  results: BenchmarkResult[];
  totalMs: number;
  adapter: string;
  timestamp: string;
}

// We use `any` for the database/model types because this module is shared
// across demo apps with different TS configs and module resolution.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any;

// ─── Helpers ───────────────────────────────────────────────────────────────

function measure(name: string, ops: number, totalMs: number): BenchmarkResult {
  return {
    name,
    ops,
    totalMs: Math.round(totalMs * 100) / 100,
    avgMs: Math.round((totalMs / ops) * 1000) / 1000,
    opsPerSec: Math.round((ops / totalMs) * 1000),
  };
}

// ─── Benchmark Runner ──────────────────────────────────────────────────────

export async function runBenchmarks(
  db: AnyDB,
  TodoModel: AnyModel,
  adapterName: string,
  onProgress?: (step: string) => void,
): Promise<BenchmarkSuite> {
  const results: BenchmarkResult[] = [];
  const suiteStart = performance.now();

  const report = (step: string) => onProgress?.(step);

  // ── 1. Single inserts (100 records) ──────────────────────────────────
  report('Single inserts (100)…');
  const N_SINGLE = 100;
  const singleStart = performance.now();
  const createdIds: string[] = [];
  await db.write(async () => {
    for (let i = 0; i < N_SINGLE; i++) {
      const record = await db.get(TodoModel).create({
        title: `Bench item ${i}`,
        isCompleted: false,
        priority: i % 5,
        createdAt: new Date(),
      });
      createdIds.push(record.id);
    }
  });
  results.push(measure('Insert (single, N=100)', N_SINGLE, performance.now() - singleStart));

  // ── 2. Batch inserts (1000 records) ──────────────────────────────────
  report('Batch inserts (1000)…');
  const N_BATCH = 1000;
  const batchStart = performance.now();
  await db.write(async () => {
    for (let i = 0; i < N_BATCH; i++) {
      await db.get(TodoModel).create({
        title: `Batch item ${i}`,
        isCompleted: i % 3 === 0,
        priority: i % 10,
        createdAt: new Date(),
      });
    }
  });
  results.push(measure('Insert (batch, N=1000)', N_BATCH, performance.now() - batchStart));

  // ── 3. Count all ─────────────────────────────────────────────────────
  report('Count all…');
  const countStart = performance.now();
  const N_COUNT = 20;
  const collection = db.get(TodoModel);
  for (let i = 0; i < N_COUNT; i++) {
    await collection.count(collection.query());
  }
  results.push(measure('Count all (×20)', N_COUNT, performance.now() - countStart));

  // ── 4. Query: fetch all ──────────────────────────────────────────────
  report('Fetch all records…');
  const fetchAllStart = performance.now();
  const N_FETCH = 10;
  for (let i = 0; i < N_FETCH; i++) {
    await collection.fetch(collection.query());
  }
  results.push(measure('Fetch all (×10)', N_FETCH, performance.now() - fetchAllStart));

  // ── 5. Query with filter (isCompleted = true) ────────────────────────
  report('Filtered query…');
  const filterStart = performance.now();
  const N_FILTER = 20;
  for (let i = 0; i < N_FILTER; i++) {
    await collection.fetch(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collection.query((qb: any) => qb.where('isCompleted', 'eq', true)),
    );
  }
  results.push(measure('Query filtered (×20)', N_FILTER, performance.now() - filterStart));

  // ── 6. Update records (100) ──────────────────────────────────────────
  report('Updating 100 records…');
  const updateStart = performance.now();
  const toUpdate = await collection.fetch(collection.query());
  const N_UPDATE = Math.min(100, toUpdate.length);
  await db.write(async () => {
    for (let i = 0; i < N_UPDATE; i++) {
      await toUpdate[i].update({ title: `Updated ${i}`, priority: (i % 5) + 1 });
    }
  });
  results.push(measure('Update (N=100)', N_UPDATE, performance.now() - updateStart));

  // ── 7. Read single field (1000 records) ──────────────────────────────
  report('Reading fields…');
  const readStart = performance.now();
  const allRecords = await collection.fetch(collection.query());
  const N_READ = allRecords.length;
  for (const record of allRecords) {
    record.getField('title');
    record.getField('isCompleted');
    record.getField('priority');
  }
  results.push(measure(`Read fields (N=${N_READ}×3)`, N_READ * 3, performance.now() - readStart));

  // ── 8. Delete records (all) ──────────────────────────────────────────
  report('Deleting all records…');
  const deleteStart = performance.now();
  const toDelete = await collection.fetch(collection.query());
  const N_DELETE = toDelete.length;
  await db.write(async () => {
    await db.batch(
      toDelete.map((record: any) => ({
        type: 'destroyPermanently' as const,
        table: collection.table,
        id: record.id,
      })),
    );
  });
  results.push(measure(`Delete (N=${N_DELETE})`, N_DELETE, performance.now() - deleteStart));

  // ── 9. Large batch insert + delete (5000) ────────────────────────────
  report('Stress test (5000 insert + delete)…');
  const stressStart = performance.now();
  const N_STRESS = 5000;
  await db.write(async () => {
    for (let i = 0; i < N_STRESS; i++) {
      await db.get(TodoModel).create({
        title: `Stress ${i}`,
        isCompleted: i % 2 === 0,
        priority: i % 10,
        createdAt: new Date(),
      });
    }
  });
  const stressRecords = await collection.fetch(collection.query());
  await db.write(async () => {
    await db.batch(
      stressRecords.map((record: any) => ({
        type: 'destroyPermanently' as const,
        table: collection.table,
        id: record.id,
      })),
    );
  });
  results.push(measure('Stress insert+delete (N=5000)', N_STRESS * 2, performance.now() - stressStart));

  // ── 10–11. Raw SQL sync vs async (bypass ORM) ───────────────────────
  //
  // These operations bypass the ORM layer entirely and call the SQL
  // driver directly. This isolates the sync/async overhead of the
  // underlying SQLite library. Skipped for non-SQL adapters (Loki).
  //
  // We access the driver through private internals — acceptable for
  // benchmarking purposes.

  const driver = (db as any)?._adapter?._driver;
  const hasSyncAsync = driver?.executeSync && driver?.executeAsync;

  if (hasSyncAsync) {
    const N_RAW = 500;
    const RAW_TABLE = '__pomegranate_bench_raw';

    // Create a temporary benchmark table (not a model table)
    await driver.execute(
      `CREATE TABLE IF NOT EXISTS "${RAW_TABLE}" (id INTEGER PRIMARY KEY, val TEXT, num REAL)`,
    );
    await driver.execute(`DELETE FROM "${RAW_TABLE}"`);

    // ── 10. Raw sync inserts ───────────────────────────────────────────
    report(`Raw sync inserts (${N_RAW})…`);
    const syncStart = performance.now();
    for (let i = 0; i < N_RAW; i++) {
      driver.executeSync(
        `INSERT INTO "${RAW_TABLE}" (val, num) VALUES (?, ?)`,
        [`sync-${i}`, i * 1.1],
      );
    }
    results.push(measure(`Raw sync INSERT (N=${N_RAW})`, N_RAW, performance.now() - syncStart));

    // Clean up before async test
    await driver.execute(`DELETE FROM "${RAW_TABLE}"`);

    // ── 11. Raw async inserts ──────────────────────────────────────────
    report(`Raw async inserts (${N_RAW})…`);
    const asyncStart = performance.now();
    for (let i = 0; i < N_RAW; i++) {
      await driver.executeAsync(
        `INSERT INTO "${RAW_TABLE}" (val, num) VALUES (?, ?)`,
        [`async-${i}`, i * 1.1],
      );
    }
    results.push(measure(`Raw async INSERT (N=${N_RAW})`, N_RAW, performance.now() - asyncStart));

    // Clean up
    await driver.execute(`DROP TABLE IF EXISTS "${RAW_TABLE}"`);
  } else {
    report('Skipping raw sync/async (non-SQL adapter)…');
  }

  const suite: BenchmarkSuite = {
    results,
    totalMs: Math.round(performance.now() - suiteStart),
    adapter: adapterName,
    timestamp: new Date().toISOString(),
  };

  // Log structured results so CI can extract them from logcat / simulator logs.
  // Single line with a unique prefix for easy grep extraction.
  console.log(`[POMEGRANATE_BENCHMARK]${JSON.stringify(suite)}`);

  return suite;
}

// ─── Formatting ────────────────────────────────────────────────────────────

export function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatOpsPerSec(ops: number): string {
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(1)}M`;
  if (ops >= 1000) return `${(ops / 1000).toFixed(1)}K`;
  return `${ops}`;
}
