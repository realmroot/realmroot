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
      const login = plugin.login('E2E Build Agent')
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
      expect(plugin.whoami().agent).toMatchObject({
        issuer: result.agent.issuer,
        subject: result.agent.subject,
      })
      expect(plugin.status().hosts[0]?.accounts).toContainEqual(
        expect.objectContaining({ runtime: 'e2e', current: true, loggedIn: true }),
      )

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
      const login = deniedEnrollmentPlugin.login('Denied Enrollment Agent')
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

  test('[spec: agent-identity/restish-agent-auth-accounts] logout and login restore the same stable identity', async ({
    page,
  }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)
    try {
      const first = plugin.login('E2E Persistent Agent')
      await page.goto(await first.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      const original = await first.result

      expect(plugin.logout()).toMatchObject({ loggedIn: false, remoteIdentityChanged: false })
      expect(() => plugin.whoami()).toThrow(/not logged in/i)

      const restored = plugin.login('E2E Persistent Agent')
      await page.goto(await restored.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await page.goto(await restored.nextApprovalUrl())
      await expect(page.getByRole('heading', { name: 'Add trusted host' })).toBeVisible()
      await page.getByRole('button', { name: 'Add trusted host' }).click()
      const result = await restored.result
      expect(result.agent).toMatchObject({ id: original.agent.id, subject: original.agent.subject })
    } finally {
      plugin.dispose()
    }
  })
})
