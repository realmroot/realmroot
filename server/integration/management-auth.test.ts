import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

const admin = {
  email: 'admin@example.com',
  username: 'admin',
  name: 'FlareAuth Admin',
  password: 'admin-password-2026',
}

async function bootstrapAdmin(harness: Harness) {
  const response = await harness.request('/api/onboarding/admin-users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(admin),
  })
  expect(response.status, await response.clone().text()).toBe(201)
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

describe('management access over real D1 and real Better Auth sessions', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous management reads with 401', async () => {
    await bootstrapAdmin(harness)
    const response = await harness.request('/api/management/applications')
    expect(response.status).toBe(401)
  })

  it('rejects a malformed bearer token with 401', async () => {
    await bootstrapAdmin(harness)
    const response = await harness.request('/api/management/applications', {
      headers: { authorization: 'Bearer' },
    })
    expect(response.status).toBe(401)
  })

  it('rejects a signed-in non-admin user with 403', async () => {
    await bootstrapAdmin(harness)
    const adminCookie = await signIn(harness)

    const created = await harness.request('/api/management/users', {
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

    const forbidden = await harness.request('/api/management/applications', {
      headers: { cookie: memberCookie },
    })
    expect(forbidden.status).toBe(403)
  })

  it('lists applications for a signed-in admin and reflects a real D1 write', async () => {
    await bootstrapAdmin(harness)
    const cookie = await signIn(harness)

    const before = await harness.request('/api/management/applications', { headers: { cookie } })
    expect(before.status, await before.clone().text()).toBe(200)
    const beforeBody = (await before.json()) as { items: unknown[]; pagination: { total: number } }
    const initialTotal = beforeBody.pagination.total

    const create = await harness.request('/api/management/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Customer Portal',
        slug: 'customer-portal',
        clientType: 'public_spa',
        redirectUris: ['http://localhost/callback'],
        firstParty: true,
        trusted: true,
      }),
    })
    expect(create.status, await create.clone().text()).toBe(201)

    const after = await harness.request('/api/management/applications', { headers: { cookie } })
    const afterBody = (await after.json()) as { pagination: { total: number } }
    expect(afterBody.pagination.total).toBe(initialTotal + 1)
  })

  it('rejects an invalid application payload at the validation boundary', async () => {
    await bootstrapAdmin(harness)
    const cookie = await signIn(harness)

    const response = await harness.request('/api/management/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'no-name' }),
    })
    expect(response.status).toBe(400)
  })
})
