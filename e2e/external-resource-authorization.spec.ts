import { expect, test } from '@playwright/test'
import { baseURL, resetAndBootstrap, signIn } from './helpers/real-app'
import { createRestishAgentPlugin } from './helpers/restish-agent-plugin'

const externalOrigin = `http://127.0.0.1:${process.env.E2E_EXTERNAL_PORT ?? '4399'}`
const externalResource = `${externalOrigin}/api`
const flareauthResource = `${externalOrigin}/flareauth-api`

test.describe('external API resource authorization', () => {
  test.beforeEach(resetAndBootstrap)

  test(`[spec: agent-identity/resource-account-connection]
        [spec: agent-identity/agent-direct-resource-access]
        [spec: agent-identity/agent-resource-revocation]
        a controller connects a target account and an Agent calls the target directly`, async ({ page }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)

    try {
      const whoami = plugin.firstWhoami('External Resource E2E Agent')
      await page.goto(await whoami.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      await whoami.result

      const resourceResponse = await page.request.post('/api/management/api-resources', {
        data: {
          identifier: 'e2e-projects',
          name: 'E2E Projects API',
          audience: externalResource,
          resourceUrl: externalResource,
          authorizationMode: 'external',
          authorization: { registrationMode: 'dynamic' },
        },
      })
      expect(resourceResponse.status(), await resourceResponse.text()).toBe(201)
      const resource = (await resourceResponse.json()) as { id: string }
      for (const scope of ['projects:read', 'projects:write']) {
        const created = await page.request.post(`/api/management/api-resources/${resource.id}/scopes`, {
          data: { value: scope, description: scope === 'projects:read' ? 'Read projects' : 'Write projects' },
        })
        expect(created.status(), await created.text()).toBe(201)
      }
      const intentResponse = await page.request.post('/api/account/account-connections', {
        data: {
          apiResourceId: resource.id,
          owner: { type: 'user' },
          permissions: ['projects:read', 'projects:write'],
        },
      })
      expect(intentResponse.status(), await intentResponse.text()).toBe(201)
      const intent = (await intentResponse.json()) as { authorizationUrl: string }
      await page.goto(intent.authorizationUrl)
      await page.waitForURL('**/connections?resource_connection=connected')

      const discovered = await plugin.agentRequest<{
        items: Array<{ id: string; accountConnections: Array<{ id: string }> }>
      }>('/api/agent/api-resources')
      const available = discovered.items.find((candidate) => candidate.id === resource.id)
      expect(available?.accountConnections).toHaveLength(1)
      const connectionId = available!.accountConnections[0]!.id

      const accessRequest = await plugin.agentRequest<{
        id: string
        approval: { url: string }
      }>('/api/agent/access-requests', {
        method: 'POST',
        body: JSON.stringify({
          target: { type: 'api-resource', apiResourceId: resource.id, accountConnectionId: connectionId },
          permissions: ['projects:read'],
          reason: 'List projects for the controller',
        }),
      })
      await page.goto(accessRequest.approval.url)
      await expect(page.getByRole('heading', { name: 'Approve Agent resource access' })).toBeVisible()
      await page.getByRole('button', { name: 'Approve exact access' }).click()
      await expect(page.getByRole('heading', { name: 'Resource access approved' })).toBeVisible()

      const approved = await plugin.agentRequest<{ status: string; grantId: string }>(
        `/api/agent/access-requests/${accessRequest.id}`,
      )
      expect(approved.status).toBe('approved')

      const lease = plugin.issueTargetAccessToken(approved.grantId)
      expect(lease).toMatchObject({ tokenType: 'DPoP', permissions: ['projects:read'] })

      plugin.connectTarget('external-projects', externalResource)
      const directBody = plugin.targetRequest<{
        projects: Array<{ id: string; name: string }>
        authorization: { sub: string; act: { sub: string; host?: unknown }; scope: string }
      }>('external-projects', 'list-projects')
      expect(directBody).toMatchObject({
        projects: [{ id: 'project-1', name: 'Agent-ready project' }],
        authorization: {
          sub: 'demo-user',
          act: { sub: expect.any(String) },
          scope: 'projects:read',
        },
      })
      expect(directBody.authorization.act).not.toHaveProperty('host')

      const revoked = await page.request.delete(`/api/account/access-grants/${approved.grantId}`)
      expect(revoked.status()).toBe(204)
      expect(() => plugin.targetRequest('external-projects', 'list-projects')).toThrow()
    } finally {
      plugin.dispose()
    }
  })

  test(`[spec: agent-identity/native-api-resource-token]
        an Agent calls an API that uses FlareAuth for identity and authorization`, async ({ page }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)

    try {
      const whoami = plugin.firstWhoami('FlareAuth Resource E2E Agent')
      await page.goto(await whoami.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      await whoami.result

      const resourceResponse = await page.request.post('/api/management/api-resources', {
        data: {
          identifier: 'e2e-flareauth-projects',
          name: 'E2E FlareAuth Projects API',
          audience: flareauthResource,
          resourceUrl: flareauthResource,
          authorizationMode: 'native',
        },
      })
      expect(resourceResponse.status(), await resourceResponse.text()).toBe(201)
      const resource = (await resourceResponse.json()) as { id: string }
      const scopeResponse = await page.request.post(`/api/management/api-resources/${resource.id}/scopes`, {
        data: { value: 'projects:read', description: 'Read projects' },
      })
      expect(scopeResponse.status(), await scopeResponse.text()).toBe(201)

      const discovered = await plugin.agentRequest<{
        items: Array<{
          id: string
          authorizationMode: string
          accountConnections: Array<{ id: string }>
        }>
      }>('/api/agent/api-resources')
      expect(discovered.items).toContainEqual(
        expect.objectContaining({
          id: resource.id,
          authorizationMode: 'native',
          accountConnections: [],
        }),
      )

      const accessRequest = await plugin.agentRequest<{
        id: string
        approval: { url: string }
      }>('/api/agent/access-requests', {
        method: 'POST',
        body: JSON.stringify({
          target: { type: 'api-resource', apiResourceId: resource.id },
          permissions: ['projects:read'],
          reason: 'List projects for the controller',
        }),
      })
      await page.goto(accessRequest.approval.url)
      await expect(page.getByRole('heading', { name: 'Approve Agent resource access' })).toBeVisible()
      await expect(page.getByText('Resource account')).toHaveCount(0)
      await page.getByRole('button', { name: 'Approve exact access' }).click()
      await expect(page.getByRole('heading', { name: 'Resource access approved' })).toBeVisible()

      const approved = await plugin.agentRequest<{ status: string; grantId: string }>(
        `/api/agent/access-requests/${accessRequest.id}`,
      )
      expect(approved.status).toBe('approved')

      const lease = plugin.issueTargetAccessToken(approved.grantId)
      expect(lease).toMatchObject({ tokenType: 'DPoP', permissions: ['projects:read'] })

      plugin.connectTarget('native-projects', flareauthResource)
      expect(plugin.targetRequest('native-projects', 'list-projects')).toMatchObject({
        projects: [{ id: 'project-1', name: 'FlareAuth-native project' }],
        authorization: {
          sub: expect.any(String),
          act: {
            actor_type: 'host',
            act: { actor_type: 'agent', sub: expect.any(String) },
          },
          scope: 'projects:read',
        },
      })
    } finally {
      plugin.dispose()
    }
  })
})
