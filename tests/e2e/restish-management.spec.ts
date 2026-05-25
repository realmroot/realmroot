import { expect, test } from '@playwright/test'
import { admin, attachCoverage, baseURL, resetAndBootstrap } from './helpers/real-app'
import { createRestishHome, removeRestishHome, restish, restishInstalled, startRestishAuthHeader } from './helpers/restish'

test.describe.configure({ mode: 'serial' })

test.skip(!(await restishInstalled()), 'restish CLI is required for Management CLI E2E')

test('Restish OAuth token can manage Management API resources', async ({ page }, testInfo) => {
  test.setTimeout(60_000)

  await resetAndBootstrap()

  const restishHome = await createRestishHome(`${baseURL}/api/management`)
  try {
    const contractResponse = await page.request.get('/api/management/openapi.json')
    expect(contractResponse.status(), await contractResponse.text()).toBe(200)
    await expect(contractResponse.json()).resolves.toMatchObject({
      openapi: '3.1.0',
      'x-cli-config': {
        params: {
          client_id: 'flareauth-cli',
        },
      },
    })

    const discoveryResponse = await page.request.get('/api/management/readiness')
    expect(discoveryResponse.headers()['link']).toContain('/api/management/openapi.json')

    await restish(['api', 'sync', 'flareauth-local'], restishHome)

    const auth = await startRestishAuthHeader(restishHome)
    const authorizeUrl = new URL(auth.authorizeUrl)
    expect(authorizeUrl.searchParams.get('client_id')).toBe('flareauth-cli')
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('http://localhost:8484/callback')
    await page.goto(auth.authorizeUrl)
    await page.getByRole('textbox', { name: 'Email or username' }).fill(admin.username)
    await page.getByRole('textbox', { name: 'Password' }).fill(admin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Review application access.' })).toBeVisible()
    await expect(page.getByText('FlareAuth CLI')).toBeVisible()
    await page.getByRole('button', { name: 'Approve access' }).click()

    const authorization = await auth.authHeader()
    const headers = ['-H', `Authorization: ${authorization}`, '-H', 'Content-Type: application/json']
    const authHeader = ['-H', `Authorization: ${authorization}`]
    const stamp = Date.now()
    const appSlug = `restish-e2e-${stamp}`

    const created = await restishJson(restishHome, ['create-application', ...headers], {
      name: 'Restish E2E Application',
      slug: appSlug,
      clientType: 'public_spa',
      redirectUris: [`${baseURL}/oidc/callback`],
      postLogoutRedirectUris: [`${baseURL}/signed-out`],
      corsOrigins: [baseURL],
      firstParty: true,
      trusted: true,
    })
    expect(created).toMatchObject({
      slug: appSlug,
      name: 'Restish E2E Application',
      postLogoutRedirectUris: [`${baseURL}/signed-out`],
      corsOrigins: [baseURL],
    })
    expect(created.clientId).toEqual(expect.any(String))
    expect(created.clientSecret).toBeUndefined()

    const updated = await restishJson(restishHome, ['update-application', created.id, ...headers], {
      name: 'Restish E2E Application Updated',
    })
    expect(updated).toMatchObject({ id: created.id, name: 'Restish E2E Application Updated' })

    const listed = await restishJson(restishHome, ['list-applications', ...authHeader])
    expect(listed.applications).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]))

    await restish(['flareauth-local', 'delete-application', created.id, ...authHeader], restishHome)

    const deleted = await page.request.get(`/api/management/applications/${created.id}`)
    expect(deleted.status()).toBe(404)

    const readiness = await restishJson(restishHome, ['get-readiness', ...authHeader])
    expect(readiness.admin).toEqual(expect.objectContaining({ setupRequired: expect.any(Boolean) }))

    const signInSettings = await restishJson(restishHome, ['get-sign-in-settings', ...authHeader])
    expect(signInSettings.signIn).toEqual(expect.any(Object))

    const connectorSlug = `${appSlug}-connector`
    const createdConnector = await restishJson(restishHome, ['create-connector', ...headers], {
      slug: connectorSlug,
      providerType: 'generic_oauth',
      providerId: `restish-e2e-${stamp}`,
      displayName: 'Restish E2E Connector',
      enabled: false,
    })
    expect(createdConnector).toMatchObject({ slug: connectorSlug, displayName: 'Restish E2E Connector' })

    await restish(['flareauth-local', 'delete-connector', createdConnector.id, ...authHeader], restishHome)
    const deletedConnector = await page.request.get(`/api/management/connectors/${createdConnector.id}`)
    expect(deletedConnector.status()).toBe(404)

    const user = await restishJson(restishHome, ['create-user', ...headers], {
      email: `restish-user-${stamp}@example.com`,
      username: `restishuser${stamp}`,
      displayName: 'Restish User',
      password: 'RestishUser2026!',
      role: 'user',
    })
    const userId = user.id ?? user.user?.id
    expect(userId).toEqual(expect.any(String))
    const updatedUser = await restishJson(restishHome, ['update-user', userId, ...headers], {
      displayName: 'Restish User Updated',
    })
    expect(updatedUser.user ?? updatedUser).toMatchObject({ id: userId })
    const listedUsers = await restishJson(restishHome, ['list-users', ...authHeader])
    expect(listedUsers.users).toEqual(expect.arrayContaining([expect.objectContaining({ id: userId })]))

    const organization = await restishJson(restishHome, ['create-organization', ...headers], {
      slug: `restish-org-${stamp}`,
      name: 'Restish Organization',
      displayName: 'Restish Org',
    })
    expect(organization).toMatchObject({ slug: `restish-org-${stamp}` })
    const updatedOrganization = await restishJson(restishHome, ['update-organization', organization.id, ...headers], {
      displayName: 'Restish Org Updated',
    })
    expect(updatedOrganization).toMatchObject({ id: organization.id, displayName: 'Restish Org Updated' })

    const role = await restishJson(restishHome, ['create-role', ...headers], {
      key: `restish-role-${stamp}`,
      name: 'Restish Role',
      description: 'Created by Restish E2E',
    })
    expect(role).toMatchObject({ key: `restish-role-${stamp}` })
    const updatedRole = await restishJson(restishHome, ['update-role', role.id, ...headers], {
      name: 'Restish Role Updated',
    })
    expect(updatedRole).toMatchObject({ id: role.id, name: 'Restish Role Updated' })
    const rolePermissions = await restishJson(restishHome, ['list-role-permissions', role.id, ...authHeader])
    expect(rolePermissions.permissions).toEqual([])

    const apiResource = await restishJson(restishHome, ['create-api-resource', ...headers], {
      identifier: `urn:restish:${stamp}`,
      name: 'Restish API',
      audience: `https://api.example.com/restish/${stamp}`,
      description: 'Created by Restish E2E',
    })
    expect(apiResource).toMatchObject({ identifier: `urn:restish:${stamp}` })
    const scope = await restishJson(restishHome, ['create-api-resource-scope', apiResource.id, ...headers], {
      value: 'items:read',
      description: 'Read items',
      includeInAccessToken: true,
      includeInIdToken: false,
    })
    expect(scope).toMatchObject({ resourceId: apiResource.id, value: 'items:read' })
    const permission = await restishJson(restishHome, ['create-api-resource-permission', apiResource.id, ...headers], {
      scopeId: scope.id,
      key: 'items.read',
      description: 'Read items',
    })
    expect(permission).toMatchObject({ resourceId: apiResource.id, key: 'items.read' })

    const webhook = await restishJson(restishHome, ['create-webhook-endpoint', ...headers], {
      url: `https://example.com/webhooks/restish-${stamp}`,
      events: ['user.created', 'application.created'],
      enabled: false,
    })
    expect(webhook.endpoint).toMatchObject({ url: `https://example.com/webhooks/restish-${stamp}` })
    expect(webhook.signingSecret).toEqual(expect.any(String))
    const updatedWebhook = await restishJson(restishHome, ['update-webhook-endpoint', webhook.endpoint.id, ...headers], {
      enabled: true,
    })
    expect(updatedWebhook).toMatchObject({ id: webhook.endpoint.id, enabled: true })
    const rotatedWebhook = await restishJson(restishHome, [
      'rotate-webhook-endpoint-secret',
      webhook.endpoint.id,
      ...authHeader,
    ])
    expect(rotatedWebhook.signingSecret).toEqual(expect.any(String))

    const branding = await restishJson(restishHome, ['update-branding-settings', ...headers], {
      branding: { primaryColor: '#2255aa' },
    })
    expect(branding.branding).toMatchObject({ primaryColor: '#2255aa' })
    const accountCenter = await restishJson(restishHome, ['update-account-center-settings', ...headers], {
      accountCenter: { sessionsViewEnabled: false },
    })
    expect(accountCenter.accountCenter).toMatchObject({ sessionsViewEnabled: false })
    const security = await restishJson(restishHome, ['update-security-policy', ...headers], {
      policy: { mfa: { mode: 'optional' } },
    })
    expect(security.policy.mfa).toMatchObject({ mode: 'optional' })

    await restish(['flareauth-local', 'delete-webhook-endpoint', webhook.endpoint.id, ...authHeader], restishHome)
    await restish(
      ['flareauth-local', 'delete-api-resource-permission', apiResource.id, permission.id, ...authHeader],
      restishHome,
    )
    await restish(['flareauth-local', 'delete-api-resource-scope', apiResource.id, scope.id, ...authHeader], restishHome)
    await restish(['flareauth-local', 'delete-api-resource', apiResource.id, ...authHeader], restishHome)
    await restish(['flareauth-local', 'delete-role', role.id, ...authHeader], restishHome)
    await restish(['flareauth-local', 'delete-organization', organization.id, ...authHeader], restishHome)
    await restish(['flareauth-local', 'delete-user', userId, ...authHeader], restishHome)

    expect((await page.request.get(`/api/management/webhooks/endpoints/${webhook.endpoint.id}`)).status()).toBe(404)
    expect((await page.request.get(`/api/management/organizations/${organization.id}`)).status()).toBe(404)
    expect((await page.request.get(`/api/management/roles/${role.id}`)).status()).toBe(404)
    expect((await page.request.get(`/api/management/api-resources/${apiResource.id}`)).status()).toBe(404)
    expect((await page.request.get(`/api/management/users/${userId}`)).status()).toBe(404)

    await attachCoverage(testInfo, [
      'management-openapi-discovery',
      'management-restish-oauth-auth',
      'management-restish-oauth-crud',
    ])
  } finally {
    await removeRestishHome(restishHome)
  }
})

async function restishJson(restishHome: Awaited<ReturnType<typeof createRestishHome>>, args: string[], input?: unknown) {
  return JSON.parse(await restish(['flareauth-local', ...args, '-o', 'json'], restishHome, input)) as Record<string, any>
}
