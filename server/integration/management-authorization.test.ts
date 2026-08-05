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
  webhookDeliveryRequest,
} from '@server/db/schema'
import { createResource } from '@server/usecases/authorization'
import { discoverAgentResources } from '@server/usecases/external-resources'
import type { AgentAuditEventRecord } from '@server/usecases/ports'
import { eq } from 'drizzle-orm'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
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

    const response = await harness.request('/api/access/roles', { headers: { cookie: memberCookie } })
    expect(response.status).toBe(403)
  })

  it('atomically rolls back management mutations when their audit record is rejected', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'atomic-audit@example.com',
      username: 'atomicaudit',
      displayName: 'Atomic Audit',
      password: 'atomic-audit-password-2026',
    })
    const organization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'atomic-audit', name: 'Atomic Audit' })
    ).json()) as { id: string }
    const role = (await (
      await postJson(harness, cookie, '/api/access/roles', { key: 'atomic-audit', name: 'Atomic Audit' })
    ).json()) as { id: string }
    const application = (await (
      await postJson(harness, cookie, '/api/applications', {
        name: 'Atomic Audit Client',
        clientType: 'confidential_web',
        redirectUris: ['https://atomic-audit.example.com/callback'],
      })
    ).json()) as { id: string }

    await expect(
      harness.deps.authorization.createInvitation(
        {
          id: 'atomic-invitation',
          organizationId: organization.id,
          email: 'invitee@example.com',
          role: 'member',
          inviterId: userId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        invalidDualOwnerAudit('atomic-invitation-audit'),
      ),
    ).rejects.toThrow('agent_audit_event has multiple management owners')
    await expect(harness.deps.authorization.findInvitation('atomic-invitation')).resolves.toBeNull()

    await expect(
      harness.deps.authorization.createRoleAssignment(
        {
          id: 'atomic-assignment',
          roleId: role.id,
          subjectType: 'user',
          subjectId: userId,
          organizationId: organization.id,
          assignedByUserId: userId,
          expiresAt: null,
        },
        invalidDualOwnerAudit('atomic-assignment-audit'),
      ),
    ).rejects.toThrow('agent_audit_event has multiple management owners')
    await expect(harness.deps.authorization.findRoleAssignment('atomic-assignment')).resolves.toBeNull()

    const now = new Date()
    await expect(
      harness.deps.webhooks.createEndpoint(
        {
          id: 'atomic-webhook',
          url: 'https://atomic-audit.example.com/webhook',
          events: ['user.created'],
          enabled: true,
          organizationId: organization.id,
          signingSecret: 'sealed-secret',
          secretPrefix: 'whsec_atomic',
          createdByUserId: userId,
          createdAt: now,
          updatedAt: now,
        },
        invalidDualOwnerAudit('atomic-webhook-audit'),
      ),
    ).rejects.toThrow('agent_audit_event has multiple management owners')
    await expect(harness.deps.webhooks.findEndpoint('atomic-webhook')).resolves.toBeNull()

    const persistedWebhook = (await (
      await postJson(harness, cookie, '/api/webhooks', {
        url: 'https://atomic-audit.example.com/persisted-webhook',
        events: ['user.created'],
        enabled: true,
        organizationId: organization.id,
      })
    ).json()) as { endpoint: { id: string } }
    const webhookBefore = await harness.deps.webhooks.findEndpoint(persistedWebhook.endpoint.id)
    expect(webhookBefore).not.toBeNull()
    await expect(
      harness.deps.webhooks.updateEndpointWithAudit(
        persistedWebhook.endpoint.id,
        {
          signingSecret: 'replacement-sealed-secret',
          secretPrefix: 'whsec_replacement',
          updatedAt: new Date(),
        },
        invalidDualOwnerAudit('atomic-webhook-rotation-audit'),
      ),
    ).rejects.toThrow('agent_audit_event has multiple management owners')
    const webhookAfter = await harness.deps.webhooks.findEndpoint(persistedWebhook.endpoint.id)
    expect(webhookAfter).toEqual(webhookBefore)

    const applicationTemplate = await harness.deps.applications.findById(application.id)
    expect(applicationTemplate).not.toBeNull()
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...applicationInput } = applicationTemplate!
    await expect(
      harness.deps.applications.create(
        {
          application: {
            ...applicationInput,
            id: 'atomic-application',
            clientId: 'atomic-application-client',
            slug: 'atomic-application',
            name: 'Atomic Application',
          },
          clientSecret: null,
        },
        invalidDualOwnerAudit('atomic-application-audit'),
      ),
    ).rejects.toThrow('agent_audit_event has multiple management owners')
    await expect(harness.deps.applications.findById('atomic-application')).resolves.toBeNull()

    const secretsBefore = await harness.deps.applications.listSecrets(application.id, { limit: 20, offset: 0 })
    await expect(
      harness.deps.applications.rotateSecret(
        {
          applicationId: application.id,
          secret: {
            id: 'atomic-secret',
            version: 0,
            secretHash: 'replacement-secret-hash',
            secretPrefix: 'replacement',
            status: 'active',
            createdByUserId: userId,
          },
        },
        invalidDualOwnerAudit('atomic-secret-audit'),
      ),
    ).rejects.toThrow('agent_audit_event has multiple management owners')
    const secretsAfter = await harness.deps.applications.listSecrets(application.id, { limit: 20, offset: 0 })
    expect(secretsAfter).toEqual(secretsBefore)
  })

  it('enforces one owner boundary for Realm, Organization, and Account DPoP management [spec: management-api/management-single-authorization-boundary]', async () => {
    const adminCookie = await signInAdmin(harness)
    const ownerUserId = await createUser(harness, adminCookie, {
      email: 'agent-owner@example.com',
      username: 'agentowner',
      displayName: 'Agent Owner',
      password: 'agent-owner-password-2026',
    })
    const ownedOrganization = (await (
      await postJson(harness, adminCookie, '/api/organizations', { slug: 'agent-owned', name: 'Agent Owned' })
    ).json()) as { id: string }
    const otherOrganization = (await (
      await postJson(harness, adminCookie, '/api/organizations', { slug: 'agent-other', name: 'Agent Other' })
    ).json()) as { id: string }
    await postJson(harness, adminCookie, `/api/organizations/${ownedOrganization.id}/members`, {
      userId: ownerUserId,
      role: 'developer',
    })
    const currentConsolePolicy = await harness.request('/api/realm/developer-console-access-policy', {
      headers: { cookie: adminCookie },
    })
    await harness.request('/api/realm/developer-console-access-policy', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
        'If-Match': currentConsolePolicy.headers.get('ETag')!,
      },
      body: JSON.stringify({
        mode: 'all_organizations',
        eligibleAccessLevels: ['owner', 'admin', 'developer'],
        selectedOrganizationIds: [],
      }),
    })

    const now = new Date()
    await harness.db.insert(agentHost).values({
      id: 'boundary-host',
      name: 'Boundary host',
      userId: ownerUserId,
      publicKey: 'boundary-host-public-key',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agent).values({
      id: 'boundary-protocol-agent',
      name: 'Boundary protocol Agent',
      userId: ownerUserId,
      hostId: 'boundary-host',
      status: 'active',
      mode: 'delegated',
      publicKey: 'boundary-protocol-public-key',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentIdentity).values([
      {
        id: 'boundary-principal',
        issuer: 'http://localhost/api/auth',
        subject: 'boundary-principal-subject',
        name: 'Boundary Principal',
        ownerUserId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'personal-agent',
        issuer: 'http://localhost/api/auth',
        subject: 'personal-agent-subject',
        name: 'Personal Agent',
        ownerUserId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'owned-organization-agent',
        issuer: 'http://localhost/api/auth',
        subject: 'owned-organization-agent-subject',
        name: 'Owned Organization Agent',
        ownerOrganizationId: ownedOrganization.id,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'other-organization-agent',
        issuer: 'http://localhost/api/auth',
        subject: 'other-organization-agent-subject',
        name: 'Other Organization Agent',
        ownerOrganizationId: otherOrganization.id,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ])
    await harness.db.insert(agentIdentityBinding).values({
      id: 'boundary-binding',
      agentIdentityId: 'boundary-principal',
      protocolAgentId: 'boundary-protocol-agent',
      status: 'active',
      boundAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAuditEvent).values([
      {
        id: 'personal-boundary-event',
        action: 'agent.boundary.test',
        result: 'allowed',
        agentIdentityId: 'personal-agent',
        ownerUserId,
        occurredAt: now,
      },
      {
        id: 'organization-boundary-event',
        action: 'agent.boundary.test',
        result: 'allowed',
        agentIdentityId: 'owned-organization-agent',
        ownerOrganizationId: ownedOrganization.id,
        occurredAt: now,
      },
    ])

    const account = await authorityClient(harness, {
      authority: 'account',
      id: ownerUserId,
      scopes: ['agents:read', 'agents:write', 'audit-events:read', 'roles:read', 'users:read', 'resource-servers:read'],
    })
    const selfServiceResources = await harness.request('/api/agent/resource-servers?limit=10&offset=0', {
      headers: await account.headers('GET', '/api/agent/resource-servers?limit=10&offset=0'),
    })
    expect(selfServiceResources.status, await selfServiceResources.clone().text()).toBe(200)
    const selfServiceResourceBody = (await selfServiceResources.json()) as {
      items: Array<{ links: { self: string } }>
    }
    expect(selfServiceResourceBody.items.map((item) => item.links.self)).toEqual([
      expect.stringContaining('/api/agent/resource-servers/'),
    ])
    expect(
      (
        await harness.request('/api/resource-servers', {
          headers: await account.headers('GET', '/api/resource-servers'),
        })
      ).status,
    ).toBe(403)
    const accountInventory = await harness.request('/api/agents?limit=10&offset=0', {
      headers: await account.headers('GET', '/api/agents?limit=10&offset=0'),
    })
    expect(accountInventory.status, await accountInventory.clone().text()).toBe(200)
    await expect(accountInventory.json()).resolves.toMatchObject({
      items: [{ id: 'personal-agent' }, { id: 'boundary-principal' }],
      pagination: { total: 2 },
    })
    expect(
      (
        await harness.request('/api/agents/owned-organization-agent', {
          headers: await account.headers('GET', '/api/agents/owned-organization-agent'),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await harness.request('/api/users', {
          headers: await account.headers('GET', '/api/users'),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await harness.request('/api/access/assignments', {
          headers: await account.headers('GET', '/api/access/assignments'),
        })
      ).status,
    ).toBe(403)
    const accountAudit = await harness.request('/api/realm/audit-events?limit=10&offset=0', {
      headers: await account.headers('GET', '/api/realm/audit-events?limit=10&offset=0'),
    })
    await expect(accountAudit.json()).resolves.toMatchObject({
      items: [{ id: 'personal-boundary-event' }],
      pagination: { total: 1 },
    })

    const ownerCookie = await signIn(harness, 'agent-owner@example.com', 'agent-owner-password-2026')
    const ownerInventory = await harness.request('/api/agents?limit=10&offset=0', {
      headers: { cookie: ownerCookie },
    })
    expect(ownerInventory.status, await ownerInventory.clone().text()).toBe(200)
    await expect(ownerInventory.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'personal-agent' }),
        expect.objectContaining({ id: 'boundary-principal' }),
        expect.objectContaining({ id: 'owned-organization-agent' }),
      ]),
      pagination: { total: 3 },
    })

    const organization = await authorityClient(harness, {
      authority: 'organization',
      id: ownedOrganization.id,
      scopes: ['agents:read', 'agents:write', 'audit-events:read', 'resource-servers:write'],
    })
    const organizationInventory = await harness.request('/api/agents?limit=10&offset=0', {
      headers: await organization.headers('GET', '/api/agents?limit=10&offset=0'),
    })
    await expect(organizationInventory.json()).resolves.toMatchObject({
      items: [{ id: 'owned-organization-agent' }],
      pagination: { total: 1 },
    })
    expect(
      (
        await harness.request('/api/agents/other-organization-agent/retirement', {
          method: 'PUT',
          headers: await organization.headers('PUT', '/api/agents/other-organization-agent/retirement'),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await harness.request('/api/agents/owned-organization-agent/retirement', {
          method: 'PUT',
          headers: await organization.headers('PUT', '/api/agents/owned-organization-agent/retirement'),
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await harness.request('/api/access/requests/nonexistent/decision', {
          method: 'PUT',
          headers: {
            ...(await organization.headers('PUT', '/api/access/requests/nonexistent/decision')),
            'content-type': 'application/json',
          },
          body: JSON.stringify({ decision: 'deny' }),
        })
      ).status,
    ).toBe(403)

    const organizationResource = await createResource(harness.deps, {
      identifier: 'organization-audit-target',
      name: 'Organization audit target',
      resourceUrl: 'https://organization-audit.example/api',
      enabled: false,
      ownerOrganizationId: ownedOrganization.id,
    })
    const archivePath = `/api/resource-servers/${organizationResource.id}/archival`
    const archived = await harness.request(archivePath, {
      method: 'PUT',
      headers: await organization.headers('PUT', archivePath),
    })
    expect(archived.status, await archived.clone().text()).toBe(200)

    const organizationAudit = await harness.request('/api/realm/audit-events?limit=10&offset=0', {
      headers: await organization.headers('GET', '/api/realm/audit-events?limit=10&offset=0'),
    })
    await expect(organizationAudit.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ action: 'api_resource.archived', resourceId: organizationResource.id }),
      ]),
    })
    const accountAuditAfterOrganizationMutation = await harness.request('/api/realm/audit-events?limit=20&offset=0', {
      headers: await account.headers('GET', '/api/realm/audit-events?limit=20&offset=0'),
    })
    const accountAuditBody = (await accountAuditAfterOrganizationMutation.json()) as {
      items: Array<{ resourceId: string | null }>
    }
    expect(accountAuditBody.items.some((event) => event.resourceId === organizationResource.id)).toBe(false)

    const realm = await authorityClient(harness, {
      authority: 'realm',
      id: 'realm',
      scopes: ['agents:read'],
    })
    const realmFirstPage = await harness.request('/api/agents?limit=2&offset=0', {
      headers: await realm.headers('GET', '/api/agents?limit=2&offset=0'),
    })
    await expect(realmFirstPage.json()).resolves.toMatchObject({
      items: [{ id: expect.any(String) }, { id: expect.any(String) }],
      pagination: { limit: 2, offset: 0, total: 4, hasMore: true, nextOffset: 2 },
    })
    const realmSecondPage = await harness.request('/api/agents?limit=2&offset=2', {
      headers: await realm.headers('GET', '/api/agents?limit=2&offset=2'),
    })
    await expect(realmSecondPage.json()).resolves.toMatchObject({
      items: [{ id: expect.any(String) }, { id: expect.any(String) }],
      pagination: { limit: 2, offset: 2, total: 4, hasMore: false, nextOffset: null },
    })

    const retiredAudit = await harness.db
      .select()
      .from(agentAuditEvent)
      .where(eq(agentAuditEvent.agentIdentityId, 'owned-organization-agent'))
    expect(retiredAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'agent.identity_retired',
          controllerUserId: null,
          metadata: expect.objectContaining({
            actor: expect.objectContaining({ identityId: 'boundary-principal', authority: expect.any(Object) }),
          }),
        }),
      ]),
    )
  })

  it('constrains Organization Console inventory and exposes governed Agent detail [spec: admin-console/organization-console-resource-boundary] [spec: admin-console/admin-agent-governance-detail] [spec: management-api/management-canonical-authority-inventory] [spec: agent-identity/agent-public-resource-model]', async () => {
    const adminCookie = await signInAdmin(harness)
    const developerId = await createUser(harness, adminCookie, {
      email: 'developer@example.com',
      username: 'developer',
      displayName: 'Developer',
      password: 'developer-password-2026',
    })
    const ownedOrganization = (await (
      await postJson(harness, adminCookie, '/api/organizations', { slug: 'owned-team', name: 'Owned Team' })
    ).json()) as { id: string }
    const otherOrganization = (await (
      await postJson(harness, adminCookie, '/api/organizations', { slug: 'other-team', name: 'Other Team' })
    ).json()) as { id: string }
    await postJson(harness, adminCookie, `/api/organizations/${ownedOrganization.id}/members`, {
      userId: developerId,
      role: 'developer',
    })
    const currentConsolePolicy = await harness.request('/api/realm/developer-console-access-policy', {
      headers: { cookie: adminCookie },
    })
    await harness.request('/api/realm/developer-console-access-policy', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
        'If-Match': currentConsolePolicy.headers.get('ETag')!,
      },
      body: JSON.stringify({
        mode: 'all_organizations',
        eligibleAccessLevels: ['owner', 'admin', 'developer'],
        selectedOrganizationIds: [],
      }),
    })
    const ownedWebhook = (await (
      await postJson(harness, adminCookie, '/api/webhooks', {
        url: 'https://owned.example.com/webhooks',
        events: ['session.revoked'],
        enabled: true,
        organizationId: ownedOrganization.id,
      })
    ).json()) as { endpoint: { id: string } }
    const otherWebhook = (await (
      await postJson(harness, adminCookie, '/api/webhooks', {
        url: 'https://other.example.com/webhooks',
        events: ['session.revoked'],
        enabled: true,
        organizationId: otherOrganization.id,
      })
    ).json()) as { endpoint: { id: string } }

    const ownedApplication = (await (
      await postJson(harness, adminCookie, '/api/applications', {
        name: 'Owned Portal',
        clientType: 'public_spa',
        redirectUris: ['https://owned.example.com/callback'],
        ownerOrganizationId: ownedOrganization.id,
      })
    ).json()) as { id: string }
    const otherApplication = (await (
      await postJson(harness, adminCookie, '/api/applications', {
        name: 'Other Portal',
        clientType: 'public_spa',
        redirectUris: ['https://other.example.com/callback'],
        ownerOrganizationId: otherOrganization.id,
      })
    ).json()) as { id: string }
    const ownedResource = (await (
      await postJson(harness, adminCookie, '/api/resource-servers', {
        identifier: 'owned-api',
        name: 'Owned API',
        resourceUrl: 'https://owned.example.com/api',
        enabled: false,
        ownerOrganizationId: ownedOrganization.id,
      })
    ).json()) as { id: string }
    const otherResource = (await (
      await postJson(harness, adminCookie, '/api/resource-servers', {
        identifier: 'other-api',
        name: 'Other API',
        resourceUrl: 'https://other.example.com/api',
        enabled: false,
        ownerOrganizationId: otherOrganization.id,
      })
    ).json()) as { id: string }
    const now = new Date()
    await harness.db.insert(webhookDeliveryRequest).values([
      {
        id: 'owned-webhook-request',
        endpointId: ownedWebhook.endpoint.id,
        event: 'session.revoked',
        status: 'failed',
        attemptCount: 1,
        httpStatus: 503,
        error: 'Unavailable',
        requestBody: '{"id":"evt_owned","type":"session.revoked","createdAt":"2026-01-01T00:00:00.000Z","data":{}}',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'other-webhook-request',
        endpointId: otherWebhook.endpoint.id,
        event: 'session.revoked',
        status: 'failed',
        attemptCount: 1,
        httpStatus: 503,
        error: 'Unavailable',
        requestBody: '{"id":"evt_other","type":"session.revoked","createdAt":"2026-01-01T00:00:00.000Z","data":{}}',
        createdAt: now,
        updatedAt: now,
      },
    ])
    await harness.db.insert(agentIdentity).values([
      {
        id: 'owned-agent',
        issuer: 'http://localhost/api/auth',
        subject: 'owned-agent-subject',
        name: 'Owned Agent',
        ownerOrganizationId: ownedOrganization.id,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'other-agent',
        issuer: 'http://localhost/api/auth',
        subject: 'other-agent-subject',
        name: 'Other Agent',
        ownerOrganizationId: otherOrganization.id,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ])
    await harness.db.insert(agentHost).values({
      id: 'owned-host',
      name: 'Developer laptop',
      userId: developerId,
      publicKey: 'public-key-material',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agent).values({
      id: 'owned-protocol-agent',
      name: 'Protocol registration',
      userId: developerId,
      hostId: 'owned-host',
      status: 'active',
      mode: 'delegated',
      publicKey: 'protocol-public-key-material',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentIdentityBinding).values({
      id: 'owned-agent-binding',
      agentIdentityId: 'owned-agent',
      protocolAgentId: 'owned-protocol-agent',
      status: 'active',
      boundAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessRequest).values({
      id: 'owned-access-request',
      resourceId: ownedResource.id,
      agentIdentityId: 'owned-agent',
      bindingId: 'owned-agent-binding',
      scopes: ['orders:read'],
      reason: 'Prepare a report',
      status: 'pending',
      approvalTokenHash: 'owned-approval-token-hash',
      encryptedApprovalToken: 'owned-encrypted-approval-token',
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessGrant).values({
      id: 'owned-access-grant',
      resourceId: ownedResource.id,
      agentIdentityId: 'owned-agent',
      scopes: ['orders:read'],
      mode: 'persistent',
      status: 'active',
      grantedByUserId: developerId,
      createdAt: now,
      updatedAt: now,
    })
    const agentRole = (await (
      await postJson(harness, adminCookie, '/api/access/roles', {
        key: 'report.reader',
        name: 'Report reader',
      })
    ).json()) as { id: string }
    await postJson(harness, adminCookie, '/api/access/assignments', {
      roleId: agentRole.id,
      subjectType: 'agent',
      subjectId: 'owned-agent',
      organizationId: ownedOrganization.id,
    })
    await harness.db.insert(agentAuditEvent).values([
      {
        id: 'owned-agent-event',
        action: 'agent.access.requested',
        result: 'pending',
        agentIdentityId: 'owned-agent',
        ownerOrganizationId: ownedOrganization.id,
        occurredAt: now,
      },
      {
        id: 'other-agent-event',
        action: 'agent.access.requested',
        result: 'pending',
        agentIdentityId: 'other-agent',
        ownerOrganizationId: otherOrganization.id,
        occurredAt: now,
      },
    ])
    const developerCookie = await signIn(harness, 'developer@example.com', 'developer-password-2026')

    const webhookInventory = await harness.request('/api/webhooks', {
      headers: { cookie: developerCookie },
    })
    expect(webhookInventory.status).toBe(200)
    await expect(webhookInventory.json()).resolves.toMatchObject({
      endpoints: [{ id: ownedWebhook.endpoint.id, organizationId: ownedOrganization.id }],
      pagination: { total: 1 },
    })
    const webhookRequests = await harness.request(`/api/webhooks/${ownedWebhook.endpoint.id}/deliveries`, {
      headers: { cookie: developerCookie },
    })
    await expect(webhookRequests.json()).resolves.toMatchObject({
      requests: [{ id: 'owned-webhook-request', organizationId: ownedOrganization.id }],
      pagination: { total: 1 },
    })
    expect(
      (
        await harness.request(`/api/webhooks/${otherWebhook.endpoint.id}`, {
          headers: { cookie: developerCookie },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await harness.request('/api/webhooks', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: developerCookie },
          body: JSON.stringify({
            url: 'https://forbidden.example.com/webhooks',
            events: ['session.revoked'],
            enabled: true,
            organizationId: otherOrganization.id,
          }),
        })
      ).status,
    ).toBe(403)

    const applicationsResponse = await harness.request('/api/applications', { headers: { cookie: developerCookie } })
    expect(applicationsResponse.status).toBe(200)
    await expect(applicationsResponse.json()).resolves.toMatchObject({
      applications: [{ id: ownedApplication.id, ownerOrganizationId: ownedOrganization.id }],
      pagination: { total: 1 },
    })
    const resourcesResponse = await harness.request('/api/resource-servers', { headers: { cookie: developerCookie } })
    expect(resourcesResponse.status).toBe(200)
    await expect(resourcesResponse.json()).resolves.toMatchObject({
      items: [{ id: ownedResource.id, ownerOrganizationId: ownedOrganization.id }],
      pagination: { total: 1 },
    })
    const agentsResponse = await harness.request('/api/agents', { headers: { cookie: developerCookie } })
    expect(agentsResponse.status).toBe(200)
    await expect(agentsResponse.json()).resolves.toMatchObject({
      items: [
        {
          id: 'owned-agent',
          homeSpace: { type: 'organization', organizationId: ownedOrganization.id },
          installationCount: 1,
          roleCount: 1,
          pendingRequestCount: 1,
          activeGrantCount: 1,
        },
      ],
      pagination: { total: 1 },
    })
    const agentDetail = await harness.request('/api/agents/owned-agent', { headers: { cookie: developerCookie } })
    expect(agentDetail.status).toBe(200)
    await expect(agentDetail.json()).resolves.toMatchObject({
      agent: { id: 'owned-agent', installationCount: 1, roleCount: 1, pendingRequestCount: 1, activeGrantCount: 1 },
    })
    const hostsResponse = await harness.request('/api/agents/owned-agent/installations', {
      headers: { cookie: developerCookie },
    })
    expect(hostsResponse.status).toBe(200)
    const hostInventory = (await hostsResponse.json()) as { items: Array<Record<string, unknown>> }
    expect(hostInventory.items).toEqual([
      expect.objectContaining({
        id: 'owned-agent-binding',
        name: 'Developer laptop',
        credentialType: 'public_key',
      }),
    ])
    expect(hostInventory.items[0]).not.toHaveProperty('hostId')
    expect(hostInventory.items[0]).not.toHaveProperty('hostStatus')
    expect(hostInventory.items[0]).not.toHaveProperty('publicKey')
    await expect(
      (
        await harness.request('/api/access/assignments?subjectType=agent&subjectId=owned-agent&status=active', {
          headers: { cookie: developerCookie },
        })
      ).json(),
    ).resolves.toMatchObject({ assignments: [{ roleId: agentRole.id, subjectId: 'owned-agent' }] })
    const accessRequestsResponse = await harness.request('/api/access/requests?agentId=owned-agent', {
      headers: { cookie: developerCookie },
    })
    const accessRequests = (await accessRequestsResponse.json()) as { items: Array<Record<string, unknown>> }
    expect(accessRequests.items).toEqual([
      expect.objectContaining({ id: 'owned-access-request', scopes: ['orders:read'], status: 'pending' }),
    ])
    await expect(
      (await harness.request('/api/access/requests', { headers: { cookie: developerCookie } })).json(),
    ).resolves.toMatchObject({ items: [{ id: 'owned-access-request' }], pagination: { total: 1 } })
    expect(accessRequests.items[0]).not.toHaveProperty('approvalTokenHash')
    await expect(
      (
        await harness.request('/api/access/authorizations?agentId=owned-agent', {
          headers: { cookie: developerCookie },
        })
      ).json(),
    ).resolves.toMatchObject({ items: [{ id: 'owned-access-grant', scopes: ['orders:read'], status: 'active' }] })
    await expect(
      (await harness.request('/api/access/authorizations', { headers: { cookie: developerCookie } })).json(),
    ).resolves.toMatchObject({ items: [{ id: 'owned-access-grant' }], pagination: { total: 1 } })
    const auditResponse = await harness.request('/api/realm/audit-events?agentId=owned-agent', {
      headers: { cookie: developerCookie },
    })
    expect(auditResponse.status).toBe(200)
    await expect(auditResponse.json()).resolves.toMatchObject({
      items: [{ id: 'owned-agent-event', agentIdentityId: 'owned-agent' }],
      pagination: { total: 1 },
    })
    expect(
      (await harness.request('/api/realm/audit-events?agentId=other-agent', { headers: { cookie: developerCookie } }))
        .status,
    ).toBe(403)
    expect((await harness.request(`/api/users/${developerId}`, { headers: { cookie: developerCookie } })).status).toBe(
      403,
    )
    expect(
      (await harness.request(`/api/users/${developerId}/passkeys`, { headers: { cookie: developerCookie } })).status,
    ).toBe(403)

    expect(
      (await harness.request(`/api/applications/${otherApplication.id}`, { headers: { cookie: developerCookie } }))
        .status,
    ).toBe(403)
    expect(
      (
        await harness.request(`/api/resource-servers/${otherResource.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: developerCookie },
          body: JSON.stringify({ name: 'Forbidden rename' }),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await harness.request(`/api/applications/${ownedApplication.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: developerCookie },
          body: JSON.stringify({ name: 'Owned Portal 2' }),
        })
      ).status,
    ).toBe(200)

    const realmInventory = await harness.request('/api/applications', { headers: { cookie: adminCookie } })
    await expect(realmInventory.json()).resolves.toMatchObject({ pagination: { total: 2 } })
    const realmAudit = await harness.request('/api/realm/audit-events', { headers: { cookie: adminCookie } })
    const realmAuditBody = (await realmAudit.json()) as { pagination: { total: number } }
    expect(realmAuditBody.pagination.total).toBeGreaterThanOrEqual(2)
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

  it('manages role scope references and a user role assignment through real SQL [spec: management-api/management-restish-role-crud]', async () => {
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'assignee@example.com',
      username: 'assignee',
      displayName: 'Assignee',
      password: 'assignee-password-2026',
    })

    expect(
      (
        await postJson(harness, cookie, '/api/resource-servers', {
          identifier: 'https://roles.example.com',
          name: 'Roles API',
          resourceUrl: 'https://roles.example.com',
        })
      ).status,
    ).toBe(201)
    const role = (await (
      await postJson(harness, cookie, '/api/access/roles', {
        key: 'editor',
        name: 'Editor',
      })
    ).json()) as { id: string }

    const duplicateRole = await harness.request('/api/access/roles', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: 'editor', name: 'Duplicate editor' }),
    })
    expect(duplicateRole.status).toBe(409)
    await expect(duplicateRole.json()).resolves.toMatchObject({
      error: {
        code: 'conflict',
        message: 'Role key "editor" is already in use.',
      },
    })

    const changedKey = await harness.request(`/api/access/roles/${role.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: 'renamed-editor' }),
    })
    expect(changedKey.status).toBe(400)

    const roles = await harness.request('/api/access/roles', { headers: { cookie } })
    expect(((await roles.json()) as { roles: unknown[] }).roles.length).toBeGreaterThanOrEqual(1)

    expect((await harness.request(`/api/access/roles/${role.id}`, { headers: { cookie } })).status).toBe(200)

    const patched = await harness.request(`/api/access/roles/${role.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Lead Editor' }),
    })
    expect(((await patched.json()) as { name: string }).name).toBe('Lead Editor')

    const currentPermissions = await harness.request(`/api/access/roles/${role.id}/scopes`, {
      headers: { cookie },
    })
    const etag = currentPermissions.headers.get('etag')
    expect(etag).toBeTruthy()
    const replacePermissions = await harness.request(`/api/access/roles/${role.id}/scopes`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie, 'if-match': etag! },
      body: JSON.stringify({ scopes: [] }),
    })
    expect(replacePermissions.status).toBe(200)
    expect(replacePermissions.headers.get('etag')).toBeTruthy()

    const rolePermissions = await harness.request(`/api/access/roles/${role.id}/scopes`, {
      headers: { cookie },
    })
    expect(((await rolePermissions.json()) as { scopes: unknown[] }).scopes).toEqual([])

    const assignment = (await (
      await postJson(harness, cookie, '/api/access/assignments', {
        roleId: role.id,
        subjectType: 'user',
        subjectId: userId,
      })
    ).json()) as { id: string }
    const assignments = await harness.request(`/api/access/assignments?roleId=${role.id}`, { headers: { cookie } })
    expect(((await assignments.json()) as { assignments: Array<{ id: string }> }).assignments).toContainEqual(
      expect.objectContaining({ id: assignment.id }),
    )

    expect(
      (await harness.request(`/api/access/roles/${role.id}`, { method: 'DELETE', headers: { cookie } })).status,
    ).toBe(204)
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

    const role = (await (
      await postJson(harness, cookie, '/api/access/roles', { key: 'org-lead', name: 'Org Lead' })
    ).json()) as { id: string }
    await postJson(harness, cookie, '/api/access/assignments', {
      roleId: role.id,
      subjectType: 'user',
      subjectId: memberUserId,
      organizationId: organization.id,
    })

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
    const role = (await (
      await postJson(harness, cookie, '/api/access/roles', { key: 'svc', name: 'Service' })
    ).json()) as {
      id: string
    }

    await postJson(harness, cookie, '/api/access/assignments', {
      roleId: role.id,
      subjectType: 'workload',
      subjectId: application.id,
    })
  })
})

