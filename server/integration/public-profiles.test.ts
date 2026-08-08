import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('Public profiles over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('publishes summary and full User views without private account fields [spec: account-center/public-user-profile]', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'public-user@example.com',
      username: 'publicuser',
      displayName: 'Public User',
      password: 'public-user-password-2026',
    })
    const cookie = await signIn(harness, 'public-user@example.com', 'public-user-password-2026')
    const update = await harness.request('/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        bio: 'Building useful Agents.',
        location: 'Toronto',
        links: [{ type: 'website', label: 'Personal website', url: 'https://public.example.com' }],
      }),
    })
    expect(update.status, await update.clone().text()).toBe(200)

    const summary = await harness.request('/api/public/users/publicuser')
    expect(summary.status, await summary.clone().text()).toBe(200)
    const summaryBody = (await summary.json()) as Record<string, unknown>
    expect(summaryBody).toMatchObject({
      type: 'user',
      view: 'summary',
      username: 'publicuser',
      displayName: 'Public User',
    })
    expect(summaryBody).not.toHaveProperty('bio')
    expect(summaryBody).not.toHaveProperty('email')

    const full = await harness.request('/api/public/users/publicuser?view=full')
    expect(full.status, await full.clone().text()).toBe(200)
    const fullBody = (await full.json()) as Record<string, unknown>
    expect(fullBody).toMatchObject({
      type: 'user',
      view: 'full',
      username: 'publicuser',
      bio: 'Building useful Agents.',
      location: 'Toronto',
      links: [{ type: 'website', label: 'Personal website', url: 'https://public.example.com' }],
      agentCount: 0,
      agents: [],
      recentActivity: [],
    })
    expect(fullBody).not.toHaveProperty('email')
    expect(full.headers.get('etag')).not.toBe(summary.headers.get('etag'))
  })

  it('validates the named view and conceals unknown profiles', async () => {
    expect((await harness.request('/api/public/users/missing')).status).toBe(404)
    expect((await harness.request('/api/public/users/missing?view=everything')).status).toBe(400)
    expect((await harness.request('/api/public/agents/not-an-agent')).status).toBe(400)
  })
})
