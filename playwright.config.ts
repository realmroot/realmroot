import { defineConfig, devices } from '@playwright/test'

// E2E runs against the real stack: `vite dev --mode e2e` serves the SPA + the
// Worker against an ISOLATED local D1 (CF_PERSIST_STATE_PATH, separate from
// `pnpm dev`'s state). The DB is reset + migrated by the global setup before the
// suite, and the suite is stateful (it drives onboarding), so it runs serially.
// The readiness probe is `/api/health`, which the Worker answers without a DB
// read, so it goes green before globalSetup migrates. Only hermetic journeys
// live here — no external dependency, just SPA + Worker + local D1 + auth.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4189)
const baseURL = `http://localhost:${PORT}`
const persistStatePath = process.env.CF_PERSIST_STATE_PATH ?? 'tests/e2e/.wrangler/state'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `vite dev --host 127.0.0.1 --mode e2e --port ${PORT}`,
    url: `${baseURL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      CF_WRANGLER_CONFIG: process.env.E2E_WRANGLER_CONFIG ?? 'tests/e2e/wrangler.toml',
      CF_PERSIST_STATE_PATH: persistStatePath,
      PLAYWRIGHT_PORT: String(PORT),
    },
  },
})
