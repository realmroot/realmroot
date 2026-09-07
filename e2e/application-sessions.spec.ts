import { createHash } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { admin, baseURL, resetAndBootstrap, signIn } from './helpers/real-app'

const redirectUri = 'com.example.hosted-sessions:/callback'
const verifier = 'hosted-sessions-pkce-verifier-0123456789abcdefghijklmnop'

test('[spec: account-center/hosted-application-sessions] preserves the application through sign-in and removes one login', async ({
  page,
  context,
}) => {
  await resetAndBootstrap()
  await signIn(page)
  const organizations = await (await page.request.get('/api/organizations')).json()
  const owner = organizations.items.find((item: { slug: string }) => item.slug === 'realmroot')
  const response = await page.request.post('/api/applications', {
    data: {
      name: 'Hosted Sessions App',
      clientType: 'public_native',
      redirectUris: [redirectUri],
      ownerOrganizationId: owner.id,
      consentRequired: false,
      visibility: 'public',
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  const { clientId } = await response.json()
  const first = await login(page, clientId, 'installation-0001', 'My Android', 'android')
  const repeated = await login(page, clientId, 'installation-0001', 'My Android', 'android')
  const second = await login(page, clientId, 'installation-0002', 'My MacBook', 'macos')
  await context.clearCookies()
  const target = `/application-sessions?client_id=${encodeURIComponent(clientId)}`
  await page.goto(target)
  await expect(page).toHaveURL(/\/auth\/sign-in/)
  expect(new URL(page.url()).searchParams.get('return_to')).toBe(target)
  await page.getByRole('textbox', { name: 'Email or username' }).fill(admin.username)
  await page.getByRole('textbox', { name: 'Password' }).fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new URL(target, baseURL).href)
  await expect(page.getByRole('heading', { name: 'Application devices' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hosted Sessions App' })).toBeVisible()
  await expect(
    page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Managing account' }) })
      .getByText(admin.email, { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('2 devices · 0 unidentified sessions', { exact: true })).toBeVisible()
  await expect(page.getByText(/My Android ·/)).toBeVisible()
  await expect(page.getByText(/My MacBook ·/)).toBeVisible()
  await expect(page.getByText(/up to 1 hour/)).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('application-sessions-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: test.info().outputPath('application-sessions-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const remove = page.getByRole('button', { name: 'Remove device', exact: true }).first()
  await remove.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('2 devices · 0 unidentified sessions', { exact: true })).toBeVisible()
  await remove.click()
  await dialog.getByRole('button', { name: 'Remove device', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('1 devices · 0 unidentified sessions', { exact: true })).toBeVisible()
  await expect(page.getByText(/Login session removed\./)).toBeVisible()
  const refreshed = await Promise.all(
    [first, repeated, second].map((refreshToken) =>
      page.request.post('/api/auth/oauth2/token', {
        headers: { origin: baseURL },
        form: { client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken },
      }),
    ),
  )
  expect(refreshed.map((result) => result.status()).sort()).toEqual([200, 200, 400])
})

async function login(page: Page, clientId: string, installationId: string, name: string, platform: string) {
  const authorization = await page.request.get(
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'openid offline_access',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      installation_id: installationId,
      device_name: name,
      device_platform: platform,
    })}`,
    { maxRedirects: 0 },
  )
  expect(authorization.status(), await authorization.text()).toBe(200)
  const code = new URL((await authorization.json()).url).searchParams.get('code')
  expect(code).toBeTruthy()
  const token = await page.request.post('/api/auth/oauth2/token', {
    headers: { origin: baseURL },
    form: {
      client_id: clientId,
      grant_type: 'authorization_code',
      code: code!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    },
  })
  expect(token.status(), await token.text()).toBe(200)
  return (await token.json()).refresh_token as string
}
