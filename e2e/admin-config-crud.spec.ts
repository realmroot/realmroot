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
    await expect(page.getByRole('columnheader', { name: 'Application' })).toBeVisible()

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
    await expect(dialog.getByText('Client ID', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('cell', { name: 'E2E CRUD Application' }).first()).toBeVisible()
  })
  test('[spec: admin-console/site-navigation-console] operators manage external services and Account Center navigation', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/console')
    await page
      .getByRole('navigation', { name: 'Console', exact: true })
      .getByRole('link', { name: 'Settings', exact: true })
      .click()
    await expect(page).toHaveURL(/\/console\/tenant-settings\/general$/)
    await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Account Center', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add service', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit account permissions' })).toHaveCount(0)
    await page.getByRole('tab', { name: 'External services', exact: true }).click()
    await expect(page).toHaveURL(/\/console\/tenant-settings\/external-services$/)
    await page.reload()
    await expect(page.getByRole('tab', { name: 'External services', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByText('No external services configured.')).toBeVisible()
    async function add(name: string, url: string) {
      await page.getByRole('button', { name: 'Add service' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Name', { exact: true }).fill(name)
      await dialog.getByLabel('URL', { exact: true }).fill(url)
      await dialog.getByLabel('Icon', { exact: true }).selectOption('wallet')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(dialog).toBeHidden()
    }
    await add('Wallet', 'https://wallet.example.com')
    await add('Docs', 'https://docs.example.com')
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('settings-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/console')
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('tab', { name: 'External services', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Edit: Wallet', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Edit: Wallet', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('settings-mobile.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Edit: Wallet', exact: true }).click()
    await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toHaveValue('Wallet')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: 'Move up: Docs', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Move up: Docs', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Edit: Wallet', exact: true }).click()
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('My Wallet')
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.goto('/profile')
    const navigation = page.getByRole('navigation', { name: 'Account Center', exact: true })
    await expect(navigation.getByRole('link', { name: 'My Wallet', exact: true })).toHaveAttribute(
      'href',
      'https://wallet.example.com',
    )
    await expect(navigation.getByRole('link').filter({ hasText: /Docs|My Wallet/ })).toHaveText(['Docs', 'My Wallet'])
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Open Account Center navigation' }).click()
    await expect(page.getByRole('dialog').getByRole('link', { name: 'My Wallet', exact: true })).toHaveAttribute(
      'href',
      'https://wallet.example.com',
    )
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/console')
    await page
      .getByRole('navigation', { name: 'Console', exact: true })
      .getByRole('link', { name: 'Settings', exact: true })
      .click()
    await expect(page).toHaveURL(/\/console\/tenant-settings\/general$/)
    await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Account Center', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add service', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit account permissions' })).toHaveCount(0)
    await page.getByRole('tab', { name: 'External services', exact: true }).click()
    await expect(page).toHaveURL(/\/console\/tenant-settings\/external-services$/)
    await page.reload()
    await expect(page.getByRole('tab', { name: 'External services', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.getByRole('button', { name: 'Delete: My Wallet', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Delete: My Wallet', exact: true })).toBeHidden()
    await page.getByRole('button', { name: 'Delete: Docs', exact: true }).click()
    await expect(page.getByText('No external services configured.')).toBeVisible()
    await page.goto('/profile')
    await expect(page.getByText('More services', { exact: true })).toHaveCount(0)
  })
})
