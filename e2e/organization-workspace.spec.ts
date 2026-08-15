import { expect, test } from '@playwright/test'
import { resetAndBootstrap, signIn } from './helpers/real-app'

test.describe('Organization Workspace', () => {
  test.beforeEach(async () => {
    await resetAndBootstrap()
  })

  test('[spec: account-center/account-organization-management] workspace navigation, switching, nested details, and responsive drawer', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/console/organizations')

    await createOrganization(page, 'Alpha Organization', 'alpha-organization')
    await createOrganization(page, 'Beta Organization', 'beta-organization')

    await page.goto('/organizations')
    await expect(page.getByRole('button', { name: 'Switch', exact: true })).toHaveCount(0)
    await expect(page.getByText('Current', { exact: true })).toHaveCount(0)
    await page
      .locator('section.accountOrganizationCard')
      .filter({ hasText: 'Alpha Organization' })
      .getByRole('link', { name: 'Manage' })
      .click()
    await expect(page).toHaveURL(/\/organizations\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Alpha Organization' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Developer Center home' })).toContainText('Developer Center')
    await expect(page.getByRole('navigation', { name: 'Organization workspace' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    const alphaOrganizationId = new URL(page.url()).pathname.split('/')[2]
    const organizationContext = await page.request.get('/api/account/organization-context')
    expect(await organizationContext.json()).toEqual({ activeOrganizationId: alphaOrganizationId })

    await page.getByRole('button', { name: 'Switch organization' }).click()
    await page.getByRole('menuitem', { name: /Beta Organization/ }).click()
    await expect(page).toHaveURL(/\/organizations\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Beta Organization' })).toBeVisible()

    await page.getByRole('link', { name: 'Applications' }).click()
    await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'New application' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name').fill('Workspace Application')
    await dialog.getByLabel('Slug').fill('workspace-application')
    await dialog.getByRole('button', { name: /Traditional web app/ }).click()
    await dialog.getByLabel('Redirect URIs').fill('https://workspace.example.com/callback')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.getByText('Client ID', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()

    await page.getByRole('link', { name: 'Workspace Application', exact: true }).click()
    await expect(page).toHaveURL(/\/organizations\/[^/]+\/applications\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Workspace Application' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Organization workspace' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Applications' })).toHaveAttribute('aria-current', 'page')

    await page.getByRole('link', { name: 'Roles' }).click()
    await page.getByRole('button', { name: 'New role' }).click()
    const roleDialog = page.getByRole('dialog')
    await expect(roleDialog.getByLabel('Scopes')).toHaveCount(0)
    await roleDialog.getByLabel('Key').fill('workspace-reviewer')
    await roleDialog.getByLabel('Display name').fill('Workspace Reviewer')
    await roleDialog.getByLabel('Description').fill('Reviews Workspace resources.')
    await roleDialog.getByRole('button', { name: 'Save' }).click()
    await expect(roleDialog).toBeHidden()
    await page.getByRole('link', { name: 'Workspace Reviewer', exact: true }).click()
    await expect(page).toHaveURL(/\/organizations\/[^/]+\/roles\/workspace-reviewer\/overview$/)
    const roleHeading = page.getByRole('heading', { name: 'Workspace Reviewer' })
    await expect(roleHeading).toBeVisible()
    await expect(roleHeading.locator('xpath=ancestor::header')).toHaveClass(/consoleDetailHeader/)
    await expect(page.getByRole('tablist', { name: 'Role detail sections' })).toHaveClass(/w-full/)
    await page.getByRole('tab', { name: 'Permissions' }).click()
    await expect(page).toHaveURL(/\/organizations\/[^/]+\/roles\/workspace-reviewer\/permissions$/)
    await expect(page.getByRole('link', { name: 'Roles' })).toHaveAttribute('aria-current', 'page')

    await page.setViewportSize({ width: 390, height: 844 })
    const navigationTrigger = page.getByRole('button', { name: 'Open Developer Center navigation' })
    await expect(navigationTrigger).toBeVisible()
    await navigationTrigger.click()
    const navigationDrawer = page.getByRole('dialog', { name: 'Developer Center' })
    await expect(navigationDrawer.getByRole('link', { name: 'Members' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(navigationDrawer).toBeHidden()
    await expect(navigationTrigger).toBeFocused()
    await expect(page.locator('a.consoleBackLink')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

async function createOrganization(page: import('@playwright/test').Page, name: string, slug: string) {
  await page.getByRole('button', { name: 'Provision organization' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Slug').fill(slug)
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
}
