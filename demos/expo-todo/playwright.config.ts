import { defineConfig } from '@playwright/test';

const adapter = process.env.EXPO_PUBLIC_ADAPTER ?? 'loki-idb';

// expo-sqlite on web requires Cross-Origin Isolation (SharedArrayBuffer / OPFS).
// Metro dev-server can't properly serve the wa-sqlite Web Worker, so we use a
// static export + a tiny HTTP server that sets COOP/COEP headers.
const needsCrossOriginIsolation = adapter === 'expo-sqlite';

const webServerCommand = needsCrossOriginIsolation
  ? `npx expo export --platform web && node serve-coi.mjs`
  : `EXPO_PUBLIC_ADAPTER=${adapter} npx expo start --web --port 19006`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:19006',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: webServerCommand,
    port: 19006,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
