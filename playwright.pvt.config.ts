import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import type { RealmrootOptions } from './e2e/fixtures'

if (existsSync('.dev.vars')) loadEnvFile('.dev.vars')

const baseURL = productionOrigin(process.env.PVT_BASE_URL)
requireCredential('PVT_USERNAME')
requireCredential('PVT_PASSWORD')
requireCredential('PVT_EXPECTED_VERSION')
const storageState = requiredEnvironmentVariable('REALMROOT_PVT_STORAGE_STATE_PATH')

export default defineConfig<RealmrootOptions>({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  grep: /@production-safe/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/pvt-global-setup.ts',
  globalTeardown: './e2e/pvt-global-teardown.ts',
  use: {
    baseURL,
    screenshot: 'off',
    storageState,
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

function requiredEnvironmentVariable(name: string) {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} is required to run production verification.`)
  return value
}
