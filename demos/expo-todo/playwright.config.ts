import { defineConfig } from '@playwright/test';

const adapter = process.env.EXPO_PUBLIC_ADAPTER ?? 'loki-idb';

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
