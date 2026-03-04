import { defineConfig } from '@playwright/test';

const adapter = process.env.EXPO_PUBLIC_ADAPTER ?? 'loki-idb';

// Skip benchmark spec for expo-sqlite on web — wa-sqlite is too slow
// for the 5000-insert stress test on CI. Functional tests still run.
const ignoreBenchmark = adapter === 'expo-sqlite' ? ['**/benchmark.spec.ts'] : [];

export default defineConfig({
  testDir: './e2e',
  testIgnore: ignoreBenchmark,
  timeout: 30_000,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:19006',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `EXPO_PUBLIC_ADAPTER=${adapter} npx expo start --web --port 19006`,
    port: 19006,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
