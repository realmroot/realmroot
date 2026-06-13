import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHarness,
  createUser,
  type Harness,
  seedAgent,
  signIn,
  signInAdmin,
  signInManagementBearer,
} from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('agent protocol management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous protocol-inventory reads with 401', async () => {
    expect((await harness.request('/api/management/agents/protocol-inventory')).status).toBe(401)
  })

  it('lists the seeded protocol inventory and revokes agent, grant, and host through real SQL', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'agent-owner@example.com',
      username: 'agentowner',
      displayName: 'Agent Owner',
      password: 'agent-owner-password-2026',
    })
    const seeded = await seedAgent(harness, userId)

    const inventory = await harness.request('/api/management/agents/protocol-inventory', { headers: { cookie } })
    expect(inventory.status).toBe(200)
    const body = (await inventory.json()) as {
      hosts: { items: unknown[] }
      agents: { items: unknown[] }
      capabilityGrants: { items: unknown[] }
      approvalRequests: { items: unknown[] }
    }
    expect(body.hosts.items.length).toBe(1)
    expect(body.agents.items.length).toBe(1)
    expect(body.capabilityGrants.items.length).toBe(1)
    expect(body.approvalRequests.items.length).toBe(1)

    expect(
      (
        await harness.request(`/api/management/agent-capability-grants/${seeded.grantId}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
    expect(
      (await harness.request(`/api/management/agents/${seeded.agentId}`, { method: 'DELETE', headers: { cookie } }))
        .status,
    ).toBe(204)
    expect(
      (await harness.request(`/api/management/agent-hosts/${seeded.hostId}`, { method: 'DELETE', headers: { cookie } }))
        .status,
    ).toBe(204)
  })

  it('lists and revokes an account agent through real SQL', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'self-agent@example.com',
      username: 'selfagent',
      displayName: 'Self Agent',
      password: 'self-agent-password-2026',
    })
    const ownerCookie = await signIn(harness, 'self-agent@example.com', 'self-agent-password-2026')

    const me = await harness.request('/api/account/profile', { headers: { cookie: ownerCookie } })
    const userId = ((await me.json()) as { user: { id: string } }).user.id
    const seeded = await seedAgent(harness, userId, 'self')

    const list = await harness.request('/api/account/agents', { headers: { cookie: ownerCookie } })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { agents: unknown[] }).agents.length).toBe(1)

    // revokeAccountCapabilityGrant + revokeAccountAgent scope by the owning user.
    expect(
      (
        await harness.request(`/api/account/agent-capability-grants/${seeded.grantId}`, {
          method: 'DELETE',
          headers: { cookie: ownerCookie },
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await harness.request(`/api/account/agents/${seeded.agentId}`, {
          method: 'DELETE',
          headers: { cookie: ownerCookie },
        })
      ).status,
    ).toBe(204)
  })
})

describe('user management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous reads with 401', async () => {
    expect((await harness.request('/api/management/users')).status).toBe(401)
  })

  it('rejects a signed-in non-admin with 403', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'plain@example.com',
      username: 'plain',
      displayName: 'Plain',
      password: 'plain-password-2026',
    })
    const memberCookie = await signIn(harness, 'plain@example.com', 'plain-password-2026')
    expect((await harness.request('/api/management/users', { headers: { cookie: memberCookie } })).status).toBe(403)
  })

  it('runs the bearer-authenticated admin user CRUD through the user repository (real SQL) [spec: management-api/management-restish-user-crud]', async () => {
    const bearer = await signInManagementBearer(harness)

    const created = await harness.request('/api/management/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: bearer },
      body: JSON.stringify({
        email: 'managed@example.com',
        username: 'managed',
        displayName: 'Managed User',
        password: 'managed-password-2026',
        role: 'user',
      }),
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const userId = ((await created.json()) as { user: { id: string } }).user.id

    // listManagedUsers (repository search/pagination).
    const list = await harness.request('/api/management/users?search=managed', { headers: { authorization: bearer } })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { users: Array<{ id: string }> }).users.some((u) => u.id === userId)).toBe(true)

    const fetched = await harness.request(`/api/management/users/${userId}`, { headers: { authorization: bearer } })
    expect(fetched.status).toBe(200)

    // updateManagedUser.
    const updated = await harness.request(`/api/management/users/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: bearer },
      body: JSON.stringify({ displayName: 'Renamed Managed' }),
    })
    expect(updated.status, await updated.clone().text()).toBe(200)

    // deleteManagedUser.
    const removed = await harness.request(`/api/management/users/${userId}`, {
      method: 'DELETE',
      headers: { authorization: bearer },
    })
    expect(removed.status).toBe(204)
  })

  it('rejects an invalid bearer create payload with 400', async () => {
    const bearer = await signInManagementBearer(harness)
    const response = await harness.request('/api/management/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: bearer },
      body: JSON.stringify({ username: 'no-email' }),
    })
    expect(response.status).toBe(400)
  })

  it('reads sessions, linked accounts, passkeys, and security state through real SQL', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'insight@example.com',
      username: 'insight',
      displayName: 'Insight',
      password: 'insight-password-2026',
    })
    // Sign the user in so listSessions / getSessionToken have a real session row.
    const userCookie = await signIn(harness, 'insight@example.com', 'insight-password-2026')
    const me = await harness.request('/api/account/profile', { headers: { cookie: userCookie } })
    const userId = ((await me.json()) as { user: { id: string } }).user.id

    const sessions = await harness.request(`/api/management/users/${userId}/sessions`, {
      headers: { cookie: adminCookie },
    })
    expect(sessions.status).toBe(200)
    expect(((await sessions.json()) as { sessions: unknown[] }).sessions.length).toBeGreaterThanOrEqual(1)

    const linked = await harness.request(`/api/management/users/${userId}/linked-accounts`, {
      headers: { cookie: adminCookie },
    })
    expect(linked.status).toBe(200)
    expect(((await linked.json()) as { accounts: unknown[] }).accounts.length).toBeGreaterThanOrEqual(1)

    const passkeys = await harness.request(`/api/management/users/${userId}/passkeys`, {
      headers: { cookie: adminCookie },
    })
    expect(passkeys.status).toBe(200)

    const security = await harness.request(`/api/management/users/${userId}/security`, {
      headers: { cookie: adminCookie },
    })
    expect(security.status).toBe(200)

    const apps = await harness.request(`/api/management/users/${userId}/applications`, {
      headers: { cookie: adminCookie },
    })
    expect(apps.status).toBe(200)
  })

  it('bans and unbans a user through Better Auth admin (real SQL)', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'bannable@example.com',
      username: 'bannable',
      displayName: 'Bannable',
      password: 'bannable-password-2026',
    })

    const banned = await harness.request(`/api/management/users/${userId}/ban`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ reason: 'policy violation' }),
    })
    expect(banned.status, await banned.clone().text()).toBe(200)

    const unbanned = await harness.request(`/api/management/users/${userId}/unban`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(unbanned.status).toBe(200)
  })
})

describe('trusted issuer management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous reads with 401', async () => {
    expect((await harness.request('/api/management/trusted-issuers')).status).toBe(401)
  })

  it('creates and lists a trusted issuer through real SQL', async () => {
    const cookie = await signInAdmin(harness)

    const created = await harness.request('/api/management/trusted-issuers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Partner IdP',
        issuer: 'https://idp.partner.example.com',
        jwksUrl: 'https://idp.partner.example.com/.well-known/jwks.json',
        allowedAudiences: ['https://api.example.com'],
      }),
    })
    expect(created.status, await created.clone().text()).toBe(201)

    const list = await harness.request('/api/management/trusted-issuers', { headers: { cookie } })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { issuers: unknown[] }).issuers.length).toBe(1)
  })

  it('rejects an invalid trusted issuer payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/management/trusted-issuers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'No issuer URL' }),
    })
    expect(response.status).toBe(400)
  })
})
