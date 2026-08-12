import { expect, test } from '@playwright/test'
import { uuidV7Pattern } from '../shared/api/identifiers'
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

  test('[spec: agent-identity/agent-identity-enrollment] [spec: management-api/management-restish-agent-auth] a new Agent establishes its stable identity', async ({
    page,
  }) => {
    await signIn(page)
    const plugin = createRestishAgentPlugin(baseURL)

    try {
      expect(() => plugin.whoami()).toThrow('restish realmroot agent enroll')

      const enrollment = plugin.enroll('mira.chen', 'Mira Chen')
      await page.goto(await enrollment.approvalUrl)
      await expect(page.getByRole('heading', { name: 'Approve Agent login' })).toBeVisible()
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      await expect(page.getByText('You can safely close this page.')).toBeVisible()

      const completedEnrollment = await enrollment.result
      expect(completedEnrollment).toMatchObject({
        username: 'mira.chen',
        nickname: 'Mira Chen',
        runtime: 'codex',
        status: 'approved',
      })
      const replayedEnrollment = await plugin.enroll('mira.chen', 'Mira Chen').result
      expect(replayedEnrollment).toMatchObject({
        id: completedEnrollment.id,
        username: 'mira.chen',
        nickname: 'Mira Chen',
        status: 'approved',
      })
      const result = plugin.whoami()
      expect(result.agent).toMatchObject({
        issuer: `${baseURL}/api/auth`,
        name: 'Mira Chen',
      })
      expect(result.agent.subject).toMatch(uuidV7Pattern)
      expect(plugin.whoami().agent).toMatchObject({
        issuer: result.agent.issuer,
        subject: result.agent.subject,
      })

      expect(plugin.inspectAuth('getAgentStatus')).toContain('oauth2')
      expect(plugin.inspectAuth('getAgentStatus')).not.toContain('agentAuth')
      expect(plugin.inspectAuth('createResourceServer')).toContain('oauth2')
      expect(plugin.whoami().agent).toMatchObject({
        issuer: result.agent.issuer,
        subject: result.agent.subject,
      })

      await page.goto('/agents')
      await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
      await expect(page.getByText('Mira Chen', { exact: true })).toBeVisible()
      await expect(page.getByText(new RegExp(result.agent.subject))).toBeVisible()
    } finally {
      plugin.dispose()
    }
  })

  test('[spec: agent-identity/agent-enrollment-denial] a controller can deny Agent enrollment', async ({ page }) => {
    await signIn(page)

    const deniedEnrollmentPlugin = createRestishAgentPlugin(baseURL)
    try {
      const enrollment = deniedEnrollmentPlugin.enroll('noah.williams', 'Noah Williams')
      const enrollmentResult = enrollment.result.catch((error: unknown) => error)
      await page.goto(await enrollment.approvalUrl)
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
