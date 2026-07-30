import { expect, type Page, test } from '@playwright/test'
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

      const resourceResponse = await page.request.post('/api/api-resources', {
        data: {
          identifier: 'e2e-projects',
          name: 'E2E Projects API',
          resourceUrl: externalResource,
          authorizationMode: 'external',
          authorization: { registrationMode: 'dynamic' },
        },
      })
      expect(resourceResponse.status(), await resourceResponse.text()).toBe(201)
      const resource = (await resourceResponse.json()) as { id: string }
      await grantAgentResourceScope(page, resource.id, identity.agent.id, 'e2e-projects-reader')

      const discovered = plugin.listAgentApiResources<{
        items: Array<{
          id: string
          resourceUrl: string
          scopes: Array<{ value: string }>
          accountConnections: Array<{ id: string; scopes: string[] }>
        }>
      }>()
      const available = discovered.items.find((candidate) => candidate.id === resource.id)
      expect(available).toMatchObject({
        resourceUrl: externalResource,
        scopes: expect.arrayContaining([expect.objectContaining({ value: 'projects:read' })]),
        accountConnections: [],
      })

      const accessRequest = plugin.requestResourceAccess<{ status: string; grantId: string }>({
        target: { type: 'api-resource', apiResourceId: resource.id },
        scopes: ['projects:read'],
        reason: 'List projects for the controller',
      })
      await page.goto(await accessRequest.approvalUrl)
      await expect(page.getByRole('heading', { name: 'Approve Agent resource access' })).toBeVisible()
      await expect(page.getByText('No connected account covers these exact scopes.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Approve exact access' })).toBeDisabled()
      await page.getByRole('button', { name: 'Connect a new E2E Projects API account' }).click()
      await page.waitForURL('**/agent/resource-access/approve?accountConnectionId=*')
      await expect(page.getByRole('heading', { name: 'Approve Agent resource access' })).toBeVisible()
      await expect(page.getByRole('radio', { name: /Demo Project Owner/ })).toBeChecked()
      await page.getByRole('button', { name: 'Approve exact access' }).click()
      await expect(page.getByRole('heading', { name: 'Resource access approved' })).toBeVisible()

      const approved = await accessRequest.result
      expect(approved.status).toBe('approved')

      const lease = plugin.issueTargetAccessToken(approved.grantId)
      expect(lease).toMatchObject({ tokenType: 'DPoP', scopes: ['projects:read'] })
      expect(lease).not.toHaveProperty('accessToken')

      plugin.connectTarget('external-projects', externalResource)
      const directBody = plugin.targetRequest<{
        projects: Array<{ id: string; name: string }>
        authorization: { sub: string; act: { sub: string; host?: unknown }; scope: string }
      }>('external-projects', 'projects')
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
      expect(() => plugin.targetRequest('external-projects', 'projects')).toThrow()
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
      const identity = await whoami.result

      const resourceResponse = await page.request.post('/api/api-resources', {
        data: {
          identifier: 'e2e-realmroot-projects',
          name: 'E2E Realmroot Projects API',
          resourceUrl: realmrootResource,
          authorizationMode: 'native',
        },
      })
      expect(resourceResponse.status(), await resourceResponse.text()).toBe(201)
      const resource = (await resourceResponse.json()) as { id: string }
      await grantAgentResourceScope(page, resource.id, identity.agent.id, 'e2e-realmroot-projects-reader')

      const discovered = plugin.listAgentApiResources<{
        items: Array<{
          id: string
          authorizationMode: string
          resourceUrl: string
          scopes: Array<{ value: string }>
          accountConnections: Array<{ id: string }>
        }>
      }>()
      expect(discovered.items).toContainEqual(
        expect.objectContaining({
          id: resource.id,
          authorizationMode: 'native',
          resourceUrl: realmrootResource,
          scopes: expect.arrayContaining([expect.objectContaining({ value: 'projects:read' })]),
          accountConnections: [],
        }),
      )

      const accessRequest = plugin.requestResourceAccess<{ status: string; grantId: string }>({
        target: { type: 'api-resource', apiResourceId: resource.id },
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
      expect(approved.status).toBe('approved')

      const lease = plugin.issueTargetAccessToken(approved.grantId)
      expect(lease).toMatchObject({ tokenType: 'DPoP', scopes: ['projects:read'] })
      expect(lease).not.toHaveProperty('accessToken')

      plugin.connectTarget('native-projects', realmrootResource)
      expect(plugin.targetRequest('native-projects', 'projects')).toMatchObject({
        projects: [{ id: 'project-1', name: 'Realmroot-native project' }],
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

async function grantAgentResourceScope(page: Page, resourceId: string, agentIdentityId: string, key: string) {
  const roleResponse = await page.request.post('/api/roles', {
    data: { key, name: 'Projects reader', resourceId },
  })
  expect(roleResponse.status(), await roleResponse.text()).toBe(201)
  const role = (await roleResponse.json()) as { id: string }

  const scopesResponse = await page.request.put(`/api/roles/${role.id}/scopes`, {
    data: { scopes: ['projects:read'] },
  })
  expect(scopesResponse.status(), await scopesResponse.text()).toBe(204)

  const assignmentResponse = await page.request.post('/api/roles/assignments/agents', {
    data: { roleId: role.id, subjectId: agentIdentityId },
  })
  expect(assignmentResponse.status(), await assignmentResponse.text()).toBe(204)
}
