import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // D6 — marker coverage is a RUNTIME rule, not a scan of spec source.
  // globalSetup clears the observation sink so a file left by an earlier run
  // cannot satisfy it; globalTeardown reads back the (test title, marker id)
  // pairs the shared helpers actually executed and throws when a recorded
  // mutation's pair is missing. Deleting either line turns that rule off, which
  // is why the teardown treats a MISSING sink as a failure rather than as
  // nothing to check.
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4667/crypto-lab-hidden-bit/',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4667 --strictPort',
    url: 'http://localhost:4667/crypto-lab-hidden-bit/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});