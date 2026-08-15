import { expect, test } from '@playwright/test'
import { admin, organizationOwner, resetAndBootstrap, seedOrganizationOwner, signIn } from './helpers/real-app'

// Hermetic: a bootstrapped admin, real Better Auth password sign-in over local
// D1, session cookies, and the signed-out/signed-in routing walls. No external
// dependency.
test.describe('password sign-in, session, and routing', () => {
  test.beforeEach(async () => {
    await resetAndBootstrap()
  })

  test('[spec: hosted-auth/password-sign-in] password sign-in authenticates and sets a session cookie', async ({
    page,
    context,
  }) => {
    await signIn(page)
    await expect(page).toHaveURL(/\/profile$/)

    const cookies = await context.cookies()
    expect(cookies.some((cookie) => cookie.name.includes('session'))).toBe(true)
  })

  test('[spec: platform-onboarding/root-signed-out-redirect] root redirects signed-out visitors to hosted sign-in', async ({
    page,
    context,
  }) => {
    await context.clearCookies()
    await page.goto('/')
    await expect(page).toHaveURL(/\/auth\/sign-in/)
  })

  test('[spec: platform-onboarding/signed-out-account-redirect] protected routes preserve the return target', async ({
    page,
    context,
  }) => {
    await context.clearCookies()
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/auth\/sign-in/)
    expect(new URL(page.url()).searchParams.get('return_to')).toBe('/profile')
  })

  test('[spec: platform-onboarding/root-signed-in-redirect] root opens Account Center for signed-in users', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('navigation', { name: 'Account center' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Realmroot\./ })).toBeVisible()
  })

  test('[spec: account-center/account-center] Account Center loads account navigation', async ({ page }) => {
    await signIn(page)
    await page.goto('/profile')
    await expect(page.getByRole('navigation', { name: 'Account center' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(page.getByLabel('Identity details').getByText(admin.name, { exact: true })).toBeVisible()
  })

  test('[spec: admin-console/organization-workspace-platform-boundary] Organization ownership grants Workspace access but not Console authority', async ({
    page,
  }) => {
    await page.goto('/auth/sign-up')
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(organizationOwner.name)
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(organizationOwner.email)
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill(organizationOwner.username)
    await page.getByRole('textbox', { name: 'Password' }).fill(organizationOwner.password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
    seedOrganizationOwner()
    await page.goto('/auth/sign-in')
    await page.getByRole('textbox', { name: 'Email or username' }).fill(organizationOwner.username)
    await page.getByRole('textbox', { name: 'Password' }).fill(organizationOwner.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/profile')

    await page.goto(`/organizations/${organizationOwner.organizationId}/overview`)
    await expect(page.getByRole('heading', { name: organizationOwner.organizationName })).toBeVisible()
    await page.getByRole('link', { name: 'Applications' }).click()
    await expect(page).toHaveURL(new RegExp(`/organizations/${organizationOwner.organizationId}/applications$`))
    await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible()

    const realmInventoryRequests: string[] = []
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (['/api/readiness', '/api/users', '/api/connectors'].includes(pathname)) realmInventoryRequests.push(pathname)
    })
    await page.goto('/console')
    await expect(page).toHaveURL(/\/organizations$/)
    expect(realmInventoryRequests).toEqual([])
  })
})
