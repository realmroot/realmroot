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
  member,
  organizationRole,
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
    const response = await harness.request('/api/resource-servers')
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

    const response = await harness.request('/api/organizations/org-missing/roles', {
      headers: { cookie: memberCookie },
    })
    expect(response.status).toBe(403)
  })

  it('blocks direct Better Auth Role mutations outside the audited facade', async () => {
    const cookie = await signInAdmin(harness)
    for (const path of [
      '/api/auth/organization/create-role',
      '/api/auth/organization/update-role',
      '/api/auth/organization/delete-role',
      '/api/auth/organization/update-member-role',
    ]) {
      const response = await harness.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: '{}',
      })
      expect(response.status, path).toBe(404)
    }
  })

  it('never exposes the Realm sentinel as an Organization aggregate', async () => {
    const cookie = await signInAdmin(harness)
    for (const request of [
      harness.request('/api/organizations/org_platform', { headers: { cookie } }),
      harness.request('/api/organizations/org_platform/members', { headers: { cookie } }),
      harness.request('/api/organizations/org_platform/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ key: 'invalid', displayName: 'Invalid', scopes: [] }),
      }),
    ]) {
      const response = await request
      expect(response.status).toBe(404)
    }
  })

  it('atomically assigns the authenticated creator as Organization Owner [spec: admin-console/admin-create-organization]', async () => {
    const cookie = await signInAdmin(harness)
    const [admin] = await harness.db.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).limit(1)

    const response = await postJson(harness, cookie, '/api/organizations', {
      slug: 'owned-on-create',
      name: 'Owned On Create',
    })
    const created = (await response.json()) as { id: string }
    const memberships = await harness.db.select().from(member).where(eq(member.organizationId, created.id))

    expect(memberships).toHaveLength(1)
    expect(memberships[0]).toMatchObject({ userId: admin.id, role: 'owner' })

    await expect(
      harness.deps.authorization.createOrganization(
        {
          id: 'org-owner-rollback',
          slug: 'owner-rollback',
          name: 'Owner Rollback',
          displayName: null,
          logo: null,
          disabled: false,
          disabledReason: null,
        },
        {
          id: 'member-owner-rollback',
          userId: 'missing-user',
          roles: ['owner'],
          title: null,
        },
      ),
    ).rejects.toThrow()
    await expect(harness.deps.authorization.findOrganization('org-owner-rollback')).resolves.toBeNull()
  })

  it('returns User-owned audit events without an Organization filter', async () => {
    const adminCookie = await signInAdmin(harness)
    const personalUser = await createUser(harness, adminCookie, {
      email: 'personal-audit@example.com',
      username: 'personal-audit',
      displayName: 'Personal Audit',
      password: 'personal-audit-password-2026',
    })
    await harness.db.insert(agentAuditEvent).values({
      id: 'personal-audit-event',
      action: 'agent.identity_enrolled',
      result: 'allowed',
      realmOwned: false,
      ownerUserId: personalUser,
      occurredAt: new Date(),
    })
    const cookie = await signIn(harness, 'personal-audit@example.com', 'personal-audit-password-2026')

    const response = await harness.request('/api/realm/audit-events', { headers: { cookie } })

    expect(response.status).toBe(200)
    expect(((await response.json()) as { items: { id: string }[] }).items.map((event) => event.id)).toContain(
      'personal-audit-event',
    )
  })

  it('does not delete a dynamic Role referenced by a pending invitation', async () => {
    const cookie = await signInAdmin(harness)
    const organization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'invited-role', name: 'Invited Role' })
    ).json()) as { id: string }
    await postJson(harness, cookie, `/api/organizations/${organization.id}/roles`, {
      key: 'reviewer',
      displayName: 'Reviewer',
      scopes: [],
    })
    await postJson(harness, cookie, `/api/organizations/${organization.id}/invitations`, {
      email: 'reviewer@example.com',
      roles: ['reviewer'],
    })

    const response = await harness.request(`/api/organizations/${organization.id}/roles/reviewer`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(response.status).toBe(409)
    await expect(harness.deps.authorization.findOrganizationRole(organization.id, 'reviewer')).resolves.not.toBeNull()
  })

  it('rolls back a Role write when its audit insert fails', async () => {
    await signInAdmin(harness)
    const [admin] = await harness.db.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).limit(1)
    const organization = await harness.deps.authorization.createOrganization(
      {
        id: 'org-audit',
        slug: 'org-audit',
        name: 'Audit Organization',
        displayName: null,
        logo: null,
        disabled: false,
        disabledReason: null,
      },
      {
        id: 'org-audit-owner',
        userId: admin.id,
        roles: ['owner'],
        title: null,
      },
    )
    const occurredAt = new Date()
    await harness.db.insert(agentAuditEvent).values({
      id: 'duplicate-audit',
      action: 'seed',
      result: 'allowed',
      realmOwned: false,
      ownerOrganizationId: organization.id,
      occurredAt,
    })

    await expect(
      harness.deps.authorization.createOrganizationRole(
        organization.id,
        { key: 'operator', displayName: 'Operator', description: null, scopes: [] },
        { scope: [] },
        {
          id: 'duplicate-audit',
          action: 'organization.role.created',
          result: 'allowed',
          realmOwned: false,
          ownerUserId: null,
          ownerOrganizationId: organization.id,
          controllerUserId: null,
          subjectIssuer: null,
          subject: null,
          agentIdentityId: null,
          hostId: null,
          resourceId: null,
          resourceConnectionId: null,
          accessGrantId: null,
          scopes: null,
          reasonCode: null,
          metadata: null,
          occurredAt,
        },
      ),
    ).rejects.toThrow()
    expect(
      await harness.db.select().from(organizationRole).where(eq(organizationRole.organizationId, organization.id)),
    ).toEqual([])
  })

  it('rolls back an Agent grant decision when its audit insert fails', async () => {
    await signInAdmin(harness)
    const [admin] = await harness.db.select({ id: user.id }).from(user).where(eq(user.email, 'admin@example.com'))
    const now = new Date()
    const resource = await createResource(harness.deps, {
      identifier: 'atomic-agent-api',
      name: 'Atomic Agent API',
      resourceUrl: 'https://atomic-agent.example.com/api',
    })
    await harness.db.insert(agentHost).values({
      id: 'atomic-host',
      userId: admin.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agent).values({
      id: 'atomic-agent',
      name: 'Atomic Agent',
      userId: admin.id,
      hostId: 'atomic-host',
      status: 'active',
      publicKey: '{}',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentIdentity).values({
      id: 'atomic-identity',
      issuer: 'http://localhost/api/auth',
      subject: 'atomic-subject',
      name: 'Atomic identity',
      ownerUserId: admin.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentIdentityBinding).values({
      id: 'atomic-binding',
      agentIdentityId: 'atomic-identity',
      protocolAgentId: 'atomic-agent',
      status: 'active',
      boundAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessRequest).values({
      id: 'atomic-request',
      resourceId: resource.id,
      connectionId: null,
      agentIdentityId: 'atomic-identity',
      bindingId: 'atomic-binding',
      scopes: ['files:read'],
      status: 'pending',
      approvalTokenHash: 'atomic-approval-hash',
      encryptedApprovalToken: 'encrypted-approval',
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    })
    const audit = {
      id: 'duplicate-agent-audit',
      action: 'api_resource.access_decided',
      result: 'allowed',
      realmOwned: false,
      ownerUserId: admin.id,
      ownerOrganizationId: null,
      controllerUserId: admin.id,
      subjectIssuer: null,
      subject: null,
      agentIdentityId: 'atomic-identity',
      hostId: 'atomic-host',
      resourceId: resource.id,
      resourceConnectionId: null,
      accessGrantId: 'atomic-grant',
      scopes: ['files:read'],
      reasonCode: null,
      metadata: null,
      occurredAt: now,
    }
    await harness.db.insert(agentAuditEvent).values(audit)

    await expect(
      harness.deps.externalResources.approveAccessRequestWithAudit(
        {
          id: 'atomic-grant',
          resourceId: resource.id,
          connectionId: null,
          agentIdentityId: 'atomic-identity',
          scopes: ['files:read'],
          authorizationDetails: [],
          mode: 'ongoing',
          status: 'active',
          grantedByUserId: admin.id,
          expiresAt: null,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        'atomic-request',
        {
          status: 'approved',
          grantId: 'atomic-grant',
          connectionId: null,
          decidedAt: now,
          updatedAt: now,
        },
        audit,
      ),
    ).rejects.toThrow()
    await expect(
      harness.db
        .select({ id: agentAccessGrant.id })
        .from(agentAccessGrant)
        .where(eq(agentAccessGrant.id, 'atomic-grant')),
    ).resolves.toEqual([])
    await expect(
      harness.db
        .select({ status: agentAccessRequest.status })
        .from(agentAccessRequest)
        .where(eq(agentAccessRequest.id, 'atomic-request')),
    ).resolves.toEqual([{ status: 'pending' }])

    const deniedAudit = { ...audit, id: 'atomic-denied-audit', result: 'denied', accessGrantId: null }
    await expect(
      harness.deps.externalResources.decideAccessRequestWithAudit(
        'atomic-request',
        { status: 'denied', grantId: null, decidedAt: now, updatedAt: now },
        deniedAudit,
      ),
    ).resolves.not.toBeNull()
    await expect(
      harness.deps.externalResources.decideAccessRequestWithAudit(
        'atomic-request',
        { status: 'denied', grantId: null, decidedAt: new Date(), updatedAt: new Date() },
        { ...deniedAudit, id: 'atomic-duplicate-denied-audit' },
      ),
    ).resolves.toBeNull()
    await expect(
      harness.db
        .select({ id: agentAuditEvent.id })
        .from(agentAuditEvent)
        .where(eq(agentAuditEvent.id, 'atomic-duplicate-denied-audit')),
    ).resolves.toEqual([])

    await harness.db.insert(agentAccessGrant).values({
      id: 'atomic-revoke-grant',
      resourceId: resource.id,
      connectionId: null,
      agentIdentityId: 'atomic-identity',
      scopes: ['files:read'],
      authorizationDetails: [],
      mode: 'ongoing',
      status: 'active',
      grantedByUserId: admin.id,
      createdAt: now,
      updatedAt: now,
    })
    const revokedAudit = {
      ...audit,
      id: 'atomic-revoked-audit',
      action: 'api_resource.access_revoked',
      accessGrantId: 'atomic-revoke-grant',
    }
    await expect(
      harness.deps.externalResources.revokeGrantWithAudit('atomic-revoke-grant', [], now, revokedAudit),
    ).resolves.toBe(true)
    await expect(
      harness.deps.externalResources.revokeGrantWithAudit('atomic-revoke-grant', [], new Date(), {
        ...revokedAudit,
        id: 'atomic-duplicate-revoked-audit',
      }),
    ).resolves.toBe(false)
    await expect(
      harness.db
        .select({ id: agentAuditEvent.id })
        .from(agentAuditEvent)
        .where(eq(agentAuditEvent.id, 'atomic-duplicate-revoked-audit')),
    ).resolves.toEqual([])
  })

  it('allows only one concurrent last-Owner demotion', async () => {
    const cookie = await signInAdmin(harness)
    const organization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'owner-race', name: 'Owner Race' })
    ).json()) as { id: string }
    const creator = (await harness.deps.authorization.listMembers(organization.id, { limit: 10, offset: 0 })).items[0]
    const userId = await createUser(harness, cookie, {
      email: 'one@example.com',
      username: 'owner-one',
      displayName: 'Owner One',
      password: 'owner-one-password-2026',
    })
    const addedOwner = (await (
      await postJson(harness, cookie, `/api/organizations/${organization.id}/members`, {
        userId,
        roles: ['owner'],
      })
    ).json()) as { id: string }
    const members = [creator, addedOwner]

    const responses = await Promise.all(
      members.map((member) =>
        harness.request(`/api/organizations/${organization.id}/members/${member.id}/roles`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ roles: ['member'] }),
        }),
      ),
    )
    expect(responses.map((response) => response.status).sort()).toEqual([200, 412])
    const remaining = await harness.deps.authorization.listMembers(organization.id, { limit: 10, offset: 0 })
    expect(remaining.items.filter((member) => member.roles.includes('owner'))).toHaveLength(1)
  })

  it('allows only one concurrent last-Owner removal', async () => {
    const cookie = await signInAdmin(harness)
    const organization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'owner-delete-race', name: 'Owner Delete Race' })
    ).json()) as { id: string }
    const creator = (await harness.deps.authorization.listMembers(organization.id, { limit: 10, offset: 0 })).items[0]
    const userId = await createUser(harness, cookie, {
      email: 'delete-one@example.com',
      username: 'delete-one',
      displayName: 'Delete One',
      password: 'delete-one-password-2026',
    })
    const addedOwner = (await (
      await postJson(harness, cookie, `/api/organizations/${organization.id}/members`, {
        userId,
        roles: ['owner'],
      })
    ).json()) as { id: string }
    const members = [creator, addedOwner]

    const responses = await Promise.all(
      members.map((member) =>
        harness.request(`/api/organizations/${organization.id}/members/${member.id}`, {
          method: 'DELETE',
          headers: { cookie },
        }),
      ),
    )
    expect(responses.map((response) => response.status).sort()).toEqual([204, 412])
    const remaining = await harness.deps.authorization.listMembers(organization.id, { limit: 10, offset: 0 })
    expect(remaining.items.filter((member) => member.roles.includes('owner'))).toHaveLength(1)
  })

  it('prevents an Organization admin from granting itself Owner', async () => {
    const ownerCookie = await signInAdmin(harness)
    const organization = (await (
      await postJson(harness, ownerCookie, '/api/organizations', { slug: 'no-self-promotion', name: 'No Promotion' })
    ).json()) as { id: string }
    const userId = await createUser(harness, ownerCookie, {
      email: 'organization-admin@example.com',
      username: 'organization-admin',
      displayName: 'Organization Admin',
      password: 'organization-admin-password-2026',
    })
    const member = (await (
      await postJson(harness, ownerCookie, `/api/organizations/${organization.id}/members`, {
        userId,
        roles: ['admin'],
      })
    ).json()) as { id: string }
    const adminCookie = await signIn(harness, 'organization-admin@example.com', 'organization-admin-password-2026')

    const response = await harness.request(`/api/organizations/${organization.id}/members/${member.id}/roles`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ roles: ['owner'] }),
    })
    expect(response.status).toBe(403)
  })

  it('rejects an invalid api-resource payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/resource-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'missing identifier' }),
    })
    expect(response.status).toBe(400)
  })

  it('[spec: agent-identity/external-resource-rich-authorization-connection] persists opaque authorization detail templates through the management API', async () => {
    const cookie = await signInAdmin(harness)
    const now = new Date()
    const connector = await harness.deps.connectors.create({
      id: 'connector-rar-projects',
      slug: 'rar-projects',
      providerType: 'generic_oauth',
      providerId: 'rar-projects',
      displayName: 'RAR Projects',
      enabled: true,
      loginEnabled: false,
      clientId: 'rar-projects-client',
      clientSecret: 'rar-projects-secret',
      clientSecretContext: null,
      issuer: 'https://projects.example.com',
      authorizationEndpoint: 'https://projects.example.com/authorize',
      tokenEndpoint: 'https://projects.example.com/token',
      userInfoEndpoint: 'https://projects.example.com/userinfo',
      jwksEndpoint: 'https://projects.example.com/jwks',
      registrationEndpoint: null,
      revocationEndpoint: 'https://projects.example.com/revoke',
      registrationMode: 'manual',
      registrationAccessToken: null,
      registrationAccessTokenContext: null,
      scopes: ['openid', 'offline_access', 'projects:read'],
      attributeMapping: null,
      providerMetadata: {
        grant_types_supported: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
          'urn:ietf:params:oauth:grant-type:token-exchange',
        ],
        dpop_signing_alg_values_supported: ['ES256'],
        authorization_details_types_supported: ['project_access'],
        authorization_details_catalog_endpoint: 'https://projects.example.com/authorization-details',
        authorization_details_catalog_scope: 'authorization-details:read',
        authorization_details_catalog_version: 1,
        pushed_authorization_request_endpoint: 'https://projects.example.com/par',
      },
      createdAt: now,
      updatedAt: now,
    })
    harness.deps.externalHttp.fetch = async (request) => {
      if (request.url.endsWith('/.well-known/oauth-protected-resource/api')) {
        return Response.json({
          resource: 'https://projects.example.com/api',
          authorization_servers: [connector.issuer],
        })
      }
      return resourceOpenApiFetch(request)
    }
    const authorizationDetails = [
      { type: 'project_access', actions: ['read'], project_id: 'project-1', tenant: { id: 'tenant-1' } },
    ]

    const created = await postJson(harness, cookie, '/api/resource-servers', {
      identifier: 'rar-projects-api',
      name: 'RAR Projects API',
      resourceUrl: 'https://projects.example.com/api',
      connectorId: connector.id,
      authorizationDetails,
    })
    const resource = (await created.json()) as { id: string; authorizationDetails: unknown }
    expect(resource.authorizationDetails).toEqual(authorizationDetails)
    await expect(harness.db.select().from(apiResource).where(eq(apiResource.id, resource.id))).resolves.toMatchObject([
      { authorizationDetails },
    ])

    const updatedAuthorizationDetails = [
      { type: 'project_access', actions: ['read', 'comment'], project_id: 'project-1' },
    ]
    const updated = await harness.request(`/api/resource-servers/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ authorizationDetails: updatedAuthorizationDetails }),
    })
    expect(updated.status, await updated.clone().text()).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({ authorizationDetails: updatedAuthorizationDetails })

    const unsupported = await harness.request(`/api/resource-servers/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ authorizationDetails: [{ type: 'unknown_context' }] }),
    })
    expect(unsupported.status).toBe(400)
  })

  it('rejects an undiscoverable enabled resource but saves a disabled draft', async () => {
    const cookie = await signInAdmin(harness)
    harness.deps.externalHttp.fetch = async () => new Response('<html></html>')
    const input = {
      identifier: 'projects-api',
      name: 'Projects API',
      resourceUrl: 'https://projects.example.com/api',
    }

    const enabled = await harness.request('/api/resource-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(input),
    })
    expect(enabled.status).toBe(400)

    const draft = await postJson(harness, cookie, '/api/resource-servers', { ...input, enabled: false })
    const resource = (await draft.json()) as { id: string; enabled: boolean }
    expect(resource.enabled).toBe(false)

    const enable = await harness.request(`/api/resource-servers/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ enabled: true }),
    })
    expect(enable.status).toBe(400)
  })

  it('requires authorization reconfiguration when an external resource URL changes [spec: agent-identity/external-api-resource-reconfiguration]', async () => {
    const cookie = await signInAdmin(harness)
    const now = new Date()
    const connector = await harness.deps.connectors.create({
      id: 'connector-projects',
      slug: 'projects',
      providerType: 'generic_oauth',
      providerId: 'projects',
      displayName: 'Projects OIDC',
      enabled: true,
      loginEnabled: false,
      clientId: 'projects-client',
      clientSecret: 'projects-secret',
      clientSecretContext: null,
      issuer: 'https://projects.example.com',
      authorizationEndpoint: 'https://projects.example.com/authorize',
      tokenEndpoint: 'https://projects.example.com/token',
      userInfoEndpoint: 'https://projects.example.com/userinfo',
      jwksEndpoint: 'https://projects.example.com/jwks',
      registrationEndpoint: null,
      revocationEndpoint: 'https://projects.example.com/revoke',
      registrationMode: 'manual',
      registrationAccessToken: null,
      registrationAccessTokenContext: null,
      scopes: ['openid', 'offline_access'],
      attributeMapping: null,
      providerMetadata: {
        grant_types_supported: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
          'urn:ietf:params:oauth:grant-type:token-exchange',
        ],
        dpop_signing_alg_values_supported: ['ES256'],
      },
      createdAt: now,
      updatedAt: now,
    })
    harness.deps.externalHttp.fetch = async (request) => {
      if (request.url.endsWith('/.well-known/oauth-protected-resource/api')) {
        return Response.json({
          resource: request.url.includes('new-projects')
            ? 'https://new-projects.example.com/api'
            : 'https://projects.example.com/api',
          authorization_servers: [
            request.url.includes('new-projects') ? 'https://different.example.com' : connector.issuer,
          ],
        })
      }
      return resourceOpenApiFetch(request)
    }
    const resource = await createResource(harness.deps, {
      identifier: 'projects-api',
      name: 'Projects API',
      resourceUrl: 'https://projects.example.com/api',
      connectorId: connector.id,
    })

    const response = await harness.request(`/api/resource-servers/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ resourceUrl: 'https://new-projects.example.com/api' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'External API resource authorization server does not match the selected OIDC connector.' },
    })
  })

  it('runs the API resource lifecycle through real SQL [spec: management-api/management-restish-api-resource-crud]', async () => {
    const cookie = await signInAdmin(harness)

    const resource = (await (
      await postJson(harness, cookie, '/api/resource-servers', {
        identifier: 'https://api.example.com',
        name: 'Example API',
        resourceUrl: 'https://api.example.com',
      })
    ).json()) as { id: string }

    const list = await harness.request('/api/resource-servers', { headers: { cookie } })
    expect(((await list.json()) as { items: unknown[] }).items.length).toBe(2)

    const fetched = await harness.request(`/api/resource-servers/${resource.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)

    const patched = await harness.request(`/api/resource-servers/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Renamed API' }),
    })
    expect(((await patched.json()) as { name: string }).name).toBe('Renamed API')

    expect(
      (
        await harness.request(`/api/resource-servers/${resource.id}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
  })

  it('[spec: management-api/management-api-resource-delete-conflict] preserves resources with authorization history', async () => {
    const cookie = await signInAdmin(harness)
    const resource = (await (
      await postJson(harness, cookie, '/api/resource-servers', {
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

    const response = await harness.request(`/api/resource-servers/${resource.id}`, {
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

  it('changes an OIDC connector only while the resource is unarchived [spec: management-api/management-api-resource-archival]', async () => {
    const cookie = await signInAdmin(harness)
    const now = new Date()
    const connector = await harness.deps.connectors.create({
      id: 'connector-conditional',
      slug: 'conditional',
      providerType: 'generic_oauth',
      providerId: 'conditional',
      displayName: 'Conditional OIDC',
      enabled: true,
      loginEnabled: false,
      clientId: 'conditional-client',
      clientSecret: 'conditional-secret',
      clientSecretContext: null,
      issuer: 'https://conditional.example.com',
      authorizationEndpoint: 'https://conditional.example.com/authorize',
      tokenEndpoint: 'https://conditional.example.com/token',
      userInfoEndpoint: 'https://conditional.example.com/userinfo',
      jwksEndpoint: 'https://conditional.example.com/jwks',
      registrationEndpoint: null,
      revocationEndpoint: 'https://conditional.example.com/revoke',
      registrationMode: 'manual',
      registrationAccessToken: null,
      registrationAccessTokenContext: null,
      scopes: ['openid', 'offline_access'],
      attributeMapping: null,
      providerMetadata: {
        grant_types_supported: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
          'urn:ietf:params:oauth:grant-type:token-exchange',
        ],
        dpop_signing_alg_values_supported: ['ES256'],
      },
      createdAt: now,
      updatedAt: now,
    })
    harness.deps.externalHttp.fetch = async (request) => {
      if (request.url.endsWith('/.well-known/oauth-protected-resource/api')) {
        return Response.json({
          resource: 'https://conditional.example.com/api',
          authorization_servers: [connector.issuer],
        })
      }
      return resourceOpenApiFetch(request)
    }
    const resource = await createResource(harness.deps, {
      identifier: 'conditional-external',
      name: 'Conditional external API',
      resourceUrl: 'https://conditional.example.com/api',
      connectorId: connector.id,
    })

    const archived = await harness.request(`/api/resource-servers/${resource.id}/archival`, {
      method: 'PUT',
      headers: { cookie },
    })
    expect(archived.status).toBe(200)
    const lateAssociation = await harness.request(`/api/resource-servers/${resource.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ connectorId: connector.id }),
    })
    expect(lateAssociation.status).toBe(400)
    await expect(harness.deps.authorization.findResource(resource.id)).resolves.toMatchObject({
      connectorId: connector.id,
      archivedAt: expect.any(String),
    })
  })

  it('[spec: management-api/management-api-resource-archival] archives and restores without reviving authorization', async () => {
    const cookie = await signInAdmin(harness)
    const resource = (await (
      await postJson(harness, cookie, '/api/resource-servers', {
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
      initiatedByUserId: admin.id,
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

    const archived = await harness.request(`/api/resource-servers/${resource.id}/archival`, {
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
    ).resolves.toMatchObject({
      resources: [expect.objectContaining({ id: 'res_realmroot', identifier: 'realmroot' })],
    })

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
        initiatedByUserId: admin.id,
        scopes: ['files:read'],
        authorizationDetails: [],
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
        authorizationDetails: [],
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
        authorizationDetails: [],
        expiresAt,
        revokedAt: null,
        createdAt: now,
      }),
    ).resolves.toBeNull()

    const restored = await harness.request(`/api/resource-servers/${resource.id}/archival`, {
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
    expect(((await list.json()) as { organizations: Array<{ id: string }> }).organizations).toContainEqual(
      expect.objectContaining({ id: organization.id }),
    )

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
        roles: ['member'],
      })
    ).json()) as { id: string }
    const members = await harness.request(`/api/organizations/${organization.id}/members`, {
      headers: { cookie },
    })
    expect(((await members.json()) as { members: unknown[] }).members.length).toBe(2)

    const role = await postJson(harness, cookie, `/api/organizations/${organization.id}/roles`, {
      key: 'org-lead',
      displayName: 'Org Lead',
      description: null,
      scopes: [],
    })
    expect(role.status).toBe(201)

    const patchedMember = await harness.request(`/api/organizations/${organization.id}/members/${member.id}/roles`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ roles: ['member', 'org-lead'] }),
    })
    expect(((await patchedMember.json()) as { roles: string[] }).roles).toEqual(['member', 'org-lead'])

    const invitation = (await (
      await postJson(harness, cookie, `/api/organizations/${organization.id}/invitations`, {
        email: 'invitee@example.com',
        roles: ['member'],
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
})
