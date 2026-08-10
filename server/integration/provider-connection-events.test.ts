import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  agentAccessRequest,
  agentIdentity,
  agentIdentityBinding,
  apiResource,
  externalTokenLease,
  identityProviderConnector,
  providerConnection,
  providerConnectionEventReceipt,
  providerResourceAuthorization,
  resourceScopeEntitlement,
  user,
} from '@server/db/schema'
import { ensureRealmrootResourceServer } from '@server/usecases/authorization'
import { decideAgentAccessRequest } from '@server/usecases/external-resources'
import type { JsonValue } from '@shared/api/authorization-details'
import { eq } from 'drizzle-orm'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { baseURL, createHarness, type Harness, seedAgent, signInAdmin } from './harness'

const resource = 'https://adapter.example.com/provider'
let publisher: { clientId: string; clientSecret: string }

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('Provider Connection Events over real D1', () => {
  let harness: Harness
  let controllerUserId: string

  beforeEach(async () => {
    harness = await createHarness()
    const cookie = await signInAdmin(harness)
    await ensureRealmrootResourceServer(harness.deps, baseURL)
    const applicationResponse = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Event Publisher',
        clientType: 'confidential_web',
        redirectUris: ['https://adapter.example.com/oauth/callback'],
        ownerOrganizationId: 'org_platform',
        allowedGrantTypes: ['client_credentials'],
        resourceScopes: [{ resourceServerId: 'res_realmroot', scopes: ['connection-events:write'] }],
      }),
    })
    expect(applicationResponse.status, await applicationResponse.clone().text()).toBe(201)
    const application = (await applicationResponse.json()) as {
      id: string
      clientId: string
      clientSecret: string
    }
    const permissionResponse = await harness.request(`/api/applications/${application.id}/permissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ resourceServerId: 'res_realmroot', scope: 'connection-events:write', mode: 'persistent' }),
    })
    expect(permissionResponse.status, await permissionResponse.clone().text()).toBe(201)
    publisher = { clientId: application.clientId, clientSecret: application.clientSecret }
    const [admin] = await harness.db.select({ id: user.id }).from(user).limit(1)
    controllerUserId = admin!.id
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
      authorizationDetails: [{ type: 'provider_installation' }],
      scopeRegistry: {
        discovery: {
          sourceUrl: 'https://adapter.example.com/.well-known/oauth-protected-resource/provider',
          etag: null,
          documentHash: 'event-provider-contract',
          syncedAt: now.toISOString(),
          lastError: null,
        },
        scopes: [
          { value: 'contents:read', description: null, grantMode: 'assigned' },
          { value: 'issues:write', description: null, grantMode: 'assigned' },
          { value: 'workflows:write', description: null, grantMode: 'assigned' },
        ],
        accountConnection: {
          mode: 'brokered',
          authorizationEndpoint: 'https://adapter.example.com/provider/account-connection-authorizations',
          tokenEndpoint: 'https://adapter.example.com/provider/account-connection-credentials',
        },
      },
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
      authorityConstraints: [
        {
          authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
          scopes: ['contents:read', 'issues:write'],
        },
        {
          authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-2' }],
          scopes: ['contents:read'],
        },
        {
          authorizationDetails: [
            { type: 'provider_installation', selector: { repositories: ['repository-1', 'repository-2'] } },
          ],
          scopes: ['contents:read'],
        },
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
      approvedEntitlements: [
        { scope: 'contents:read', entitlementId: 'retained-affected-event-grant' },
        { scope: 'issues:write', entitlementId: 'event-grant' },
      ],
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
      scopes: ['issues:write'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-2' }],
      status: 'pending',
      approvalTokenHash: 'unaffected-pending-event-token-hash',
      encryptedApprovalToken: 'unaffected-pending-event-token',
      expiresAt: new Date('2027-08-08T20:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(resourceScopeEntitlement).values({
      id: 'event-grant',
      resourceServerId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      authorizationContextHash: 'ctx-repository-1',
      scope: 'issues:write',
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      mode: 'persistent',
      grantedByUserId: admin!.id,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(resourceScopeEntitlement).values({
      id: 'unaffected-event-grant',
      resourceServerId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      authorizationContextHash: 'ctx-repository-2',
      scope: 'contents:read',
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-2' }],
      mode: 'persistent',
      grantedByUserId: admin!.id,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(resourceScopeEntitlement).values({
      id: 'retained-affected-event-grant',
      resourceServerId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      authorizationContextHash: 'ctx-repository-1',
      scope: 'contents:read',
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      mode: 'persistent',
      grantedByUserId: admin!.id,
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(resourceScopeEntitlement).values({
      id: 'nested-event-grant',
      resourceServerId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      authorizationContextHash: 'ctx-nested-repository-1',
      scope: 'contents:read',
      authorizationDetails: [{ type: 'provider_installation', selector: { repositories: ['repository-1'] } }],
      mode: 'persistent',
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
      approvedEntitlements: [{ scope: 'contents:read', entitlementId: 'unaffected-event-grant' }],
      expiresAt: new Date('2027-08-08T20:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    })
    await harness.db.insert(externalTokenLease).values({
      id: 'event-token-lease',
      entitlementIds: ['retained-affected-event-grant', 'event-grant'],
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

  it('[spec: agent-identity/external-resource-first-access] creates a connection with lifecycle columns over real D1', async () => {
    const now = new Date('2026-08-08T20:00:00.000Z')
    await harness.db.insert(apiResource).values({
      id: 'new-event-resource',
      identifier: 'new-event-resource',
      name: 'New Event Resource',
      resourceUrl: 'https://adapter.example.com/new-provider',
      accessMode: 'external_oauth',
      connectorId: 'event-connector',
      ownerOrganizationId: 'org_platform',
      scopeRegistry: null,
      createdAt: now,
      updatedAt: now,
    })

    await expect(
      harness.deps.externalResources.createConnection({
        id: 'new-event-connection',
        providerConnectionId: 'event-provider-connection',
        resourceId: 'new-event-resource',
        credentialCustody: 'realmroot',
        encryptedTokens: 'encrypted-event-tokens',
        brokerReference: null,
        grantedScopes: ['contents:read'],
        authorizationDetails: [],
        clientGeneration: 1,
        status: 'active',
        credentialExpiresAt: null,
        revokedAt: null,
        providerEventOccurredAt: null,
        providerEventRevision: null,
        createdAt: now,
        updatedAt: now,
      }),
    ).resolves.toMatchObject({
      id: 'new-event-connection',
      providerEventOccurredAt: null,
      providerEventRevision: null,
    })
  })

  it('[spec: agent-identity/provider-connection-events] resets event ordering only when the broker authority changes', async () => {
    const previousEventAt = new Date('2026-08-08T20:01:00.000Z')
    await harness.db
      .update(providerResourceAuthorization)
      .set({ providerEventOccurredAt: previousEventAt, providerEventRevision: 7 })
      .where(eq(providerResourceAuthorization.id, 'event-connection'))

    await harness.deps.externalResources.replaceConnectionAuthorization('event-connection', 'event-resource', {
      credentialCustody: 'resource_server',
      encryptedTokens: null,
      brokerReference: 'installation-2',
      grantedScopes: ['contents:read'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      authorityConstraints: constraintsFor(
        [{ type: 'provider_installation', resource_id: 'repository-1' }],
        ['contents:read'],
      ),
      providerEventOccurredAt: null,
      providerEventRevision: null,
      status: 'active',
      credentialExpiresAt: null,
      revokedAt: null,
      updatedAt: new Date('2026-08-08T20:02:00.000Z'),
    })

    let [connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    expect(connection).toMatchObject({
      brokerReference: 'installation-2',
      providerEventOccurredAt: null,
      providerEventRevision: null,
    })

    expect(
      (
        await putEvent(harness, 'delivery-new-broker-first', {
          type: 'authorityChanged',
          brokerReference: 'installation-2',
          occurredAt: '2026-08-08T20:03:00.000Z',
          revision: 1,
          scopes: ['contents:read'],
          affectedScopes: ['contents:read'],
          affectedAuthorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
          authorityConstraints: constraintsFor(
            [{ type: 'provider_installation', resource_id: 'repository-1' }],
            ['contents:read'],
          ),
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await putEvent(harness, 'delivery-old-broker-replay', {
          type: 'revoked',
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:04:00.000Z',
          revision: 8,
        })
      ).status,
    ).toBe(404)

    ;[connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    expect(connection).toMatchObject({
      brokerReference: 'installation-2',
      providerEventRevision: 1,
      status: 'active',
    })

    await harness.deps.externalResources.replaceConnectionAuthorization('event-connection', 'event-resource', {
      credentialCustody: 'resource_server',
      encryptedTokens: null,
      brokerReference: 'installation-2',
      grantedScopes: ['contents:read'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      authorityConstraints: constraintsFor(
        [{ type: 'provider_installation', resource_id: 'repository-1' }],
        ['contents:read'],
      ),
      status: 'active',
      credentialExpiresAt: null,
      revokedAt: null,
      updatedAt: new Date('2026-08-08T20:05:00.000Z'),
    })
    ;[connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    expect(connection).toMatchObject({
      brokerReference: 'installation-2',
      providerEventRevision: 1,
    })
    expect(
      (
        await putEvent(harness, 'delivery-same-broker-equal-revision', {
          type: 'authorityChanged',
          brokerReference: 'installation-2',
          occurredAt: '2026-08-08T20:06:00.000Z',
          revision: 1,
          scopes: ['contents:read'],
          affectedScopes: ['contents:read'],
          affectedAuthorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
          authorityConstraints: constraintsFor(
            [{ type: 'provider_installation', resource_id: 'repository-1' }],
            ['contents:read'],
          ),
        })
      ).status,
    ).toBe(409)
  })

  it('[spec: agent-identity/provider-connection-events] isolates affected scopes from an adjacent authority', async () => {
    const now = new Date('2026-08-08T20:00:00.000Z')
    await harness.db.insert(resourceScopeEntitlement).values({
      id: 'adjacent-authority-grant',
      resourceServerId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      authorizationContextHash: 'ctx-adjacent-repository-2',
      scope: 'issues:write',
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-2' }],
      mode: 'persistent',
      grantedByUserId: (await harness.db.select({ id: user.id }).from(user).limit(1))[0]!.id,
      createdAt: now,
      updatedAt: now,
    })

    expect(
      (
        await putEvent(harness, 'delivery-isolated-authority', {
          type: 'authorityChanged',
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:01:00.000Z',
          revision: 1,
          scopes: ['contents:read', 'issues:write'],
          affectedScopes: ['contents:read'],
          affectedAuthorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
          authorityConstraints: [
            {
              authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
              scopes: ['contents:read'],
            },
            {
              authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-2' }],
              scopes: ['contents:read', 'issues:write'],
            },
          ],
        })
      ).status,
    ).toBe(204)

    const [affectedGrant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'event-grant'))
    const [adjacentGrant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'adjacent-authority-grant'))
    const [connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    expect(affectedGrant.endReason).toBe('revoked')
    expect(adjacentGrant.endedAt).toBeNull()
    expect(connection).toMatchObject({
      grantedScopes: ['contents:read', 'issues:write'],
      providerEventRevision: 1,
    })

    const requestCreatedAt = new Date('2026-08-08T20:02:00.000Z')
    await harness.db.insert(agentAccessRequest).values({
      id: 'post-reduction-request',
      resourceId: 'event-resource',
      connectionId: 'event-connection',
      agentIdentityId: 'event-agent-identity',
      bindingId: 'event-agent-binding',
      scopes: ['issues:write'],
      authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      status: 'pending',
      approvalTokenHash: 'post-reduction-token-hash',
      encryptedApprovalToken: 'post-reduction-token',
      expiresAt: new Date('2027-08-08T20:00:00.000Z'),
      createdAt: requestCreatedAt,
      updatedAt: requestCreatedAt,
    })
    await expect(
      decideAgentAccessRequest(
        harness.deps,
        'post-reduction-request',
        {
          decision: 'approve',
          mode: 'persistent',
          authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
        },
        controllerUserId,
      ),
    ).rejects.toThrow('selected authority boundary')

    const staleApprovalAt = new Date('2026-08-08T20:02:01.000Z')
    await expect(
      harness.deps.externalResources.approveAccessRequestWithEntitlements(
        [
          {
            id: 'stale-revision-grant',
            userId: null,
            applicationId: null,
            agentIdentityId: 'event-agent-identity',
            organizationId: null,
            resourceServerId: 'event-resource',
            connectionId: 'event-connection',
            authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
            authorizationContextHash: 'ctx-repository-1',
            scope: 'issues:write',
            mode: 'persistent',
            grantedByUserId: controllerUserId,
            grantedByAgentIdentityId: null,
            sourceAccessRequestId: 'post-reduction-request',
            expiresAt: null,
            endedAt: null,
            endReason: null,
            createdAt: staleApprovalAt,
            updatedAt: staleApprovalAt,
          },
        ],
        [],
        'post-reduction-request',
        {
          status: 'approved',
          approvedEntitlements: [{ scope: 'issues:write', entitlementId: 'stale-revision-grant' }],
          connectionId: 'event-connection',
          decidedAt: staleApprovalAt,
          updatedAt: staleApprovalAt,
        },
        {
          id: 'stale-revision-audit',
          action: 'api_resource.access_decided',
          result: 'allowed',
          realmOwned: false,
          ownerUserId: controllerUserId,
          ownerOrganizationId: null,
          controllerUserId,
          subjectIssuer: null,
          subject: null,
          agentIdentityId: 'event-agent-identity',
          hostId: null,
          resourceId: 'event-resource',
          resourceConnectionId: 'event-connection',
          accessRequestId: 'post-reduction-request',
          scopes: ['issues:write'],
          reasonCode: null,
          metadata: null,
          occurredAt: staleApprovalAt,
        },
        0,
      ),
    ).resolves.toBe('resource_unavailable')
    await expect(
      harness.db
        .select({ id: resourceScopeEntitlement.id })
        .from(resourceScopeEntitlement)
        .where(eq(resourceScopeEntitlement.id, 'stale-revision-grant')),
    ).resolves.toEqual([])
  })

  it('[spec: agent-identity/provider-connection-events] serializes concurrent revisions and event-identity replay over real D1', async () => {
    const first = {
      type: 'authorityChanged',
      brokerReference: 'installation-1',
      occurredAt: '2026-08-08T20:01:00.000Z',
      revision: 1,
      scopes: ['contents:read', 'issues:write'],
      affectedScopes: ['contents:read', 'issues:write'],
      affectedAuthorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
      authorityConstraints: [
        {
          authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
          scopes: ['contents:read', 'issues:write'],
        },
      ],
    }
    const second = {
      ...first,
      occurredAt: '2026-08-08T20:02:00.000Z',
      scopes: ['issues:write'],
      affectedScopes: ['issues:write'],
      authorityConstraints: [
        {
          authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
          scopes: ['issues:write'],
        },
      ],
    }
    const distinct = await Promise.all([
      putEvent(harness, 'delivery-race-first', first),
      putEvent(harness, 'delivery-race-first', first),
      putEvent(harness, 'delivery-race-second', second),
    ])
    const distinctStatuses = distinct.map((response) => response.status)
    expect(distinctStatuses[0]).toBe(distinctStatuses[1])
    expect(new Set(distinctStatuses)).toEqual(new Set([204, 409]))

    let [connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    expect(connection.providerEventRevision).toBe(1)
    expect(connection.grantedScopes).toEqual(distinctStatuses[0] === 204 ? first.scopes : second.scopes)
    expect(connection.providerEventOccurredAt).toEqual(
      new Date(distinctStatuses[0] === 204 ? first.occurredAt : second.occurredAt),
    )
    const firstConflicted = distinctStatuses[0] === 409
    const conflictingId = firstConflicted ? 'delivery-race-first' : 'delivery-race-second'
    const conflictingEvent = firstConflicted ? first : second
    expect((await putEvent(harness, conflictingId, conflictingEvent)).status).toBe(409)
    const revisionReceipts = (await harness.db.select().from(providerConnectionEventReceipt)).filter((receipt) =>
      ['delivery-race-first', 'delivery-race-second'].includes(receipt.id),
    )
    expect(revisionReceipts.find((receipt) => receipt.id === conflictingId)?.appliedAt).toBeNull()
    expect(revisionReceipts.find((receipt) => receipt.id !== conflictingId)?.appliedAt).not.toBeNull()

    const exact = {
      ...first,
      occurredAt: '2026-08-08T20:03:00.000Z',
      revision: 2,
      scopes: ['contents:read', 'issues:write'],
    }
    const conflicting = {
      ...exact,
      scopes: ['contents:read'],
      affectedScopes: ['contents:read'],
      authorityConstraints: [
        {
          authorizationDetails: [{ type: 'provider_installation', resource_id: 'repository-1' }],
          scopes: ['contents:read'],
        },
      ],
    }
    const sharedIdentity = await Promise.all([
      putEvent(harness, 'delivery-race-shared', exact),
      putEvent(harness, 'delivery-race-shared', exact),
      putEvent(harness, 'delivery-race-shared', conflicting),
    ])
    const sharedStatuses = sharedIdentity.map((response) => response.status)
    expect(sharedStatuses[0]).toBe(sharedStatuses[1])
    expect(new Set(sharedStatuses)).toEqual(new Set([204, 409]))

    ;[connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    expect(connection.providerEventRevision).toBe(2)
    expect(connection.grantedScopes).toEqual(sharedStatuses[0] === 204 ? exact.scopes : conflicting.scopes)
    expect(
      (await harness.db.select().from(providerConnectionEventReceipt)).filter(
        (receipt) => receipt.id === 'delivery-race-shared',
      ),
    ).toHaveLength(1)
  })

  it('[spec: agent-identity/provider-connection-events] applies a restrictive restore snapshot before reactivating the connection', async () => {
    const authorizationDetails = [
      { type: 'provider_installation', resource_id: 'repository-1' },
      { type: 'provider_installation', resource_id: 'repository-2' },
    ]
    expect(
      (
        await putEvent(harness, 'delivery-restore-suspend', {
          type: 'suspended',
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:01:00.000Z',
          revision: 1,
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await putEvent(harness, 'delivery-restore-reduced', {
          type: 'restored',
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:02:00.000Z',
          revision: 2,
          scopes: ['contents:read'],
          authorizationDetails,
          authorityConstraints: constraintsFor(authorizationDetails, ['contents:read']),
        })
      ).status,
    ).toBe(204)

    const [connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    const [grant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'event-grant'))
    const [lease] = await harness.db
      .select()
      .from(externalTokenLease)
      .where(eq(externalTokenLease.id, 'event-token-lease'))
    expect(connection).toMatchObject({ status: 'active', grantedScopes: ['contents:read'], providerEventRevision: 2 })
    expect(grant.endReason).toBe('revoked')
    expect(lease.revokedAt).not.toBeNull()
  })

  it('[spec: agent-identity/provider-connection-events] invalidates grants against a complete authority snapshot', async () => {
    const authorizationDetails = [
      { type: 'provider_installation', resource_id: 'repository-1' },
      { type: 'provider_installation', resource_id: 'repository-2' },
    ]
    expect(
      (
        await putEvent(harness, 'delivery-resource-reduced', {
          type: 'resourcesChanged',
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:01:00.000Z',
          revision: 1,
          scopes: ['contents:read', 'issues:write'],
          authorizationDetails,
          authorityConstraints: constraintsFor(authorizationDetails, ['contents:read']),
        })
      ).status,
    ).toBe(204)

    const [grant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'event-grant'))
    const [lease] = await harness.db
      .select()
      .from(externalTokenLease)
      .where(eq(externalTokenLease.id, 'event-token-lease'))
    expect(grant.endReason).toBe('revoked')
    expect(lease.revokedAt).not.toBeNull()
  })

  it('[spec: agent-identity/provider-connection-events] applies, constrains, replays, suspends, restores, and revokes', async () => {
    const discovery = await harness.request('/api/openapi.json')
    const contract = (await discovery.json()) as {
      paths: Record<string, { put?: { operationId?: string; security?: unknown[] } }>
    }
    expect(contract.paths['/resource-servers/{resourceServerId}/connection-events/{eventId}']?.put).toMatchObject({
      operationId: 'replaceResourceServerConnectionEvent',
      security: [{ oauth2: ['connection-events:write'] }],
    })

    const expansion = {
      type: 'authorityChanged',
      brokerReference: 'installation-1',
      occurredAt: '2026-08-08T20:01:00.000Z',
      revision: 1,
      scopes: ['contents:read', 'issues:write', 'workflows:write'],
      affectedScopes: ['contents:read', 'issues:write', 'workflows:write'],
      affectedAuthorizationDetails: [{ resource_id: 'repository-1', type: 'provider_installation' }],
      authorityConstraints: [
        {
          authorizationDetails: [{ resource_id: 'repository-1', type: 'provider_installation' }],
          scopes: ['contents:read', 'issues:write', 'workflows:write'],
        },
      ],
    }
    expect((await putEvent(harness, 'delivery-expansion', expansion)).status).toBe(204)
    const [grantAfterExpansion] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'event-grant'))
    expect(grantAfterExpansion.endedAt).toBeNull()

    const authority = {
      type: 'authorityChanged',
      brokerReference: 'installation-1',
      occurredAt: '2026-08-08T20:01:00.000Z',
      revision: 2,
      scopes: ['contents:read'],
      affectedScopes: ['contents:read'],
      affectedAuthorizationDetails: [{ resource_id: 'repository-1', type: 'provider_installation' }],
      authorityConstraints: [
        {
          authorizationDetails: [{ resource_id: 'repository-1', type: 'provider_installation' }],
          scopes: ['contents:read'],
        },
      ],
    }
    expect((await putEvent(harness, 'delivery-1', authority)).status).toBe(204)
    expect((await putEvent(harness, 'delivery-1', authority)).status).toBe(204)
    expect(
      (
        await putEvent(harness, 'delivery-1', {
          ...authority,
          scopes: [],
          affectedScopes: [],
          authorityConstraints: [{ authorizationDetails: authority.affectedAuthorizationDetails, scopes: [] }],
        })
      ).status,
    ).toBe(409)

    let [connection] = await harness.db
      .select()
      .from(providerResourceAuthorization)
      .where(eq(providerResourceAuthorization.id, 'event-connection'))
    let [grant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'event-grant'))
    expect(connection).toMatchObject({
      status: 'active',
      grantedScopes: ['contents:read'],
      authorizationDetails: [
        { type: 'provider_installation', resource_id: 'repository-1' },
        { type: 'provider_installation', resource_id: 'repository-2' },
        { type: 'provider_installation', selector: { repositories: ['repository-1', 'repository-2'] } },
      ],
    })
    expect(grant.endReason).toBe('revoked')
    const [unaffectedGrant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'unaffected-event-grant'))
    expect(unaffectedGrant.endedAt).toBeNull()
    const [retainedAffectedGrant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'retained-affected-event-grant'))
    expect(retainedAffectedGrant.endedAt).toBeNull()
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
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:01:30.000Z',
          revision: 3,
          scopes: ['contents:read'],
          authorizationDetails: [
            { type: 'provider_installation', resource_id: 'repository-1' },
            { type: 'provider_installation', resource_id: 'repository-2' },
            { type: 'provider_installation', resource_id: 'repository-3' },
            { type: 'provider_installation', selector: { repositories: ['repository-2', 'repository-1'] } },
          ],
          authorityConstraints: constraintsFor(
            [
              { type: 'provider_installation', resource_id: 'repository-1' },
              { type: 'provider_installation', resource_id: 'repository-2' },
              { type: 'provider_installation', resource_id: 'repository-3' },
              { type: 'provider_installation', selector: { repositories: ['repository-2', 'repository-1'] } },
            ],
            ['contents:read'],
          ),
        })
      ).status,
    ).toBe(204)
    const [grantAfterResourceExpansion] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'unaffected-event-grant'))
    expect(grantAfterResourceExpansion.endedAt).toBeNull()

    expect(
      (
        await putEvent(harness, 'delivery-stale', {
          type: 'revoked',
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
    ;[grant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'event-grant'))
    expect(connection.status).toBe('active')
    expect(grant.endReason).toBe('revoked')

    expect(
      (
        await putEvent(harness, 'delivery-2', {
          type: 'suspended',
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
    ;[grant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'event-grant'))
    expect(connection.status).toBe('suspended')
    expect(grant.endReason).toBe('revoked')
    const [suspendedUnaffectedGrant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'unaffected-event-grant'))
    expect(suspendedUnaffectedGrant.endedAt).toBeNull()
    const [suspendedPendingRequest] = await harness.db
      .select()
      .from(agentAccessRequest)
      .where(eq(agentAccessRequest.id, 'unaffected-pending-event-access-request'))
    expect(suspendedPendingRequest.status).toBe('expired')
    await expect(
      harness.deps.externalResources.createTokenLease({
        id: 'lease-after-suspension',
        entitlementIds: ['unaffected-event-grant'],
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
          brokerReference: 'installation-1',
          occurredAt: '2026-08-08T20:03:00.000Z',
          revision: 5,
          scopes: ['contents:read'],
          authorizationDetails: connection.authorizationDetails,
          authorityConstraints: constraintsFor(connection.authorizationDetails, ['contents:read']),
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await putEvent(harness, 'delivery-4', {
          type: 'revoked',
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
    ;[grant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'event-grant'))
    expect(connection.status).toBe('revoked')
    expect(grant.endReason).toBe('revoked')
  })

  it('orders events only by revision and compares nested authorization details structurally', async () => {
    const expansionOccurredAt = '2026-08-08T20:02:00.000Z'
    const expanded = {
      type: 'resourcesChanged',
      brokerReference: 'installation-1',
      occurredAt: expansionOccurredAt,
      revision: 1,
      scopes: ['contents:read'],
      authorizationDetails: [
        { type: 'provider_installation', resource_id: 'repository-1' },
        { type: 'provider_installation', resource_id: 'repository-2' },
        { type: 'provider_installation', selector: { repositories: ['repository-2', 'repository-1'] } },
      ],
      authorityConstraints: constraintsFor(
        [
          { type: 'provider_installation', resource_id: 'repository-1' },
          { type: 'provider_installation', resource_id: 'repository-2' },
          { type: 'provider_installation', selector: { repositories: ['repository-2', 'repository-1'] } },
        ],
        ['contents:read'],
      ),
    }
    expect((await putEvent(harness, 'delivery-structural-expansion', expanded)).status).toBe(204)

    let [nestedGrant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'nested-event-grant'))
    expect(nestedGrant.endedAt).toBeNull()

    const reduced = {
      ...expanded,
      occurredAt: '2026-08-08T20:01:00.000Z',
      revision: 2,
      scopes: ['contents:read'],
      authorizationDetails: [
        { type: 'provider_installation', resource_id: 'repository-2' },
        { type: 'provider_installation', selector: { repositories: ['repository-2'] } },
      ],
      authorityConstraints: constraintsFor(
        [
          { type: 'provider_installation', resource_id: 'repository-2' },
          { type: 'provider_installation', selector: { repositories: ['repository-2'] } },
        ],
        ['contents:read'],
      ),
    }
    expect((await putEvent(harness, 'delivery-structural-reduction', reduced)).status).toBe(204)

    ;[nestedGrant] = await harness.db
      .select()
      .from(resourceScopeEntitlement)
      .where(eq(resourceScopeEntitlement.id, 'nested-event-grant'))
    expect(nestedGrant.endReason).toBe('revoked')

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
    ).toBe(409)
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
  const path = `/api/resource-servers/event-resource/connection-events/${eventId}`
  const body = JSON.stringify(representation)
  const key = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = await exportJWK(key.publicKey)
  const tokenEndpoint = `${baseURL}/api/auth/oauth2/token`
  const tokenProof = await dpopProof(key.privateKey, publicJwk, { htm: 'POST', htu: tokenEndpoint })
  const tokenResponse = await harness.request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${publisher.clientId}:${publisher.clientSecret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
      DPoP: tokenProof,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource: `${baseURL}/api`,
      scope: 'connection-events:write',
    }),
  })
  expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200)
  const token = (await tokenResponse.json()) as { access_token: string; token_type: string }
  expect(token.token_type).toBe('DPoP')
  const proof = await dpopProof(key.privateKey, publicJwk, {
    htm: 'PUT',
    htu: `${baseURL}${path}`,
    ath: await sha256Base64Url(token.access_token),
  })
  return harness.request(path, {
    method: 'PUT',
    headers: {
      Authorization: `DPoP ${token.access_token}`,
      'Content-Type': 'application/json',
      DPoP: proof,
    },
    body,
  })
}

async function dpopProof(
  privateKey: CryptoKey,
  publicJwk: JsonWebKey,
  claims: { htm: string; htu: string; ath?: string },
) {
  return new SignJWT({ ...claims, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .sign(privateKey)
}

async function sha256Base64Url(value: string) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('base64url')
}

function constraintsFor(authorizationDetails: Array<{ type: string; [key: string]: JsonValue }>, scopes: string[]) {
  return authorizationDetails.map((authorizationDetail) => ({ authorizationDetails: [authorizationDetail], scopes }))
}
