import { expect, test } from '@playwright/test'
import { admin, resetState } from './helpers/real-app'

// Hermetic: fresh deployment, no users. Each test re-seeds an empty D1 so the
// first-admin gate is exercised against a true cold start. Serial suite — no
// cross-test bleed.
test.describe('first-admin onboarding', () => {
  test.beforeEach(() => {
    resetState()
  })

  test('[spec: platform-onboarding/first-admin-gate] fresh deployment redirects hosted auth to onboarding', async ({
    page,
  }) => {
    await page.goto('/auth/sign-in')
    await expect(page).toHaveURL(/\/onboarding$/)
  })

  test('[spec: platform-onboarding/public-onboarding] creates the first admin from the onboarding form', async ({
    page,
  }) => {
    await page.goto('/onboarding')

    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(admin.name)
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Username').fill(admin.username)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Create first admin' }).click()

    await expect(page.getByText('First admin created. Sign in to finish Console setup.')).toBeVisible()
  })
})
