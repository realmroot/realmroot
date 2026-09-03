import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bootstrapAdmin, createHarness, type Harness, platformOrganizationId } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

const admin = {
  email: 'admin@example.com',
  username: 'admin',
  name: 'Realmroot Admin',
  password: 'admin-password-2026',
}

async function signIn(harness: Harness): Promise<string> {
  const response = await harness.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: admin.password }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  const setCookie = response.headers.get('set-cookie')
  expect(setCookie, 'sign-in should set a session cookie').toBeTruthy()
  return (setCookie ?? '')
    .split(',')
    .map((part) => part.trim().split(';')[0])
    .filter((pair) => pair.includes('='))
    .join('; ')
}

describe('resource access over real D1 and real Better Auth sessions', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous management reads with 401', async () => {
    await bootstrapAdmin(harness)
    const response = await harness.request('/api/applications')
    expect(response.status).toBe(401)
  })

  it('rejects a malformed bearer token with 401', async () => {
    await bootstrapAdmin(harness)
    const response = await harness.request('/api/applications', {
      headers: { authorization: 'Bearer' },
    })
    expect(response.status).toBe(401)
  })

  it('filters collections for a signed-in user without Organization access', async () => {
    await bootstrapAdmin(harness)
    const adminCookie = await signIn(harness)

    const created = await harness.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        email: 'member@example.com',
        username: 'member',
        displayName: 'Member',
        password: 'member-password-2026',
        role: 'user',
      }),
    })
    expect(created.status, await created.clone().text()).toBe(201)

    const memberSignIn = await harness.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@example.com', password: 'member-password-2026' }),
    })
    expect(memberSignIn.status, await memberSignIn.clone().text()).toBe(200)
    const memberCookie = (memberSignIn.headers.get('set-cookie') ?? '')
      .split(',')
      .map((part) => part.trim().split(';')[0])
      .filter((pair) => pair.includes('='))
      .join('; ')

    const filtered = await harness.request('/api/applications', {
      headers: { cookie: memberCookie },
    })
    expect(filtered.status).toBe(200)
    await expect(filtered.json()).resolves.toMatchObject({ items: [], pagination: { totalItems: 0 } })
  })

  it('lists applications for a signed-in admin and reflects a real D1 write', async () => {
    await bootstrapAdmin(harness)
    const cookie = await signIn(harness)

    const before = await harness.request('/api/applications', { headers: { cookie } })
    expect(before.status, await before.clone().text()).toBe(200)
    const beforeBody = (await before.json()) as { items: unknown[]; pagination: { totalItems: number } }
    const initialTotal = beforeBody.pagination.totalItems

    const create = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Customer Portal',
        slug: 'customer-portal',
        clientType: 'public_spa',
        redirectUris: ['http://localhost/callback'],
        ownerOrganizationId: platformOrganizationId,
        consentRequired: false,
      }),
    })
    expect(create.status, await create.clone().text()).toBe(201)

    const after = await harness.request('/api/applications', { headers: { cookie } })
    const afterBody = (await after.json()) as { pagination: { totalItems: number } }
    expect(afterBody.pagination.totalItems).toBe(initialTotal + 1)
  })

  it('rejects an invalid application payload at the validation boundary', async () => {
    await bootstrapAdmin(harness)
    const cookie = await signIn(harness)

    const response = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'no-name' }),
    })
    expect(response.status).toBe(400)
  })
})
