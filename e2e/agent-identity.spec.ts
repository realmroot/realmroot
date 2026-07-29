import { expect, test } from '@playwright/test'
import { baseURL, expirePendingAgentApprovals, resetAndBootstrap, signIn } from './helpers/real-app'
import { createRestishAgentPlugin } from './helpers/restish-agent-plugin'

// Hermetic: the repository's Restish plugin generates independent keys, uses
// the published AgentAuth protocol through Restish HTTP delegation, receives
// controller approvals through the real SPA, and reads the stable identity.
// No D1 seeding is used for the Agent, host, intent, identity, or binding.
test.describe('new Agent stable identity enrollment', () => {
  test.beforeEach(async () => {
    await resetAndBootstrap()
  })

  test('[spec: agent-identity/agent-identity-enrollment] [spec: agent-identity/agent-management-authority] [spec: agent-identity/agent-capability-approval-renewal] a new Agent establishes its identity and gains approved management access', async ({
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
      expect(result.identity).toMatchObject({
        issuer: `${baseURL}/api/auth`,
        name: 'E2E Build Agent',
        bindings: [{ status: 'active' }],
      })
      expect(result.identity.subject).toMatch(/^agt_/)
      expect(plugin.whoami().identity).toMatchObject({
        issuer: result.identity.issuer,
        subject: result.identity.subject,
      })

      const firstPermissionRequest = plugin.requestCapabilities(
        ['management:read', 'management:write'],
        'E2E tenant administration',
      )
      const firstApprovalUrl = await firstPermissionRequest.approvalUrl
      const repeatedPermissionRequest = plugin.requestCapabilities(
        ['management:read', 'management:write'],
        'E2E tenant administration retry',
      )
      const repeatedApprovalUrl = await repeatedPermissionRequest.approvalUrl
      expect(repeatedApprovalUrl).not.toBe(firstApprovalUrl)

      expirePendingAgentApprovals(result.identity.bindings[0]!.protocolAgentId)
      const renewedPermissionRequest = plugin.requestCapabilities(
        ['management:read', 'management:write'],
        'E2E tenant administration after expiry',
      )
      const renewedApprovalUrl = await renewedPermissionRequest.approvalUrl
      expect(renewedApprovalUrl).not.toBe(repeatedApprovalUrl)

      await page.goto(renewedApprovalUrl)
      await expect(page.getByRole('heading', { name: 'Approve Agent permissions' })).toBeVisible()
      await expect(page.getByText('management:read', { exact: true })).toBeVisible()
      await expect(page.getByText('management:write', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Approve permissions' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization successful' })).toBeVisible()
      await expect(page.getByText('You can safely close this page.')).toBeVisible()

      const permissionRequests = await Promise.all([
        firstPermissionRequest.result,
        repeatedPermissionRequest.result,
        renewedPermissionRequest.result,
      ])
      for (const permissionRequest of permissionRequests) {
        expect(permissionRequest.status).toBe('active')
        expect(permissionRequest.agent_capability_grants).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ capability: 'management:read', status: 'active' }),
            expect.objectContaining({ capability: 'management:write', status: 'active' }),
          ]),
        )
        expect(permissionRequest.agent_capability_grants).toHaveLength(2)
      }

      expect(plugin.listApplications().applications).toEqual(expect.any(Array))

      await page.goto('/connections')
      const identities = page.getByLabel('Agent identities')
      await expect(identities.getByRole('heading', { name: 'E2E Build Agent' })).toBeVisible()
      await expect(identities.getByText(new RegExp(result.identity.subject))).toBeVisible()
    } finally {
      plugin.dispose()
    }
  })

  test('[spec: agent-identity/agent-capability-denial] a controller can deny enrollment and capability requests', async ({
    page,
  }) => {
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

    const deniedCapabilityPlugin = createRestishAgentPlugin(baseURL)
    try {
      const whoami = deniedCapabilityPlugin.firstWhoami('Denied Capability Agent')
      await page.goto(await whoami.approvalUrl)
      await page.getByRole('button', { name: 'Approve login' }).click()
      await whoami.result

      const capabilityRequest = deniedCapabilityPlugin.requestCapabilities(
        ['management:read'],
        'Verify explicit controller denial',
      )
      const capabilityResult = capabilityRequest.result.catch((error: unknown) => error)
      await page.goto(await capabilityRequest.approvalUrl)
      await page.getByRole('button', { name: 'Deny' }).click()
      await expect(page.getByRole('heading', { name: 'Authorization denied' })).toBeVisible()
      await expect(capabilityResult).resolves.toMatchObject({
        message: expect.stringContaining('controller denied the requested Agent capabilities'),
      })
    } finally {
      deniedCapabilityPlugin.dispose()
    }
  })
})
