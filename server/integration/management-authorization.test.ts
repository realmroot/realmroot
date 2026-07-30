import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { apiResource, resourceAccountConnection, user } from '@server/db/schema'
import { createResource } from '@server/usecases/authorization'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, resourceOpenApiFetch, signIn, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

async function postJson(harness: Harness, cookie: string, path: string, body: unknown, expected = 201) {
  const response = await harness.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
  expect(response.status, await response.clone().text()).toBe(expected)
  return response
}

describe('authorization management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
    harness.deps.externalHttp.fetch = resourceOpenApiFetch
  })

  it('rejects anonymous reads with 401', async () => {
    const response = await harness.request('/api/api-resources')
    expect(response.status).toBe(401)
  })

  it('rejects a signed-in non-admin with 403', async () => {
    const adminCookie = await signInAdmin(harness)
    await createUser(harness, adminCookie, {
      email: 'member@example.com',
      username: 'member',
      displayName: 'Member',
      password: 'member-password-2026',
    })
    const memberCookie = await signIn(harness, 'member@example.com', 'member-password-2026')

    const response = await harness.request('/api/roles', { headers: { cookie: memberCookie } })
    expect(response.status).toBe(403)
  })

  it('rejects an invalid api-resource payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/api-resources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'missing identifier' }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects an undiscoverable enabled resource but saves a disabled draft', async () => {
    const cookie = await signInAdmin(harness)
    harness.deps.externalHttp.fetch = async () => new Response('<html></html>')
    const input = {
      identifier: 'projects-api',
      name: 'Projects API',
      resourceUrl: 'https://projects.example.com/api',
    }

    const enabled = await harness.request('/api/api-resources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(input),
    })
    expect(enabled.status).toBe(400)

    const draft = await postJson(harness, cookie, '/api/api-resources', { ...input, enabled: false })
    const resource = (await draft.json()) as { id: string; enabled: boolean }
    expect(resource.enabled).toBe(false)

    const enable = await harness.request(`/api/api-resources/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ enabled: true }),
    })
    expect(enable.status).toBe(400)
  })

  it('requires authorization reconfiguration when an external resource URL changes [spec: agent-identity/external-api-resource-reconfiguration]', async () => {
    const cookie = await signInAdmin(harness)
    const resource = await createResource(harness.deps, {
      identifier: 'projects-api',
      name: 'Projects API',
      resourceUrl: 'https://projects.example.com/api',
      authorizationMode: 'external',
    })

    const response = await harness.request(`/api/api-resources/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ resourceUrl: 'https://new-projects.example.com/api' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'Changing an external API resource URL requires authorization reconfiguration.' },
    })
  })

  it('runs the API resource lifecycle through real SQL [spec: management-api/management-restish-api-resource-crud]', async () => {
    const cookie = await signInAdmin(harness)

    const resource = (await (
      await postJson(harness, cookie, '/api/api-resources', {
        identifier: 'https://api.example.com',
        name: 'Example API',
        resourceUrl: 'https://api.example.com',
      })
    ).json()) as { id: string }

    const list = await harness.request('/api/api-resources', { headers: { cookie } })
    expect(((await list.json()) as { items: unknown[] }).items.length).toBe(1)

    const fetched = await harness.request(`/api/api-resources/${resource.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)

    const patched = await harness.request(`/api/api-resources/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Renamed API' }),
    })
    expect(((await patched.json()) as { name: string }).name).toBe('Renamed API')

    expect(
      (
        await harness.request(`/api/api-resources/${resource.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
  })

  it('[spec: management-api/management-api-resource-delete-conflict] preserves resources with authorization history', async () => {
    const cookie = await signInAdmin(harness)
    const resource = (await (
      await postJson(harness, cookie, '/api/api-resources', {
        identifier: 'history-api',
        name: 'History API',
        resourceUrl: 'https://history.example.com/api',
      })
    ).json()) as { id: string }
    const [admin] = await harness.db.select({ id: user.id }).from(user).where(eq(user.email, 'admin@example.com'))
    const now = new Date()
    await harness.db.insert(resourceAccountConnection).values({
      id: 'connection-history',
      resourceId: resource.id,
      ownerUserId: admin.id,
      externalSubject: 'admin@example.com',
      displayName: 'Admin connection',
      encryptedTokens: 'encrypted-tokens',
      grantedScopes: ['files:read'],
      createdAt: now,
      updatedAt: now,
    })

    const response = await harness.request(`/api/api-resources/${resource.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'resource_in_use',
        message: 'API resource has authorization history and cannot be permanently deleted.',
        requestId: expect.any(String),
        details: {
          federatedCredentials: 0,
          accountConnections: 1,
          connectionIntents: 0,
          agentAccessRequests: 0,
          agentAccessGrants: 0,
        },
      },
    })
    await expect(
      harness.db.select({ id: apiResource.id }).from(apiResource).where(eq(apiResource.id, resource.id)),
    ).resolves.toEqual([{ id: resource.id }])
    await expect(
      harness.db
        .select({ id: resourceAccountConnection.id })
        .from(resourceAccountConnection)
        .where(eq(resourceAccountConnection.id, 'connection-history')),
    ).resolves.toEqual([{ id: 'connection-history' }])
  })

  it('manages role scope references and a user role assignment through real SQL [spec: management-api/management-restish-role-crud]', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'assignee@example.com',
      username: 'assignee',
      displayName: 'Assignee',
      password: 'assignee-password-2026',
    })

    const resource = (await (
      await postJson(harness, cookie, '/api/api-resources', {
        identifier: 'https://roles.example.com',
        name: 'Roles API',
        resourceUrl: 'https://roles.example.com',
      })
    ).json()) as { id: string }
    const role = (await (
      await postJson(harness, cookie, '/api/roles', {
        key: 'editor',
        name: 'Editor',
        resourceId: resource.id,
      })
    ).json()) as { id: string }

    const roles = await harness.request('/api/roles', { headers: { cookie } })
    expect(((await roles.json()) as { roles: unknown[] }).roles.length).toBeGreaterThanOrEqual(1)

    expect((await harness.request(`/api/roles/${role.id}`, { headers: { cookie } })).status).toBe(200)

    const patched = await harness.request(`/api/roles/${role.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Lead Editor' }),
    })
    expect(((await patched.json()) as { name: string }).name).toBe('Lead Editor')

    const replaceScopes = await harness.request(`/api/roles/${role.id}/scopes`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ scopes: [] }),
    })
    expect(replaceScopes.status).toBe(204)

    const roleScopes = await harness.request(`/api/roles/${role.id}/scopes`, {
      headers: { cookie },
    })
    expect(((await roleScopes.json()) as { scopes: string[] }).scopes).toEqual([])

    // assignUserRole (top-level mount) writes a userRoleAssignment row.
    await postJson(harness, cookie, '/api/roles/assignments/users', { roleId: role.id, subjectId: userId }, 204)
    // assignUserRole (roles-scoped mount) is idempotent on conflict.
    await postJson(harness, cookie, '/api/roles/assignments/users', { roleId: role.id, subjectId: userId }, 204)

    expect((await harness.request(`/api/roles/${role.id}`, { method: 'DELETE', headers: { cookie } })).status).toBe(204)
  })

  it('runs the organization / member / invitation lifecycle through real SQL [spec: management-api/management-restish-organization-crud]', async () => {
    const cookie = await signInAdmin(harness)
    const memberUserId = await createUser(harness, cookie, {
      email: 'org-member@example.com',
      username: 'orgmember',
      displayName: 'Org Member',
      password: 'org-member-password-2026',
    })

    const organization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'acme', name: 'Acme' })
    ).json()) as { id: string }

    const list = await harness.request('/api/organizations', { headers: { cookie } })
    expect(((await list.json()) as { organizations: unknown[] }).organizations.length).toBe(1)

    expect((await harness.request(`/api/organizations/${organization.id}`, { headers: { cookie } })).status).toBe(200)

    const patched = await harness.request(`/api/organizations/${organization.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Acme Inc' }),
    })
    expect(((await patched.json()) as { name: string }).name).toBe('Acme Inc')

    const member = (await (
      await postJson(harness, cookie, `/api/organizations/${organization.id}/members`, {
        userId: memberUserId,
        role: 'member',
      })
    ).json()) as { id: string }
    const members = await harness.request(`/api/organizations/${organization.id}/members`, {
      headers: { cookie },
    })
    expect(((await members.json()) as { members: unknown[] }).members.length).toBe(1)

    const patchedMember = await harness.request(`/api/organizations/${organization.id}/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(((await patchedMember.json()) as { role: string }).role).toBe('admin')

    // assignMemberRole writes a memberRoleAssignment row.
    const role = (await (
      await postJson(harness, cookie, '/api/roles', { key: 'org-lead', name: 'Org Lead' })
    ).json()) as { id: string }
    await postJson(harness, cookie, '/api/roles/assignments/members', { roleId: role.id, subjectId: member.id }, 204)

    const invitation = (await (
      await postJson(harness, cookie, `/api/organizations/${organization.id}/invitations`, {
        email: 'invitee@example.com',
        role: 'member',
      })
    ).json()) as { id: string }
    const invitations = await harness.request(`/api/organizations/${organization.id}/invitations`, {
      headers: { cookie },
    })
    expect(((await invitations.json()) as { invitations: unknown[] }).invitations.length).toBe(1)

    expect(
      (
        await harness.request(`/api/organizations/${organization.id}/invitations/${invitation.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await harness.request(`/api/organizations/${organization.id}/members/${member.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await harness.request(`/api/organizations/${organization.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
  })

  it('assigns an application role through real SQL', async () => {
    const cookie = await signInAdmin(harness)

    const application = (await (
      await postJson(harness, cookie, '/api/applications', {
        name: 'Role Client',
        slug: 'role-client',
        clientType: 'confidential_web',
        redirectUris: ['http://localhost/callback'],
      })
    ).json()) as { id: string }
    const role = (await (await postJson(harness, cookie, '/api/roles', { key: 'svc', name: 'Service' })).json()) as {
      id: string
    }

    await postJson(
      harness,
      cookie,
      '/api/roles/assignments/applications',
      { roleId: role.id, subjectId: application.id },
      204,
    )
  })
})
