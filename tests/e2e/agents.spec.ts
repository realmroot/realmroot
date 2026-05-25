import { expect, test } from '@playwright/test'
import { attachCoverage, currentUserId, resetAndBootstrap, seedAgentAccess, signIn } from './helpers/real-app'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await resetAndBootstrap()
})

test('agent discovery and signed-in approval route are reachable', async ({ page }, testInfo) => {
  const discovery = await page.request.get('/.well-known/agent-configuration')
  expect(discovery.status()).toBe(200)
  await expect(discovery.json()).resolves.toMatchObject({
    modes: ['delegated'],
    approval_methods: ['device_authorization'],
  })

  await page.goto('/agent/approve?agent_id=agent_e2e_desktop&code=ABCD-1234')
  await expect(page).toHaveURL(/\/sign-in/)

  await signIn(page)
  await page.goto('/agent/approve?agent_id=agent_e2e_desktop&code=ABCD-1234&host=E2E%20Agent%20Host')
  await expect(page.getByRole('heading', { name: 'Approve account access' })).toBeVisible()
  await expect(page.getByText('E2E Agent Host')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Requested capabilities' })).toContainText('account.profile.read')
  await attachCoverage(testInfo, ['agent-discovery'])
})

test('account center lists and revokes delegated agent grants', async ({ page }, testInfo) => {
  const userId = currentUserId()
  expect(userId).toBeTruthy()
  seedAgentAccess(userId as string)

  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Delegated agents' })).toBeVisible()
  await expect(page.getByText('E2E Desktop Agent')).toBeVisible()
  await expect(page.getByText(/E2E Agent Host/)).toBeVisible()
  const grantRow = page.locator('.itemRow').filter({ hasText: 'account.profile.read' })
  await grantRow.getByRole('button', { name: 'Revoke' }).first().click()
  await page.getByRole('button', { name: 'Revoke grant' }).click()
  await expect(page.getByText('Capability grant revoked.')).toBeVisible()
  await expect(page.getByText('account.profile.read')).toHaveCount(0)
  await attachCoverage(testInfo, ['account-agent-management'])
})

test('admin console lists and revokes delegated agent inventory', async ({ page }, testInfo) => {
  const userId = currentUserId()
  expect(userId).toBeTruthy()
  seedAgentAccess(userId as string)

  await signIn(page)
  await page.goto('/console/agents')
  await expect(page.getByRole('heading', { name: 'Delegated agents' })).toBeVisible()
  await expect(page.getByText('E2E Desktop Agent')).toBeVisible()
  await expect(page.getByText('approval_e2e_agent')).toBeVisible()
  await expect(page.locator('tr').filter({ hasText: 'approval_e2e_agent' })).toContainText('approved')
  await page
    .locator('tr')
    .filter({ hasText: 'E2E Desktop Agent' })
    .getByRole('button', { name: 'Revoke' })
    .nth(1)
    .click()
  await expect(page.locator('tr').filter({ hasText: 'E2E Desktop Agent' })).toContainText('revoked')
  await attachCoverage(testInfo, ['admin-agent-inventory'])
})
