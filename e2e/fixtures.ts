import { test as base, expect } from '@playwright/test'
import { admin, resetAndBootstrap } from './helpers/real-app'

export type RealmrootTarget = 'local' | 'production'

export type RealmrootOptions = {
  realmrootTarget: RealmrootTarget
}

export type TestAccount = {
  username: string
  password: string
}

type RealmrootFixtures = {
  configuredRealm: undefined
  existingAccount: TestAccount
}

export const test = base.extend<RealmrootOptions & RealmrootFixtures>({
  realmrootTarget: ['local', { option: true }],
  configuredRealm: async ({ realmrootTarget }, use) => {
    if (realmrootTarget === 'local') await resetAndBootstrap()
    await use(undefined)
  },
  existingAccount: async ({ configuredRealm: _, realmrootTarget, context, baseURL }, use) => {
    const account =
      realmrootTarget === 'local'
        ? admin
        : {
            username: requiredEnvironmentVariable('PVT_USERNAME'),
            password: requiredEnvironmentVariable('PVT_PASSWORD'),
          }

    await use(account)

    const cookies = await context.cookies()
    if (!cookies.some((cookie) => cookie.name.includes('session'))) return
    if (!baseURL) throw new Error('Playwright baseURL is required to revoke the smoke session.')

    const response = await context.request.post(`${baseURL}/api/auth/sign-out`, {
      data: {},
      headers: { origin: new URL(baseURL).origin },
    })
    if (!response.ok()) throw new Error(`Smoke session cleanup failed with HTTP ${response.status()}.`)
  },
})

export { expect }

function requiredEnvironmentVariable(name: string) {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} is required for production verification.`)
  return value
}
