import { expect, test } from '@playwright/test'
import {
  attachCoverage,
  createApiResource,
  createOidcApplication,
  createOrganization,
  createRole,
  resetAndBootstrap,
  signIn,
} from './helpers/real-app'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await resetAndBootstrap()
})

test('signed-out Console routes redirect before management API data loads', async ({ page }, testInfo) => {
  const managementResponses: string[] = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/api/management')) managementResponses.push(url.pathname)
  })

  await page.goto('/console/dashboard')
  await expect(page).toHaveURL(/\/sign-in/)
  expect(new URL(page.url()).searchParams.get('return_to')).toContain('/console/dashboard')
  expect(managementResponses).toEqual([])

  await attachCoverage(testInfo, ['admin-signed-out-redirect'])
})

test('Console route-backed navigation and compatibility redirects use persistent pages', async ({ page }, testInfo) => {
  await signIn(page)
  await createOidcApplication(page, 'Navigation Bootstrap')

  const pages = [
    ['/console/applications', 'Applications'],
    ['/console/users', 'Users'],
    ['/console/connectors', 'Connectors'],
    ['/console/sign-in-experience/content', 'Content'],
    ['/console/mfa', 'Multi-factor authentication'],
    ['/console/security/general', 'General security'],
    ['/console/organizations', 'Organizations'],
    ['/console/roles', 'Roles'],
    ['/console/api-resources', 'API resources'],
    ['/console/organization-template/organization-roles', 'Organization template'],
    ['/console/customize-jwt', 'Custom JWT'],
    ['/console/webhooks/endpoints', 'Webhooks'],
  ] as const

  for (const [path, heading] of pages) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  await page.goto('/admin/applications')
  await expect(page).toHaveURL(/\/console\/applications$/)
  await attachCoverage(testInfo, ['admin-route-backed-navigation', 'admin-sign-in-experience-routes'])
})

