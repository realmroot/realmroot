import { expect, test } from '@playwright/test'
import { admin, resetAndBootstrap, signIn } from './helpers/real-app'

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

  test('[spec: platform-onboarding/root-signed-in-redirect] root redirects signed-in users to Account Center', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/')
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByRole('heading', { name: admin.name })).toBeVisible()
  })

  test('[spec: account-center/account-center] Account Center loads account navigation', async ({ page }) => {
    await signIn(page)
    await page.goto('/profile')
    await expect(page.getByRole('navigation', { name: 'Account center' })).toBeVisible()
    await expect(page.getByRole('heading', { name: admin.name })).toBeVisible()
  })
})
