import { expect, test } from '@playwright/test'
import { admin, baseURL, resetAndBootstrap, signIn, signOut } from './helpers/real-app'
import { createRestishAgentPlugin } from './helpers/restish-agent-plugin'

const externalOrigin = `http://127.0.0.1:${process.env.E2E_EXTERNAL_PORT ?? '4399'}`
const externalResource = `${externalOrigin}/api`
const nativeOrigin = `http://127.0.0.1:${process.env.E2E_NATIVE_PORT ?? '4400'}`
const realmrootResource = `${nativeOrigin}/api`

test.describe('external API resource authorization', () => {
  test.beforeEach(resetAndBootstrap)

  test(`[spec: agent-identity/external-resource-first-access]
        [spec: agent-identity/agent-direct-resource-access]
        [spec: agent-identity/agent-resource-revocation]
        an Agent requests first access and the controller connects a target account`, async ({ page }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)

    try {
      const whoami = plugin.firstWhoami('External Resource E2E Agent')
      await page.goto(await whoami.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      const identity = await whoami.result

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
      const resourceResponse = await page.request.post('/api/resource-servers', {
        data: {
          identifier: 'e2e-projects',
          name: 'E2E Projects API',
          resourceUrl: externalResource,
          connectorId: connector.id,
        },
      })
      expect(resourceResponse.status(), await resourceResponse.text()).toBe(201)
      const resource = (await resourceResponse.json()) as { id: string }

      const discovered = plugin.listResourceServers<{
        items: Array<{
          id: string
          serviceUrl: string
          scopes: Array<{ value: string }>
          connection: { status: string; authorizedScopes: string[] }
        }>
      }>()
      const available = discovered.items.find((candidate) => candidate.id === resource.id)
      expect(available).toMatchObject({
        serviceUrl: externalResource,
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

      const providerResources = plugin.listResources<{
        items: Array<{
          links: { self: string }
          accountAuthorization: { status: string }
          agentAuthorization: { requestableScopes: string[] }
        }>
      }>(resource.id)
      const providerResource = providerResources.items.find((candidate) =>
        candidate.agentAuthorization.requestableScopes.includes('projects:read'),
      )
      expect(providerResource, JSON.stringify(providerResources.items, null, 2)).toMatchObject({
        accountAuthorization: { status: 'authorized' },
      })

      const accessRequest = plugin.requestResourceAccess<{ status: string }>({
        resource: { href: providerResource!.links.self },
        scopes: ['projects:read'],
        reason: 'List projects for the controller',
      })
      await page.goto(await accessRequest.approvalUrl)
      await expect(page.getByRole('heading', { name: 'Approve Agent resource access' })).toBeVisible()
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

      plugin.connectTarget('external-projects', externalResource)
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

      const grantsResponse = await page.request.get(`/api/access/authorizations?agentId=${identity.agent.id}`)
      expect(grantsResponse.status(), await grantsResponse.text()).toBe(200)
      const grants = (await grantsResponse.json()) as {
        items: Array<{ id: string; resource: { id: string } }>
      }
      const grant = grants.items.find((candidate) => candidate.resource.id === resource.id)
      expect(grant).toBeDefined()
      const revoked = await page.request.delete(`/api/account/access-grants/${grant!.id}`)
      expect(revoked.status()).toBe(204)
      const afterRevocation = plugin.listResources<{
        items: Array<{ links: { self: string }; agentAuthorization: { authorizedScopes: string[] } }>
      }>(resource.id)
      expect(
        afterRevocation.items.find((candidate) => candidate.links.self === providerResource!.links.self),
      ).toMatchObject({ agentAuthorization: { authorizedScopes: [] } })
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
      const whoami = plugin.firstWhoami('Realmroot Resource E2E Agent')
      await page.goto(await whoami.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      const _identity = await whoami.result

      const resourceResponse = await page.request.post('/api/resource-servers', {
        data: {
          identifier: 'e2e-realmroot-projects',
          name: 'E2E Realmroot Projects API',
          resourceUrl: realmrootResource,
        },
      })
      expect(resourceResponse.status(), await resourceResponse.text()).toBe(201)
      const resource = (await resourceResponse.json()) as { id: string }

      const discovered = plugin.listResourceServers<{
        items: Array<{
          id: string
          serviceUrl: string
          scopes: Array<{ value: string }>
          connection: { status: string }
        }>
      }>()
      expect(discovered.items).toContainEqual(
        expect.objectContaining({
          id: resource.id,
          serviceUrl: realmrootResource,
          scopes: expect.arrayContaining([expect.objectContaining({ value: 'projects:read' })]),
          connection: { status: 'not_required', displayName: null, authorizedScopes: [] },
        }),
      )

      const providerResources = plugin.listResources<{
        items: Array<{ links: { self: string }; type: string }>
      }>(resource.id)
      expect(providerResources.items).toHaveLength(1)

      const accessRequest = plugin.requestResourceAccess<{ status: string }>({
        resource: { href: providerResources.items[0]!.links.self },
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

      plugin.connectTarget('native-projects', realmrootResource)
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