test('admin application detail loads settings, branding, and OIDC claim controls', async ({ page }, testInfo) => {
  await signIn(page)
  const application = await createOidcApplication(page, 'Detail Application')

  await page.goto(`/console/applications/${application.id}/settings`)
  await expect(page.getByRole('heading', { name: 'Detail Application' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Access token roles' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'ID token roles' })).not.toBeChecked()
  await page.getByRole('switch', { name: 'Access token organization ID' }).click()
  await page.getByRole('switch', { name: 'ID token roles' }).click()
  await page.getByRole('switch', { name: 'ID token permissions' }).click()
  await page.getByRole('switch', { name: 'UserInfo organization name' }).click()
  const claimsUpdate = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/management/applications/${application.id}`) &&
      response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: 'Save OIDC claims' }).click()
  expect((await claimsUpdate).status()).toBe(200)
  await expect(page.getByRole('switch', { name: 'Access token organization ID' })).toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Access token organization ID' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'ID token roles' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'ID token permissions' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'UserInfo organization name' })).toBeChecked()
  const updated = await page.request.get(`/api/management/applications/${application.id}`)
  const updatedBody = await updated.json()
  expect(updated.status()).toBe(200)
  expect(updatedBody).toMatchObject({
    oidcClaims: {
      accessToken: {
        authorization: true,
        roles: true,
        permissions: true,
        organizationId: true,
      },
      idToken: {
        roles: true,
        permissions: true,
      },
      userInfo: {
        organizationName: true,
      },
    },
  })
  await page.goto(`/console/applications/${application.id}/branding`)
  await expect(page.getByRole('heading', { name: 'Detail Application' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Branding' })).toBeVisible()

  await attachCoverage(testInfo, ['admin-application-detail', 'admin-application-oidc-claims'])
})

test('admin creates organizations, roles, and API resources from split Console pages', async ({ page }, testInfo) => {
  await signIn(page)
  await createOidcApplication(page, 'Authorization Bootstrap')

  await page.goto('/console/organizations')
  await page.getByRole('button', { name: 'New organization' }).click()
  await page.getByLabel('Slug').fill('e2e-organization')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('E2E Organization')
  await page.getByLabel('Display name').fill('E2E Organization')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('link', { name: 'E2E Organization' })).toBeVisible()

  await page.goto('/console/api-resources')
  await page.getByRole('button', { name: 'New resource' }).click()
  await page.getByLabel('Identifier').fill('urn:e2e:console-api')
  await page.getByLabel('Name').fill('Console API')
  await page.getByLabel('Audience').fill('https://api.e2e.test/console')
  await page.getByLabel('Description').fill('Console API resource')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Console API')).toBeVisible()

  await page.goto('/console/roles')
  await page.getByRole('button', { name: 'New role' }).click()
  await page.getByLabel('Key').fill('console-reader')
  await page.getByLabel('Name').fill('Console Reader')
  await page.getByLabel('Description').fill('Console read access')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Console Reader')).toBeVisible()

  await attachCoverage(testInfo, ['admin-create-organization', 'admin-create-api-resource', 'admin-create-role'])
})

test('authorization inventory detail pages load real created resources', async ({ page }, testInfo) => {
  await signIn(page)
  await createOidcApplication(page, 'Inventory Bootstrap')
  const organization = await createOrganization(page, 'Inventory Organization')
  const resource = await createApiResource(page, 'Inventory API')
  const role = await createRole(page, 'Inventory Role')

  await page.goto('/console/organizations')
  await expect(page.getByRole('link', { name: 'Inventory Organization' })).toBeVisible()
  await page.goto(`/console/organizations/${organization.id}/settings`)
  await expect(page.getByRole('heading', { name: 'Inventory Organization' })).toBeVisible()

  await page.goto('/console/api-resources')
  await expect(page.getByRole('link', { name: 'Inventory API' })).toBeVisible()
  await page.goto(`/console/api-resources/${resource.id}/settings`)
  await expect(page.getByRole('heading', { name: 'Inventory API' })).toBeVisible()

  await page.goto('/console/roles')
  await expect(page.getByRole('link', { name: 'Inventory Role' })).toBeVisible()
  await page.goto(`/console/roles/${role.id}/settings`)
  await expect(page.getByRole('heading', { name: 'Inventory Role' })).toBeVisible()

  await attachCoverage(testInfo, ['admin-authorization-inventory'])
})

test('admin connectors page creates a draft social connector and shows built-in providers', async ({ page }, testInfo) => {
  await signIn(page)
  await createOidcApplication(page, 'Connector Bootstrap')

  await page.goto('/console/connectors')
  await expect(page.getByRole('heading', { name: 'Connectors' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Email.*Built-in/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Phone \(SMS\).*Built-in/ })).toBeVisible()

  await page.getByRole('button', { name: /GitHub.*Credentials required.*Not enabled/ }).click()
  await expect(page.getByRole('heading', { name: 'GitHub' })).toBeVisible()
  await page.getByLabel('Client ID').fill('console-client')
  await page.getByLabel('Client Secret').fill('E2E_OAUTH_CLIENT_SECRET')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: /GitHub.*Credentials configured.*Not enabled/ })).toBeVisible()

  await attachCoverage(testInfo, ['admin-create-connector', 'admin-connector-inventory'])
})

test('admin hosted content settings save through the management API', async ({ page }, testInfo) => {
  await signIn(page)
  await createOidcApplication(page, 'Content Bootstrap')

  await page.goto('/console/sign-in-experience/content')
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible()
  await page.getByLabel('Product name').fill('FlareAuth E2E')
  await page.getByLabel('Sign-in message').fill('Sign in to FlareAuth E2E.')
  await page.getByLabel('Sign-up message').fill('Use a hosted account to continue.')
  const saveResponse = page.waitForResponse(
    (response) => response.url().includes('/api/management/sign-in-settings') && response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: 'Save content' }).click()
  expect((await saveResponse).status()).toBe(200)
  const settings = await page.request.get('/api/management/sign-in-settings').then((response) => response.json())
  expect(settings.copy).toMatchObject({ productName: 'FlareAuth E2E', headline: 'Sign in to FlareAuth E2E.' })

  await attachCoverage(testInfo, ['admin-content-settings'])
})
