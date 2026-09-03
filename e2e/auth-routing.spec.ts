import type { AccountProfileResponse } from '../shared/api/account'
import { expect, test } from './fixtures'
import { organizationOwner, resetAndBootstrap, seedOrganizationOwner, signIn, signOut } from './helpers/real-app'

test.describe('password sign-in', () => {
  test('[spec: hosted-auth/password-sign-in] password sign-in authenticates and sets a session cookie', async ({
    page,
    context,
    existingAccount,
  }) => {
    await signIn(page, existingAccount)
    await expect(page).toHaveURL(/\/profile$/)

    const cookies = await context.cookies()
    expect(cookies.some((cookie) => cookie.name.includes('session'))).toBe(true)
    await signOut(page)
  })
})

test.describe('authenticated routing', { tag: '@production-safe' }, () => {
  test('authenticated Account API returns the current identity', async ({ authenticatedPage, existingAccount }) => {
    const response = await authenticatedPage.request.get('/api/account/profile')

    expect(response.status()).toBe(200)
    const profile = (await response.json()) as AccountProfileResponse
    expect(profile.user).toMatchObject({
      username: existingAccount.username,
      emailVerified: true,
    })
  })

  test('session cookie uses the expected browser security policy', async ({
    authenticatedPage: _,
    context,
    realmrootTarget,
  }) => {
    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name.includes('session'))

    expect(sessionCookie).toBeDefined()
    expect(sessionCookie).toMatchObject({
      httpOnly: true,
      path: '/',
      sameSite: 'Lax',
      secure: realmrootTarget === 'production',
    })
  })

  test('[spec: platform-onboarding/root-signed-in-redirect] root opens Account Center for signed-in users', async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto('/')
    await expect(authenticatedPage).toHaveURL(/\/$/)
    await expect(authenticatedPage.getByRole('navigation', { name: 'Account center' })).toBeVisible()
    await expect(
      authenticatedPage.getByRole('heading', { name: /Good (morning|afternoon|evening), .+\./ }),
    ).toBeVisible()
  })

  test('[spec: account-center/account-center] Account Center loads account navigation', async ({
    authenticatedPage,
  }) => {
    await expect(authenticatedPage.getByRole('navigation', { name: 'Account center' })).toBeVisible()
    await expect(authenticatedPage.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(authenticatedPage.getByLabel('Identity details')).toBeVisible()
  })
})

test.describe('signed-out routing', { tag: '@production-safe' }, () => {
  test('Account API rejects unauthenticated requests with resource metadata', async ({
    page,
    context,
    baseURL,
    configuredRealm: _,
  }) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.')
    await context.clearCookies()

    const response = await page.request.get('/api/account/profile')

    expect(response.status()).toBe(401)
    expect(response.headers()['www-authenticate']).toBe(
      `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/api', baseURL)}"`,
    )
  })

  test('[spec: platform-onboarding/root-signed-out-redirect] root redirects signed-out visitors to hosted sign-in', async ({
    page,
    context,
    configuredRealm: _,
  }) => {
    await context.clearCookies()
    await page.goto('/')
    await expect(page).toHaveURL(/\/auth\/sign-in/)
  })

  test('[spec: platform-onboarding/signed-out-account-redirect] protected routes preserve the return target', async ({
    page,
    context,
    configuredRealm: _,
  }) => {
    await context.clearCookies()
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/auth\/sign-in/)
    expect(new URL(page.url()).searchParams.get('return_to')).toBe('/profile')
  })
})

test.describe('organization authority boundary', () => {
  test.beforeEach(async () => {
    await resetAndBootstrap()
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
