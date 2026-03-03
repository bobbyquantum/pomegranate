import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ─── Helpers ───────────────────────────────────────────────────────────────

async function waitForApp(page: Page) {
  await page.waitForSelector('text=PomegranateDB', { timeout: 15_000 });
}

// ─── Benchmark test ────────────────────────────────────────────────────────

test.describe('PomegranateDB Benchmarks', () => {
  // Benchmarks can take several minutes on CI (stress test = 5000 inserts + deletes)
  test.setTimeout(300_000);

  test('runs benchmarks and captures results', async ({ page }) => {
    // Collect console messages to capture the [POMEGRANATE_BENCHMARK] JSON
    const benchmarkMessages: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[POMEGRANATE_BENCHMARK]')) {
        benchmarkMessages.push(text.replace(/.*\[POMEGRANATE_BENCHMARK\]/, ''));
      }
    });

    await page.goto('/');
    await waitForApp(page);

    // Navigate to benchmarks tab
    await page.getByTestId('tab-benchmarks').click();
    await expect(page.getByText('Database Benchmarks')).toBeVisible();

    // Run benchmarks
    await page.getByTestId('benchmark-btn').click();

    // Wait for benchmarks to complete (stress test can take a while)
    await expect(page.getByTestId('benchmark-complete')).toBeVisible({ timeout: 300_000 });

    // Verify the summary is displayed
    await expect(page.getByTestId('benchmark-summary')).toBeVisible();

    // Verify we captured the benchmark JSON from console
    expect(benchmarkMessages.length).toBeGreaterThanOrEqual(1);

    const benchmarkJson = benchmarkMessages[0];
    const suite = JSON.parse(benchmarkJson);

    // Validate the structure
    expect(suite).toHaveProperty('results');
    expect(suite).toHaveProperty('totalMs');
    expect(suite).toHaveProperty('adapter');
    expect(suite).toHaveProperty('timestamp');
    expect(suite.results.length).toBeGreaterThanOrEqual(9);

    // Validate each result has the expected fields
    for (const result of suite.results) {
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('ops');
      expect(result).toHaveProperty('totalMs');
      expect(result).toHaveProperty('avgMs');
      expect(result).toHaveProperty('opsPerSec');
      expect(result.opsPerSec).toBeGreaterThan(0);
    }

    // Save benchmark result to file for CI extraction
    const outputDir = path.join(__dirname, '..', 'benchmark-results');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'benchmark-result.json'),
      JSON.stringify(suite, null, 2),
    );

    console.log(`Benchmark complete: ${suite.adapter} — ${suite.totalMs}ms total`);
    for (const r of suite.results) {
      console.log(`  ${r.name}: ${r.totalMs}ms (${r.opsPerSec} ops/s)`);
    }
  });
});
