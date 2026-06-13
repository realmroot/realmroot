import { expect, test } from '@playwright/test'
import { resetAndBootstrap, signIn } from './helpers/real-app'

// Hermetic admin config CRUD driven through the REAL Console UI: a signed-in
// admin opens the applications page, creates an OIDC application via the dialog,
// and sees it appear in the list. Only writes local D1 — no third-party IdP, no
// external network.
test.describe('admin config CRUD (Console UI)', () => {
  test.beforeEach(async () => {
    await resetAndBootstrap()
  })

  test('[spec: admin-console/admin-create-application] admin creates an OIDC application from the Console UI', async ({
    page,
  }) => {
    await signIn(page)

    await page.goto('/console/applications')
    await expect(page.getByRole('columnheader', { name: 'Application name' })).toBeVisible()

    await page.getByRole('button', { name: 'New application' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Create application' })).toBeVisible()

    await dialog.getByLabel('Name').fill('E2E CRUD Application')
    await dialog.getByLabel('Slug').fill('e2e-crud-application')
    await dialog.getByRole('button', { name: /Traditional web app/ }).click()
    await dialog.getByLabel('Redirect URIs').fill('https://app.example.com/callback')
    await dialog.getByRole('button', { name: 'Save' }).click()

    // Creating an OIDC client succeeds through the UI: the dialog reveals the new
    // client's credentials. Close it, then confirm the app is in the Console list.
    await expect(dialog.getByText('Client ID')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('cell', { name: 'E2E CRUD Application' }).first()).toBeVisible()
  })
})
