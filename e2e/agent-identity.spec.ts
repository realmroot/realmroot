import { expect, test } from '@playwright/test'
import { baseURL, resetAndBootstrap, signIn } from './helpers/real-app'
import { createRestishAgentPlugin } from './helpers/restish-agent-plugin'

// Hermetic: the repository's Restish plugin generates independent keys, uses
// the published AgentAuth protocol through Restish HTTP delegation, receives
// controller approvals through the real SPA, and reads the stable identity.
// No D1 seeding is used for the Agent, host, intent, identity, or binding.
test.describe('new Agent stable identity enrollment', () => {
  test.beforeEach(async () => {
    await resetAndBootstrap()
  })

  test('[spec: agent-identity/agent-identity-enrollment] a new Agent establishes its stable identity', async ({
    page,
  }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)

    try {
      const login = plugin.firstLogin('E2E Build Agent')
      await page.goto(await login.approvalUrl)
      await expect(page.getByRole('heading', { name: 'Approve Agent login' })).toBeVisible()
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      await expect(page.getByText('You can safely close this page.')).toBeVisible()

      const result = await login.result
      expect(result.agent).toMatchObject({
        issuer: `${baseURL}/api/auth`,
        name: 'E2E Build Agent',
      })
      expect(result.agent.subject).toMatch(/^agt_/)
      expect(plugin.status().agent).toMatchObject({
        issuer: result.agent.issuer,
        subject: result.agent.subject,
      })

      await page.goto('/account/agents')
      await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
      await expect(page.getByText('E2E Build Agent', { exact: true })).toBeVisible()
      await expect(page.getByText(new RegExp(result.agent.subject))).toBeVisible()
    } finally {
      plugin.dispose()
    }
  })

  test('[spec: agent-identity/agent-enrollment-denial] a controller can deny Agent enrollment', async ({ page }) => {
    await signIn(page)

    const deniedEnrollmentPlugin = createRestishAgentPlugin(baseURL)
    try {
      const login = deniedEnrollmentPlugin.firstLogin('Denied Enrollment Agent')
      const enrollmentResult = login.result.catch((error: unknown) => error)
      await page.goto(await login.approvalUrl)
      await page.getByRole('button', { name: 'Deny' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization denied' })).toBeVisible()
      await expect(page.getByText('You can safely close this page.')).toBeVisible()
      await expect(enrollmentResult).resolves.toMatchObject({
        message: expect.stringContaining('Agent enrollment was rejected'),
      })
    } finally {
      deniedEnrollmentPlugin.dispose()
    }
  })

  test(`[spec: agent-identity/restish-agent-recovery]
        [spec: agent-identity/restish-agent-retirement]
        a controller recovers and permanently retires one stable Agent`, async ({ page }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)

    try {
      const login = plugin.firstLogin('E2E Lifecycle Agent')
      await page.goto(await login.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      const initial = await login.result

      const recovery = plugin.recover()
      await page.goto(await recovery.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await page.goto(await recovery.nextApprovalUrl())
      await expect(page.getByRole('heading', { name: 'Recover Agent identity' })).toBeVisible()
      await expect(page.getByText(/every previous installation should be revoked/i)).toBeVisible()
      await expect(page.getByText(/external Resource access frozen/i)).toBeVisible()
      await page.getByRole('button', { name: 'Recover Agent' }).click()
      const recovered = await recovery.result
      expect(recovered.agent).toMatchObject({
        id: initial.agent.id,
        issuer: initial.agent.issuer,
        subject: initial.agent.subject,
      })

      const inventory = plugin.listAuth<{
        installations: Array<{ id: string; status: string }>
      }>()
      expect(inventory.installations.filter((installation) => installation.status === 'active')).toHaveLength(1)
      expect(inventory.installations.some((installation) => installation.status === 'revoked')).toBe(true)

      expect(plugin.retire(initial.agent.subject)).toMatchObject({
        agentId: initial.agent.id,
        status: 'retired',
        localState: 'removed',
      })
      const accountAgents = await page.request.get('/api/account/agents')
      expect(accountAgents.status()).toBe(200)
      expect(await accountAgents.json()).toMatchObject({
        items: [expect.objectContaining({ id: initial.agent.id, status: 'retired' })],
      })
    } finally {
      plugin.dispose()
    }
  })
})
