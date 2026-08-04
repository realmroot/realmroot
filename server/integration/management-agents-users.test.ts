import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { agentIdentityBinding } from '@server/db/schema'
import { createAgentLoginIdentity } from '@server/usecases/agent-identities'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHarness,
  createUser,
  type Harness,
  resourceOpenApiFetch,
  seedAgent,
  signIn,
  signInAdmin,
} from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('agent protocol management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
    harness.deps.externalHttp.fetch = resourceOpenApiFetch
  })

  it('rejects anonymous stable Agent reads with 401', async () => {
    expect((await harness.request('/api/agents')).status).toBe(401)
  })

  it('lists, revokes, recovers, and retires stable Agents through real SQL [spec: agent-identity/restish-agent-installation-revocation] [spec: agent-identity/restish-agent-recovery] [spec: agent-identity/restish-agent-retirement]', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'agent-owner@example.com',
      username: 'agentowner',
      displayName: 'Agent Owner',
      password: 'agent-owner-password-2026',
    })
    const seeded = await seedAgent(harness, userId)
    const stableAgent = await createAgentLoginIdentity(
      harness.deps,
      { protocolAgentId: seeded.agentId, name: 'Managed Agent' },
      'http://localhost/api/auth',
      userId,
    )

    const inventory = await harness.request('/api/agents', { headers: { cookie } })
    expect(inventory.status).toBe(200)
    const body = (await inventory.json()) as { items: Array<{ id: string }> }
    expect(body.items).toEqual([expect.objectContaining({ id: stableAgent.id })])

    const [installation] = await harness.db
      .select()
      .from(agentIdentityBinding)
      .where(eq(agentIdentityBinding.agentIdentityId, stableAgent.id))
    const installationId = installation!.id

    const legacyRetirementDeletion = await harness.request(`/api/agents/${stableAgent.id}/retirement`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(legacyRetirementDeletion.status).toBe(410)

    const revocation = await harness.request(
      `/api/agents/${stableAgent.id}/installations/${installationId}/revocation`,
      { method: 'PUT', headers: { cookie } },
    )
    expect(revocation.status).toBe(200)
    await expect(revocation.json()).resolves.toMatchObject({ installationId, status: 'revoked' })

    const recovery = await harness.request(`/api/agents/${stableAgent.id}/recovery`, {
      method: 'PUT',
      headers: { cookie },
    })
    expect(recovery.status).toBe(200)
    await expect(recovery.json()).resolves.toMatchObject({ agentId: stableAgent.id, status: 'recovering' })

    const retirement = await harness.request(`/api/agents/${stableAgent.id}/retirement`, {
      method: 'PUT',
      headers: { cookie },
    })
    expect(retirement.status).toBe(204)
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
    const stableAgent = await createAgentLoginIdentity(
      harness.deps,
      { protocolAgentId: seeded.agentId, name: 'Self Agent' },
      'http://localhost/api/auth',
      userId,
    )

    const list = await harness.request('/api/account/agents', { headers: { cookie: ownerCookie } })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { items: unknown[] }).items.length).toBe(1)

    expect(
      (
        await harness.request(`/api/account/agents/${stableAgent.id}`, {
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
    harness.deps.externalHttp.fetch = resourceOpenApiFetch
  })

  it('rejects anonymous reads with 401', async () => {
    expect((await harness.request('/api/users')).status).toBe(401)
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
    expect((await harness.request('/api/users', { headers: { cookie: memberCookie } })).status).toBe(403)
  })

  it('runs admin user CRUD through the user repository (real SQL)', async () => {
    const cookie = await signInAdmin(harness)

    const created = await harness.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
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
    const list = await harness.request('/api/users?search=managed', { headers: { cookie } })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { users: Array<{ id: string }> }).users.some((u) => u.id === userId)).toBe(true)

    const fetched = await harness.request(`/api/users/${userId}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)

    // updateManagedUser.
    const updated = await harness.request(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ displayName: 'Renamed Managed' }),
    })
    expect(updated.status, await updated.clone().text()).toBe(200)

    // deleteManagedUser.
    const removed = await harness.request(`/api/users/${userId}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(removed.status).toBe(200)
  })

  it('rejects an invalid admin create payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
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

    const sessions = await harness.request(`/api/users/${userId}/sessions`, {
      headers: { cookie: adminCookie },
    })
    expect(sessions.status).toBe(200)
    expect(((await sessions.json()) as { sessions: unknown[] }).sessions.length).toBeGreaterThanOrEqual(1)

    const linked = await harness.request(`/api/users/${userId}/linked-accounts`, {
      headers: { cookie: adminCookie },
    })
    expect(linked.status).toBe(200)
    expect(((await linked.json()) as { accounts: unknown[] }).accounts.length).toBeGreaterThanOrEqual(1)

    const passkeys = await harness.request(`/api/users/${userId}/passkeys`, {
      headers: { cookie: adminCookie },
    })
    expect(passkeys.status).toBe(200)
  })

  it('bans and unbans a user through Better Auth admin (real SQL)', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'bannable@example.com',
      username: 'bannable',
      displayName: 'Bannable',
      password: 'bannable-password-2026',
    })

    const banned = await harness.request(`/api/users/${userId}/suspension`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ reason: 'policy violation' }),
    })
    expect(banned.status, await banned.clone().text()).toBe(200)

    const unbanned = await harness.request(`/api/users/${userId}/suspension`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(unbanned.status).toBe(200)
  })
})

describe('federated credential management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
    harness.deps.externalHttp.fetch = resourceOpenApiFetch
  })

  async function createAppAndResource(cookie: string) {
    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Federation Client',
        slug: 'federation-client',
        clientType: 'confidential_web',
        redirectUris: ['http://localhost/callback'],
        allowedGrantTypes: ['urn:ietf:params:oauth:grant-type:token-exchange'],
      }),
    })
    const application = (await createApp.json()) as { id: string }
    const createResource = await harness.request('/api/resource-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        identifier: 'https://api.example.com',
        name: 'Example API',
        resourceUrl: 'https://api.example.com',
      }),
    })
    const resource = (await createResource.json()) as { id: string }
    return { applicationId: application.id, audienceResourceId: resource.id }
  }

  it('rejects anonymous reads with 401', async () => {
    expect((await harness.request('/api/applications/app_x/federated-credentials')).status).toBe(401)
  })

  it('creates and lists a federated credential through real SQL', async () => {
    const cookie = await signInAdmin(harness)
    const { applicationId, audienceResourceId } = await createAppAndResource(cookie)

    const created = await harness.request(`/api/applications/${applicationId}/federated-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Partner IdP',
        issuer: 'https://idp.partner.example.com',
        subject: 'machine:*',
        audienceResourceId,
        jwksUrl: 'https://idp.partner.example.com/.well-known/jwks.json',
      }),
    })
    expect(created.status, await created.clone().text()).toBe(201)

    const list = await harness.request(`/api/applications/${applicationId}/federated-credentials`, {
      headers: { cookie },
    })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { credentials: unknown[] }).credentials.length).toBe(1)
  })

  it('rejects an invalid federated credential payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const { applicationId, audienceResourceId } = await createAppAndResource(cookie)

    // Neither jwksUrl nor publicKeys provided.
    const response = await harness.request(`/api/applications/${applicationId}/federated-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'No key', issuer: 'https://x.example.com', subject: 'm:*', audienceResourceId }),
    })
    expect(response.status).toBe(400)
  })
})
