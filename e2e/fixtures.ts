import { test as base, expect, type Page } from '@playwright/test'
import { admin, resetAndBootstrap, signIn, signOut } from './helpers/real-app'

export type RealmrootTarget = 'local' | 'production'

export type RealmrootOptions = {
  realmrootTarget: RealmrootTarget
}

export type TestAccount = {
  username: string
  password: string
}

type RealmrootFixtures = {
  authenticatedPage: Page
  configuredRealm: undefined
  existingAccount: TestAccount
}

export const test = base.extend<RealmrootOptions & RealmrootFixtures>({
  realmrootTarget: ['local', { option: true }],
  configuredRealm: async ({ realmrootTarget }, use) => {
    if (realmrootTarget === 'local') await resetAndBootstrap()
    await use(undefined)
  },
  existingAccount: async ({ configuredRealm: _, realmrootTarget }, use) => {
    const account =
      realmrootTarget === 'local'
        ? admin
        : {
            username: requiredEnvironmentVariable('PVT_USERNAME'),
            password: requiredEnvironmentVariable('PVT_PASSWORD'),
          }

    await use(account)
  },
  authenticatedPage: async ({ page, realmrootTarget, existingAccount }, use) => {
    if (realmrootTarget === 'local') await signIn(page, existingAccount)
    else await page.goto('/profile')

    await expect(page).toHaveURL(/\/profile$/)
    await use(page)

    if (realmrootTarget === 'local') await signOut(page)
  },
})

export { expect }

function requiredEnvironmentVariable(name: string) {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} is required for production verification.`)
  return value
}
