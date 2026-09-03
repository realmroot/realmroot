import { defineConfig, devices } from '@playwright/test'
import type { RealmrootOptions } from './e2e/fixtures'

const baseURL = productionOrigin(process.env.PVT_BASE_URL)
requireCredential('PVT_USERNAME')
requireCredential('PVT_PASSWORD')

export default defineConfig<RealmrootOptions>({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  grep: /@production-safe/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [
    {
      name: 'production-chromium',
      use: { ...devices['Desktop Chrome'], realmrootTarget: 'production' },
    },
  ],
})

function productionOrigin(value: string | undefined) {
  if (!value?.trim()) throw new Error('PVT_BASE_URL is required for production verification.')

  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('PVT_BASE_URL must use HTTPS.')
  if (url.origin !== value.replace(/\/$/, '')) throw new Error('PVT_BASE_URL must be an origin without a path, query, or fragment.')
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
    throw new Error('PVT_BASE_URL must identify a remote deployment.')
  }

  return url.origin
}

function requireCredential(name: string) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required for production verification.`)
}