async function authorityClient(
  harness: Harness,
  input: {
    authority: 'realm' | 'organization' | 'account'
    id: string
    scopes: string[]
  },
) {
  const keyPair = await generateKeyPair('ES256')
  const publicJwk = await exportJWK(keyPair.publicKey)
  const thumbprint = await calculateJwkThumbprint(publicJwk)
  const now = Math.floor(Date.now() / 1000)
  const accessToken = await harness.agentTokenSigner.sign(
    {
      iss: 'http://localhost/api/auth',
      sub: 'boundary-principal-subject',
      aud: 'http://localhost/api',
      jti: `boundary-token-${crypto.randomUUID()}`,
      iat: now,
      exp: now + 300,
      scope: input.scopes.join(' '),
      client_id: 'boundary-protocol-agent',
      host_id: 'boundary-host',
      sub_profile: 'ai_agent',
      realmroot_authority: { type: 'realmroot_authority', authority: input.authority, id: input.id },
      cnf: { jkt: thumbprint },
    },
    'at+jwt',
  )

  return {
    async headers(method: string, path: string) {
      const url = new URL(path, 'http://localhost')
      const htu = new URL(url)
      htu.search = ''
      htu.hash = ''
      const proof = await new SignJWT({
        htm: method.toUpperCase(),
        htu: htu.toString(),
        jti: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        ath: await sha256Base64Url(accessToken),
      })
        .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
        .sign(keyPair.privateKey)
      return { authorization: `DPoP ${accessToken}`, dpop: proof }
    },
  }
}

function invalidDualOwnerAudit(id: string): AgentAuditEventRecord {
  return {
    id,
    action: 'management.atomicity.test',
    result: 'allowed',
    controllerUserId: null,
    subjectIssuer: null,
    subject: null,
    agentIdentityId: null,
    hostId: null,
    ownerUserId: 'user-invalid',
    ownerOrganizationId: 'org-invalid',
    resourceId: null,
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: null,
    reasonCode: null,
    metadata: null,
    occurredAt: new Date(),
  }
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
