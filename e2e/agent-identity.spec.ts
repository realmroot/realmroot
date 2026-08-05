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
      const whoami = plugin.firstWhoami('E2E Build Agent')
      await page.goto(await whoami.approvalUrl)
      await expect(page.getByRole('heading', { name: 'Approve Agent login' })).toBeVisible()
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      await expect(page.getByText('You can safely close this page.')).toBeVisible()

      const result = await whoami.result
      expect(result.agent).toMatchObject({
        issuer: `${baseURL}/api/auth`,
        name: 'E2E Build Agent',
      })
      expect(result.agent.subject).toMatch(/^agt_/)
      expect(plugin.whoami().agent).toMatchObject({
        issuer: result.agent.issuer,
        subject: result.agent.subject,
      })

      await page.goto('/agents')
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
      const whoami = deniedEnrollmentPlugin.firstWhoami('Denied Enrollment Agent')
      const enrollmentResult = whoami.result.catch((error: unknown) => error)
      await page.goto(await whoami.approvalUrl)
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
})
