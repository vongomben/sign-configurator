import { defineConfig, devices } from '@playwright/test';

// Solo Chromium, headless. Il server è il preview del build appena prodotto da `npm run check`.
export default defineConfig({
  testDir: 'tests/smoke',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 120_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/sign-configurator/',
    headless: true,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/sign-configurator/index.html',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
