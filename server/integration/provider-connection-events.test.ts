import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agentAccessGrant,
  agentAccessRequest,
  agentIdentity,
  agentIdentityBinding,
  apiResource,
  externalTokenLease,
  identityProviderConnector,
  providerConnection,
  providerConnectionEventReceipt,
  providerResourceAuthorization,
  user,
} from '@server/db/schema'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, seedAgent, signInAdmin } from './harness'

const resource = 'https://adapter.example.com/provider'
const secret = 'integration-provider-connection-event-secret-2026'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('Provider Connection Events over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
    await signInAdmin(harness)
    const [admin] = await harness.db.select({ id: user.id }).from(user).limit(1)
    const seededAgent = await seedAgent(harness, admin!.id, 'event')
    const now = new Date('2026-08-08T20:00:00.000Z')
    await harness.db.insert(identityProviderConnector).values({
      id: 'event-connector',
      slug: 'event-provider',
      providerType: 'generic_oauth',
      providerId: 'event-provider',
      displayName: 'Event Provider',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(apiResource).values({
      id: 'event-resource',
      identifier: 'event-resource',
      name: 'Event Resource',
      resourceUrl: resource,
      accessMode: 'brokered',
      connectorId: 'event-connector',
      ownerOrganizationId: 'org_platform',
      scopeRegistry: null,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(providerConnection).values({
      id: 'event-provider-connection',
      connectorId: 'event-connector',
      ownerUserId: admin!.id,
      externalSubject: 'provider-user-1',
      displayName: 'Provider User',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(providerResourceAuthorization).values({
      id: 'event-connection',
      providerConnectionId: 'event-provider-connection',
      resourceId: 'event-resource',
      credentialCustody: 'resource_server',
      encryptedTokens: null,
      brokerReference: 'installation-1',
      grantedScopes: ['contents:read', 'issues:write'],
      authorizationDetails: [
        { type: 'provider_installation', resource_id: 'repository-1' },
        { type: 'provider_installation', resource_id: 'repository-2' },
        { type: 'provider_installation', selector: { repositories: ['repository-1', 'repository-2'] } },
      ],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentIdentity).values({
      id: 'event-agent-identity',
      issuer: 'http://localhost/api/auth',
      subject: 'event-agent',
      name: 'Event Agent',
      ownerUserId: admin!.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentIdentityBinding).values({
      id: 'event-agent-binding',
      agentIdentityId: 'event-agent-identity',
      protocolAgentId: seededAgent.agentId,
      status: 'active',
      boundAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessRequest).values({
      id: 'event-access-request',
      resourceId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      bindingId: 'event-agent-binding',
      scopes: ['contents:read', 'issues:write'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      status: 'approved',
      approvalTokenHash: 'event-approval-token-hash',
      encryptedApprovalToken: 'event-approval-token',
      grantId: 'event-grant',
      expiresAt: new Date('2027-08-08T20:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessRequest).values({
      id: 'pending-event-access-request',
      resourceId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      bindingId: 'event-agent-binding',
      scopes: ['issues:write'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      status: 'pending',
      approvalTokenHash: 'pending-event-approval-token-hash',
      encryptedApprovalToken: 'pending-event-approval-token',
      expiresAt: new Date('2027-08-08T20:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessRequest).values({
      id: 'unaffected-pending-event-access-request',
      resourceId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      bindingId: 'event-agent-binding',
      scopes: ['contents:read'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-2' }],
      status: 'pending',
      approvalTokenHash: 'unaffected-pending-event-token-hash',
      encryptedApprovalToken: 'unaffected-pending-event-token',
      expiresAt: new Date('2027-08-08T20:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessGrant).values({
      id: 'event-grant',
      resourceId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      scopes: ['contents:read', 'issues:write'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      mode: 'persistent',
      status: 'active',
      grantedByUserId: admin!.id,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessGrant).values({
      id: 'unaffected-event-grant',
      resourceId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      scopes: ['contents:read'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-2' }],
      mode: 'persistent',
      status: 'active',
      grantedByUserId: admin!.id,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessGrant).values({
      id: 'retained-affected-event-grant',
      resourceId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      scopes: ['contents:read'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      mode: 'persistent',
      status: 'active',
      grantedByUserId: admin!.id,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessGrant).values({
      id: 'nested-event-grant',
      resourceId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      scopes: ['contents:read'],
      authorizationDetails: [{ type: 'provider_installation', selector: { repositories: ['repository-1'] } }],
      mode: 'persistent',
      status: 'active',
      grantedByUserId: admin!.id,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(agentAccessRequest).values({
      id: 'unaffected-approved-event-access-request',
      resourceId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      bindingId: 'event-agent-binding',
      scopes: ['contents:read'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-2' }],
      status: 'approved',
      approvalTokenHash: 'unaffected-approved-event-token-hash',
      encryptedApprovalToken: 'unaffected-approved-event-token',
      grantId: 'unaffected-event-grant',
      expiresAt: new Date('2027-08-08T20:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(externalTokenLease).values({
      id: 'event-token-lease',
      grantId: 'event-grant',
      requestId: 'event-access-request',
      bindingId: 'event-agent-binding',
      encryptedAccessToken: 'event-access-token',
      tokenHash: 'event-access-token-hash',
      confirmationJkt: 'event-confirmation-jkt',
      scopes: ['contents:read', 'issues:write'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      expiresAt: new Date('2027-08-08T20:00:00.000Z'),
      createdAt: now,
    })
  })

  it('[spec: agent-identity/provider-connection-events] applies, constrains, replays, suspends, restores, and revokes', async () => {
    const discovery = await harness.request('/api/openapi.json')
    const contract = (await discovery.json()) as {
      paths: Record<string, { put?: { operationId?: string; security?: unknown[] } }>
    }
    expect(contract.paths['/provider-connection-events/{eventId}']?.put).toMatchObject({
      operationId: 'replaceProviderConnectionEvent',
      security: [
        {
          providerConnectionEventSecret: [],
          providerConnectionEventTimestamp: [],
          providerConnectionEventSignature: [],
        },
      ],
    })

    const expansion = {
      type: 'authorityChanged',
      resource,
      brokerReference: 'installation-1',
      occurredAt: '2026-08-08T20:01:00.000Z',
      revision: 1,
      scopes: ['contents:read', 'issues:write', 'workflows:write'],
      affectedAuthorizationDetails: [{ resource_id: 'repository-1', type: 'provider_installation' }],
    }
    expect((await putEvent(harness, 'delivery-expansion', expansion)).status).toBe(204)
    const [grantAfterExpansion] = await harness.db
      .select()
      .from(agentAccessGrant)
      .where(eq(agentAccessGrant.id, 'event-grant'))
    expect(grantAfterExpansion.status).toBe('active')

    const authority = {
      type: 'authorityChanged',
      resource,
      brokerReference: 'installation-1',
      occurredAt: '2026-08-08T20:01:00.000Z',
      revision: 2,
      scopes: ['contents:read'],
      affectedAuthorizationDetails: [{ resource_id: 'repository-1', type: 'provider_installation' }],
    }
    expect((await putEvent(harness, 'delivery-1', authority)).status).toBe(204)
    expect((await putEvent(harness, 'delivery-1', authority)).status).toBe(204)
    expect(
      (
        await putEvent(harness, 'delivery-1', {
          ...authority,
          scopes: [],
        })
      ).status,
    ).toBe(409)

    let [connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    let [grant] = await harness.db.select().from(agentAccessGrant).where(eq(agentAccessGrant.id, 'event-grant'))
    expect(connection).toMatchObject({
      status: 'active',
      grantedScopes: ['contents:read'],
      authorizationDetails: [
        { type: 'provider_installation', resource_id: 'repository-1' },
        { type: 'provider_installation', resource_id: 'repository-2' },
        { type: 'provider_installation', selector: { repositories: ['repository-1', 'repository-2'] } },
      ],
    })
    expect(grant.status).toBe('revoked')
    const [unaffectedGrant] = await harness.db
      .select()
      .from(agentAccessGrant)
      .where(eq(agentAccessGrant.id, 'unaffected-event-grant'))
    expect(unaffectedGrant.status).toBe('active')
    const [retainedAffectedGrant] = await harness.db
      .select()
      .from(agentAccessGrant)
      .where(eq(agentAccessGrant.id, 'retained-affected-event-grant'))
    expect(retainedAffectedGrant.status).toBe('active')
    const [expiredRequest] = await harness.db
      .select()
      .from(agentAccessRequest)
      .where(eq(agentAccessRequest.id, 'pending-event-access-request'))
    expect(expiredRequest.status).toBe('expired')
    const [unaffectedPendingRequest] = await harness.db
      .select()
      .from(agentAccessRequest)
      .where(eq(agentAccessRequest.id, 'unaffected-pending-event-access-request'))
    expect(unaffectedPendingRequest.status).toBe('pending')
    const [lease] = await harness.db
      .select()
      .from(externalTokenLease)
      .where(eq(externalTokenLease.id, 'event-token-lease'))
    expect(lease.revokedAt).not.toBeNull()
    expect(await harness.db.select().from(providerConnectionEventReceipt)).toHaveLength(2)

    expect(
      (
        await putEvent(harness, 'delivery-resource-expansion', {
          type: 'resourcesChanged',
          resource,
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:01:30.000Z',
          revision: 3,
          authorizationDetails: [
            { type: 'provider_installation', resource_id: 'repository-1' },
            { type: 'provider_installation', resource_id: 'repository-2' },
            { type: 'provider_installation', resource_id: 'repository-3' },
            { type: 'provider_installation', selector: { repositories: ['repository-2', 'repository-1'] } },
          ],
        })
      ).status,
    ).toBe(204)
    const [grantAfterResourceExpansion] = await harness.db
      .select()
      .from(agentAccessGrant)
      .where(eq(agentAccessGrant.id, 'unaffected-event-grant'))
    expect(grantAfterResourceExpansion.status).toBe('active')

    expect(
      (
        await putEvent(harness, 'delivery-stale', {
          type: 'revoked',
          resource,
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:01:00.000Z',
          revision: 1,
        })
      ).status,
    ).toBe(204)
    ;[connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    ;[grant] = await harness.db.select().from(agentAccessGrant).where(eq(agentAccessGrant.id, 'event-grant'))
    expect(connection.status).toBe('active')
    expect(grant.status).toBe('revoked')

    expect(
      (
        await putEvent(harness, 'delivery-2', {
          type: 'suspended',
          resource,
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:02:00.000Z',
          revision: 4,
        })
      ).status,
    ).toBe(204)
    ;[connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    ;[grant] = await harness.db.select().from(agentAccessGrant).where(eq(agentAccessGrant.id, 'event-grant'))
    expect(connection.status).toBe('suspended')
    expect(grant.status).toBe('revoked')
    const [suspendedUnaffectedGrant] = await harness.db
      .select()
      .from(agentAccessGrant)
      .where(eq(agentAccessGrant.id, 'unaffected-event-grant'))
    expect(suspendedUnaffectedGrant.status).toBe('active')
    const [suspendedPendingRequest] = await harness.db
      .select()
      .from(agentAccessRequest)
      .where(eq(agentAccessRequest.id, 'unaffected-pending-event-access-request'))
    expect(suspendedPendingRequest.status).toBe('expired')
    await expect(
      harness.deps.externalResources.createTokenLease({
        id: 'lease-after-suspension',
        grantId: 'unaffected-event-grant',
        requestId: 'unaffected-approved-event-access-request',
        bindingId: 'event-agent-binding',
        encryptedAccessToken: 'lease-after-suspension-token',
        tokenHash: 'lease-after-suspension-hash',
        confirmationJkt: 'lease-after-suspension-jkt',
        scopes: ['contents:read'],
        authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-2' }],
        expiresAt: new Date('2027-08-08T20:00:00.000Z'),
        revokedAt: null,
        createdAt: new Date(),
      }),
    ).resolves.toBeNull()

    expect(
      (
        await putEvent(harness, 'delivery-3', {
          type: 'restored',
          resource,
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:03:00.000Z',
          revision: 5,
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await putEvent(harness, 'delivery-4', {
          type: 'revoked',
          resource,
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:04:00.000Z',
          revision: 6,
        })
      ).status,
    ).toBe(204)

    ;[connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    ;[grant] = await harness.db.select().from(agentAccessGrant).where(eq(agentAccessGrant.id, 'event-grant'))
    expect(connection.status).toBe('revoked')
    expect(grant.status).toBe('revoked')
  })

  it('orders events only by revision and compares nested authorization details structurally', async () => {
    const expansionOccurredAt = '2026-08-08T20:02:00.000Z'
    const expanded = {
      type: 'resourcesChanged',
      resource,
      brokerReference: 'installation-1',
      occurredAt: expansionOccurredAt,
      revision: 1,
      authorizationDetails: [
        { type: 'provider_installation', resource_id: 'repository-1' },
        { type: 'provider_installation', resource_id: 'repository-2' },
        { type: 'provider_installation', selector: { repositories: ['repository-2', 'repository-1'] } },
      ],
    }
    expect((await putEvent(harness, 'delivery-structural-expansion', expanded)).status).toBe(204)

    let [nestedGrant] = await harness.db
      .select()
      .from(agentAccessGrant)
      .where(eq(agentAccessGrant.id, 'nested-event-grant'))
    expect(nestedGrant.status).toBe('active')

    const reduced = {
      ...expanded,
      occurredAt: '2026-08-08T20:01:00.000Z',
      revision: 2,
      authorizationDetails: [
        { type: 'provider_installation', resource_id: 'repository-2' },
        { type: 'provider_installation', selector: { repositories: ['repository-2'] } },
      ],
    }
    expect((await putEvent(harness, 'delivery-structural-reduction', reduced)).status).toBe(204)

    ;[nestedGrant] = await harness.db
      .select()
      .from(agentAccessGrant)
      .where(eq(agentAccessGrant.id, 'nested-event-grant'))
    expect(nestedGrant.status).toBe('revoked')

    expect(
      (
        await putEvent(harness, 'delivery-structural-stale', {
          ...expanded,
          occurredAt: '2026-08-08T20:03:00.000Z',
          authorizationDetails: [
            { type: 'provider_installation', selector: { repositories: ['repository-1', 'repository-2'] } },
          ],
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await putEvent(harness, 'delivery-structural-equal-revision', {
          ...expanded,
          occurredAt: '2026-08-08T20:04:00.000Z',
          revision: 2,
        })
      ).status,
    ).toBe(204)
    const [connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    expect(connection).toMatchObject({
      providerEventOccurredAt: new Date(reduced.occurredAt),
      providerEventRevision: 2,
      authorizationDetails: reduced.authorizationDetails,
    })
  })
})

async function putEvent(harness: Harness, eventId: string, representation: Record<string, unknown>) {
  const path = `/api/provider-connection-events/${eventId}`
  const body = JSON.stringify(representation)
  const timestamp = `${Math.floor(Date.now() / 1000)}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = `${timestamp}\nPUT\n${path}\n${body}`
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
  const signature = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return harness.request(path, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      'Realmroot-Timestamp': timestamp,
      'Realmroot-Signature': `sha256=${signature}`,
    },
    body,
  })
}
