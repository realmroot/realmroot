import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agent,
  agentAccessGrant,
  agentAccessRequest,
  agentAuditEvent,
  agentHost,
  agentIdentity,
  agentIdentityBinding,
  apiResource,
  externalTokenLease,
  resourceAccountConnection,
  resourceConnectionIntent,
  user,
} from '@server/db/schema'
import { createResource } from '@server/usecases/authorization'
import { discoverAgentResources } from '@server/usecases/external-resources'
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

  it('configures external authorization atomically only while the resource is unarchived [spec: management-api/management-api-resource-archival]', async () => {
    const cookie = await signInAdmin(harness)
    const resource = await createResource(harness.deps, {
      identifier: 'conditional-external',
      name: 'Conditional external API',
      resourceUrl: 'https://conditional.example.com/api',
      authorizationMode: 'external',
      enabled: false,
    })
    const now = new Date()
    const authorization = {
      resourceId: resource.id,
      resourceUrl: resource.resourceUrl,
      issuer: 'https://conditional.example.com',
      authorizationEndpoint: 'https://conditional.example.com/authorize',
      tokenEndpoint: 'https://conditional.example.com/token',
      registrationEndpoint: null,
      revocationEndpoint: 'https://conditional.example.com/revoke',
      jwksUri: 'https://conditional.example.com/jwks',
      userInfoEndpoint: 'https://conditional.example.com/userinfo',
      registrationMode: 'manual',
      clientId: 'conditional-client',
      encryptedClientSecret: 'conditional-secret',
      encryptedRegistrationAccessToken: null,
      metadata: {},
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    await expect(harness.deps.externalResources.configureAuthorization(authorization)).resolves.toMatchObject({
      resourceId: resource.id,
    })
    await expect(harness.deps.authorization.findResource(resource.id)).resolves.toMatchObject({ enabled: true })

    const archived = await harness.request(`/api/api-resources/${resource.id}/archival`, {
      method: 'PUT',
      headers: { cookie },
    })
    expect(archived.status).toBe(200)
    await expect(
      harness.deps.externalResources.configureAuthorization({
        ...authorization,
        clientId: 'late-client',
        updatedAt: new Date(now.getTime() + 1),
      }),
    ).resolves.toBeNull()
    await expect(harness.deps.externalResources.findAuthorization(resource.id)).resolves.toMatchObject({
      clientId: 'conditional-client',
    })
  })

  it('[spec: management-api/management-api-resource-archival] archives and restores without reviving authorization', async () => {
    const cookie = await signInAdmin(harness)
    const resource = (await (
      await postJson(harness, cookie, '/api/api-resources', {
        identifier: 'archived-api',
        name: 'Archived API',
        resourceUrl: 'https://archived.example.com/api',
      })
    ).json()) as { id: string }
    const [admin] = await harness.db.select({ id: user.id }).from(user).where(eq(user.email, 'admin@example.com'))
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 60_000)
    await harness.db.insert(agentHost).values({
      id: 'archive-host',
      name: 'Archive host',
      userId: admin.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agent).values({
      id: 'archive-agent',
      name: 'Archive Agent',
      userId: admin.id,
      hostId: 'archive-host',
      status: 'active',
      publicKey: '{}',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentIdentity).values({
      id: 'archive-identity',
      issuer: 'http://localhost/api/auth',
      subject: 'archive-subject',
      name: 'Archive identity',
      ownerUserId: admin.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentIdentityBinding).values({
      id: 'archive-binding',
      agentIdentityId: 'archive-identity',
      protocolAgentId: 'archive-agent',
      status: 'active',
      boundAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(resourceAccountConnection).values({
      id: 'archive-connection',
      resourceId: resource.id,
      ownerUserId: admin.id,
      externalSubject: 'admin@example.com',
      displayName: 'Archive connection',
      encryptedTokens: 'encrypted-tokens',
      grantedScopes: ['files:read'],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(resourceConnectionIntent).values({
      id: 'archive-intent',
      stateHash: 'archive-state',
      resourceId: resource.id,
      ownerUserId: admin.id,
      scopes: ['files:read'],
      encryptedPkceVerifier: 'encrypted-verifier',
      status: 'pending',
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessRequest).values({
      id: 'archive-request',
      resourceId: resource.id,
      connectionId: 'archive-connection',
      agentIdentityId: 'archive-identity',
      bindingId: 'archive-binding',
      scopes: ['files:read'],
      status: 'pending',
      approvalTokenHash: 'archive-approval-hash',
      encryptedApprovalToken: 'encrypted-approval',
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessGrant).values({
      id: 'archive-grant',
      resourceId: resource.id,
      connectionId: 'archive-connection',
      agentIdentityId: 'archive-identity',
      scopes: ['files:read'],
      mode: 'ongoing',
      status: 'active',
      grantedByUserId: admin.id,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(externalTokenLease).values({
      id: 'archive-lease',
      grantId: 'archive-grant',
      requestId: 'archive-request',
      bindingId: 'archive-binding',
      encryptedAccessToken: 'encrypted-access-token',
      tokenHash: 'archive-token-hash',
      confirmationJkt: 'archive-jkt',
      scopes: ['files:read'],
      expiresAt,
      createdAt: now,
    })

    const archived = await harness.request(`/api/api-resources/${resource.id}/archival`, {
      method: 'PUT',
      headers: { cookie },
    })

    expect(archived.status).toBe(200)
    await expect(archived.json()).resolves.toMatchObject({
      id: resource.id,
      enabled: false,
      archivedAt: expect.any(String),
    })
    await expect(
      discoverAgentResources(harness.deps, {
        issuer: 'http://localhost/api/auth',
        subject: 'archive-subject',
        identityId: 'archive-identity',
        protocolAgentId: 'archive-agent',
        hostId: 'archive-host',
      }),
    ).resolves.toEqual({ resources: [] })

    const [[connection], [intent], [request], [grant], [lease]] = await Promise.all([
      harness.db.select().from(resourceAccountConnection).where(eq(resourceAccountConnection.id, 'archive-connection')),
      harness.db.select().from(resourceConnectionIntent).where(eq(resourceConnectionIntent.id, 'archive-intent')),
      harness.db.select().from(agentAccessRequest).where(eq(agentAccessRequest.id, 'archive-request')),
      harness.db.select().from(agentAccessGrant).where(eq(agentAccessGrant.id, 'archive-grant')),
      harness.db.select().from(externalTokenLease).where(eq(externalTokenLease.id, 'archive-lease')),
    ])
    expect(connection).toMatchObject({ status: 'revoked', revokedAt: expect.any(Date) })
    expect(intent).toMatchObject({ status: 'cancelled', completedAt: expect.any(Date) })
    expect(request).toMatchObject({ status: 'denied', decidedAt: expect.any(Date) })
    expect(grant).toMatchObject({ status: 'revoked', revokedAt: expect.any(Date) })
    expect(lease).toMatchObject({ revokedAt: expect.any(Date) })
    const [archiveAudit] = await harness.db
      .select()
      .from(agentAuditEvent)
      .where(eq(agentAuditEvent.resourceId, resource.id))
    expect(archiveAudit).toMatchObject({
      action: 'api_resource.archived',
      controllerUserId: admin.id,
      metadata: { authorizationRecordsRevoked: true },
    })
    await expect(harness.deps.authorization.updateResource(resource.id, { enabled: true })).resolves.toBe(false)
    await expect(
      harness.deps.externalResources.createConnectionIntent({
        id: 'late-intent',
        stateHash: 'late-state',
        resourceId: resource.id,
        ownerUserId: admin.id,
        ownerOrganizationId: null,
        scopes: ['files:read'],
        encryptedPkceVerifier: 'late-verifier',
        returnTo: 'account-center',
        status: 'pending',
        expiresAt,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    ).resolves.toBeNull()
    await expect(
      harness.deps.externalResources.createAccessRequest({
        id: 'late-request',
        resourceId: resource.id,
        connectionId: null,
        agentIdentityId: 'archive-identity',
        bindingId: 'archive-binding',
        scopes: ['files:read'],
        reason: null,
        status: 'pending',
        approvalTokenHash: 'late-approval-hash',
        encryptedApprovalToken: 'late-approval',
        grantId: null,
        expiresAt,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    ).resolves.toBeNull()
    await expect(
      harness.deps.externalResources.createTokenLease({
        id: 'late-lease',
        grantId: 'archive-grant',
        requestId: 'archive-request',
        bindingId: 'archive-binding',
        encryptedAccessToken: 'late-access-token',
        tokenHash: 'late-token-hash',
        confirmationJkt: 'late-jkt',
        scopes: ['files:read'],
        expiresAt,
        revokedAt: null,
        createdAt: now,
      }),
    ).resolves.toBeNull()

    const restored = await harness.request(`/api/api-resources/${resource.id}/archival`, {
      method: 'DELETE',
      headers: { cookie },
    })

    expect(restored.status).toBe(200)
    await expect(restored.json()).resolves.toMatchObject({
      id: resource.id,
      enabled: false,
      archivedAt: null,
    })
    const [restoredConnection] = await harness.db
      .select()
      .from(resourceAccountConnection)
      .where(eq(resourceAccountConnection.id, 'archive-connection'))
    const [restoredGrant] = await harness.db
      .select()
      .from(agentAccessGrant)
      .where(eq(agentAccessGrant.id, 'archive-grant'))
    expect(restoredConnection.status).toBe('revoked')
    expect(restoredGrant.status).toBe('revoked')
    const audits = await harness.db.select().from(agentAuditEvent).where(eq(agentAuditEvent.resourceId, resource.id))
    expect(audits.map((event) => event.action)).toEqual(['api_resource.archived', 'api_resource.restored'])
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
