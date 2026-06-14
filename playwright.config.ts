import { defineConfig, devices } from '@playwright/test'

// E2E runs against the real stack: `vite dev --mode e2e` serves the SPA + the
// Worker against an ISOLATED local D1 (CF_PERSIST_STATE_PATH, separate from
// `pnpm dev`'s state). Only hermetic journeys live here — no external
// dependency, just SPA + Worker + local D1 + auth. The suite is stateful (it
// drives onboarding), so it runs serially.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4189)
const baseURL = `http://localhost:${PORT}`
const persistStatePath = process.env.CF_PERSIST_STATE_PATH ?? 'tests/e2e/.wrangler/state'
const wranglerConfig = process.env.E2E_WRANGLER_CONFIG ?? 'tests/e2e/wrangler.toml'
const d1Database = process.env.E2E_D1_DATABASE ?? 'flareauth-db-e2e'

// Migrate the isolated D1 BEFORE `vite dev` serves: the Worker loads the
// security policy from D1 on every request (including `/api/health`), so the
// webServer readiness probe 500s against an unmigrated DB. Playwright waits for
// that probe before running globalSetup, so on a fresh checkout (CI) creating
// the schema only in globalSetup would deadlock. globalSetup still resets data
// for a clean slate; this guarantees the tables exist first.
const migrateE2eD1 = `npx wrangler d1 migrations apply ${d1Database} --local --config ${wranglerConfig} --persist-to ${persistStatePath}`

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
    command: `${migrateE2eD1} && vite dev --host 127.0.0.1 --mode e2e --port ${PORT}`,
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
