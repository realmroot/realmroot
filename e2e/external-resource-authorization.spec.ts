import { expect, type Page, test } from '@playwright/test'
import { admin, baseURL, resetAndBootstrap, signIn, signOut } from './helpers/real-app'
import { createRestishAgentPlugin } from './helpers/restish-agent-plugin'

const externalOrigin = `http://127.0.0.1:${process.env.E2E_EXTERNAL_PORT ?? '4399'}`
const externalResource = `${externalOrigin}/api`
const nativeOrigin = `http://127.0.0.1:${process.env.E2E_NATIVE_PORT ?? '4400'}`
const realmrootResource = `${nativeOrigin}/api`

async function assignControllerScope(page: Page, resourceServerId: string) {
  const sessionResponse = await page.request.get('/api/auth/get-session')
  expect(sessionResponse.status(), await sessionResponse.text()).toBe(200)
  const session = (await sessionResponse.json()) as { user: { id: string } }
  const entitlementResponse = await page.request.post(`/api/users/${session.user.id}/permissions`, {
    data: { organizationId: null, resourceServerId, scope: 'projects:read', mode: 'persistent', expiresAt: null },
  })
  expect(entitlementResponse.status(), await entitlementResponse.text()).toBe(201)
}

async function platformOrganizationId(page: Page) {
  const response = await page.request.get('/api/organizations?limit=100&offset=0')
  expect(response.status(), await response.text()).toBe(200)
  const organizations = (await response.json()) as { items: Array<{ id: string; slug: string }> }
  const platform = organizations.items.find((organization) => organization.slug === 'realmroot')
  expect(platform).toBeDefined()
  return platform!.id
}

