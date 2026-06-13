import { expect, test } from '@playwright/test'
import { createOidcApplication, resetAndBootstrap, signIn } from './helpers/real-app'

// Hermetic admin config CRUD: create an OIDC application through the Management
// API as the signed-in admin and confirm it persists. This only writes local
// D1 — no third-party IdP, no external network.
test.describe('admin config CRUD', () => {
  test.beforeEach(async () => {
    await resetAndBootstrap()
  })

  test('[spec: admin-console/admin-create-application] admin creates an OIDC application that persists in D1', async ({
    page,
  }) => {
    await signIn(page)

    const created = (await createOidcApplication(page, 'E2E CRUD Application')) as { id: string; name: string }
    expect(created.name).toBe('E2E CRUD Application')

    const listed = await page.request.get('/api/management/applications')
    expect(listed.status(), await listed.text()).toBe(200)
    const body = (await listed.json()) as { applications: Array<{ id: string }> }
    expect(body.applications.some((item) => item.id === created.id)).toBe(true)
  })
})