test.describe('external API resource authorization', () => {
  test.beforeEach(resetAndBootstrap)

  test(`[spec: agent-identity/external-resource-first-access]
        [spec: agent-identity/agent-direct-resource-access]
        [spec: agent-identity/agent-resource-revocation]
        an Agent requests first access and the controller connects a target account`, async ({ page }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)

    try {
      const enrollment = plugin.enroll('sophia', 'Sophia Lee')
      await page.goto(await enrollment.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      await enrollment.result
      const identity = plugin.whoami()

      const connectorResponse = await page.request.post('/api/connectors', {
        data: {
          providerType: 'generic_oauth',
          providerId: 'e2e-projects',
          displayName: 'E2E Projects OIDC',
          issuer: externalOrigin,
          registrationMode: 'dynamic',
          loginEnabled: false,
        },
      })
      expect(connectorResponse.status(), await connectorResponse.text()).toBe(201)
      const connector = (await connectorResponse.json()) as { id: string }
      const ownerOrganizationId = await platformOrganizationId(page)
      const resourceResponse = await page.request.post('/api/resource-servers', {
        data: {
          identifier: 'e2e-projects',
          resourceUrl: externalResource,
          accessMode: 'external_oauth',
          ownerOrganizationId,
          connectorId: connector.id,
          visibility: 'public',
        },
      })
      expect(resourceResponse.status(), await resourceResponse.text()).toBe(201)
      const resource = (await resourceResponse.json()) as { id: string }
      await assignControllerScope(page, resource.id)

      const discovered = plugin.listResourceServers<{
        items: Array<{
          id: string
          resourceUrl: string
          scopes: Array<{ value: string }>
          connection: { status: string; authorizedScopes: string[] }
        }>
      }>()
      const available = discovered.items.find((candidate) => candidate.id === resource.id)
      expect(available).toMatchObject({
        resourceUrl: externalResource,
        scopes: expect.arrayContaining([expect.objectContaining({ value: 'projects:read' })]),
        connection: { status: 'not_connected', authorizedScopes: [] },
      })

      const connectionRequest = plugin.connectResource<{ status: string }>(resource.id, {
        scopes: ['projects:read'],
        reason: 'Connect the controller project account',
      })
      await page.goto(await connectionRequest.approvalUrl)
      await expect(page.getByRole('heading', { name: 'Connect external resource' })).toBeVisible()
      await page.getByRole('button', { name: 'Connect account' }).click()
      await page.waitForURL('**/agent/resource-connection/approve**')
      await expect(page.getByRole('heading', { name: 'Account connected' })).toBeVisible()
      const connected = await connectionRequest.result
      expect(connected).toMatchObject({ status: 'connected' })

      const providerDetails = plugin.listAuthorizationDetails<{
        items: Array<{
          authorizationDetail: { type: string; [key: string]: unknown }
          accountAuthorizationStatus: string
          requestableScopes: string[]
        }>
      }>(resource.id)
      expect(providerDetails.items).toEqual([])

      const accessRequest = plugin.requestResourceAccess<{
        status: string
        credentialSource: { reference: string }
      }>({
        resourceServerId: resource.id,
        authorizationDetails: [],
        scopes: ['projects:read'],
        reason: 'List projects for the controller',
      })
      await page.goto(await accessRequest.approvalUrl)
      await expect(page.getByRole('heading', { name: 'Approve Agent resource access' })).toBeVisible()
      await page.getByRole('radio', { name: 'Persistent until revoked' }).click()
      await page.getByRole('button', { name: 'Approve exact access', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Resource access approved' })).toBeVisible()

      const approved = await accessRequest.result
      expect(approved.status).toBe('ready')
      const connectionsResponse = await page.request.get('/api/account/account-connections')
      expect(connectionsResponse.status(), await connectionsResponse.text()).toBe(200)
      const connections = (await connectionsResponse.json()) as {
        items: Array<{ apiResourceId: string; scopes: string[] }>
      }
      const connection = connections.items.find((candidate) => candidate.apiResourceId === resource.id)
      expect(connection?.scopes).toEqual(expect.arrayContaining(['projects:read']))
      expect(connection?.scopes).not.toContain('projects:write')

      plugin.connectTarget('external-projects', externalResource, 'resourceOidc', approved.credentialSource.reference)
      const directBody = plugin.targetRequest<{
        projects: Array<{ id: string; name: string }>
        authorization: {
          sub: string
          act: { iss: string; sub: string; sub_profile: string; host?: unknown }
          scope: string
        }
      }>('external-projects', 'projects')
      expect(directBody).toMatchObject({
        projects: [{ id: 'project-1', name: 'Agent-ready project' }],
        authorization: {
          sub: 'demo-user',
          act: {
            iss: expect.any(String),
            sub: expect.any(String),
            sub_profile: 'ai_agent',
          },
          scope: 'projects:read',
        },
      })
      expect(directBody.authorization.act).not.toHaveProperty('host')

      const entitlementsResponse = await page.request.get(`/api/agents/${identity.agent.id}/permissions`)
      expect(entitlementsResponse.status(), await entitlementsResponse.text()).toBe(200)
      const entitlements = (await entitlementsResponse.json()) as {
        items: Array<{ id: string; agentId: string; target: { apiResourceId: string } }>
      }
      const entitlement = entitlements.items.find((candidate) => candidate.target.apiResourceId === resource.id)
      expect(entitlement).toBeDefined()
      const revoked = await page.request.delete(`/api/agents/${entitlement!.agentId}/permissions/${entitlement!.id}`)
      expect(revoked.status()).toBe(204)
      const afterRevocation = await page.request.get(`/api/agents/${identity.agent.id}/permissions`)
      expect(afterRevocation.status(), await afterRevocation.text()).toBe(200)
      expect((await afterRevocation.json()) as { items: Array<{ id: string }> }).toMatchObject({ items: [] })
    } finally {
      plugin.dispose()
    }
  })

  test(`[spec: agent-identity/native-api-resource-token]
        [spec: agent-identity/agent-resource-approval-sign-in]
        an Agent calls an API that uses Realmroot for identity and authorization`, async ({ page }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)

    try {
      const enrollment = plugin.enroll('ethan', 'Ethan Martin')
      await page.goto(await enrollment.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      await enrollment.result
      const _identity = plugin.whoami()
      const ownerOrganizationId = await platformOrganizationId(page)

      const resourceResponse = await page.request.post('/api/resource-servers', {
        data: {
          identifier: 'e2e-realmroot-projects',
          resourceUrl: realmrootResource,
          accessMode: 'realmroot',
          ownerOrganizationId,
          visibility: 'public',
        },
      })
      expect(resourceResponse.status(), await resourceResponse.text()).toBe(201)
      const resource = (await resourceResponse.json()) as { id: string }
      await assignControllerScope(page, resource.id)

      const discovered = plugin.listResourceServers<{
        items: Array<{
          id: string
          resourceUrl: string
          scopes: Array<{ value: string }>
          connection: { status: string }
        }>
      }>()
      expect(discovered.items).toContainEqual(
        expect.objectContaining({
          id: resource.id,
          resourceUrl: realmrootResource,
          scopes: expect.arrayContaining([expect.objectContaining({ value: 'projects:read' })]),
          connection: { status: 'not_required', displayName: null, authorizedScopes: [] },
        }),
      )

      const providerDetails = plugin.listAuthorizationDetails<{
        items: Array<{ authorizationDetail: { type: string } }>
      }>(resource.id)
      expect(providerDetails.items).toHaveLength(0)

      const accessRequest = plugin.requestResourceAccess<{
        status: string
        credentialSource: { reference: string }
      }>({
        resourceServerId: resource.id,
        authorizationDetails: [],
        scopes: ['projects:read'],
        reason: 'List projects for the controller',
      })
      await page.goto('/profile')
      await signOut(page)
      await page.goto(await accessRequest.approvalUrl)
      await expect(page).toHaveURL(/\/auth\/sign-in\?return_key=/)
      expect(page.url()).not.toContain('token=')
      await page.getByRole('textbox', { name: 'Email or username' }).fill(admin.username)
      await page.getByRole('textbox', { name: 'Password' }).fill(admin.password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('heading', { name: 'Approve Agent resource access' })).toBeVisible()
      await expect(page.getByText('Resource account')).toHaveCount(0)
      await page.getByRole('button', { name: 'Approve exact access' }).click()
      await expect(page.getByRole('heading', { name: 'Resource access approved' })).toBeVisible()

      const approved = await accessRequest.result
      expect(approved.status).toBe('ready')

      plugin.connectTarget('native-projects', realmrootResource, 'realmrootOidc', approved.credentialSource.reference)
      expect(plugin.targetRequest('native-projects', 'projects')).toMatchObject({
        projects: [{ id: 'project-1', name: 'Realmroot-native project' }],
        authorization: {
          sub: expect.any(String),
          act: {
            iss: expect.any(String),
            sub: expect.any(String),
            sub_profile: 'ai_agent',
          },
          scope: 'projects:read',
        },
      })
    } finally {
      plugin.dispose()
    }
  })
})
