import { createTestDeps } from '@server/http/test-deps'
import {
  activateAgentIdentity,
  approveAgentEnrollment,
  createAdditionalAgentEnrollmentIntent,
  createAgentEnrollmentIntent,
  createAgentLoginIdentity,
  deactivateAgentIdentity,
  deleteAgentIdentity,
  emergencyActivateAgentIdentity,
  emergencyDeactivateAgentIdentity,
  emergencyDeleteAgentIdentity,
  getAgent,
  getAgentEnrollmentIntent,
  getAgentIdentityByProtocolAgent,
  getManagementAgent,
  getManagementAgentPermission,
  getPersonalAgent,
  getProtocolAgentEnrollment,
  getPublicAgentEnrollment,
  listAllAgentIdentities,
  listAllAgents,
  listManagementAgentInstallations,
  listManagementAgentPermissions,
  listOrganizationAgentIdentities,
  listPersonalAgentIdentities,
  listPersonalAgents,
  recoverAgentIdentity,
  requireActiveAgentIdentity,
  revokeAgentIdentityHost,
  toAgent,
  toAgentEnrollment,
} from '@server/usecases/agent-identities'
import type {
  AgentEnrollmentIntentRecord,
  AgentIdentityAggregate,
  AgentIdentityRecord,
  AgentRecord,
} from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

describe('Agent login identity', () => {
  it('projects an already-normalized Agent identity', () => {
    expect(
      toAgent({
        id: 'identity-1',
        issuer: 'https://agent.example.com',
        subject: 'agent-1',
        name: 'Agent',
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'active',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        bindings: [],
      }),
    ).toMatchObject({ id: 'identity-1', createdAt: '2026-08-01T00:00:00.000Z' })
  })
  it('creates, binds, and audits one personal stable identity after controller approval [spec: agent-identity/agent-governance-audit]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue({
      id: 'protocol-agent-1',
      hostId: 'host-1',
      userId: 'user-1',
      status: 'active',
    } as AgentRecord)
    vi.mocked(deps.agentIdentities.createIdentity).mockImplementation(async (input) => ({
      identity: input.identity,
      bindings: [{ ...input.binding, hostId: 'host-1' }],
    }))

    const identity = await createAgentLoginIdentity(
      deps,
      { protocolAgentId: 'protocol-agent-1', name: 'Build Agent' },
      'https://auth.example.com',
      'user-1',
    )

    expect(identity).toMatchObject({
      issuer: 'https://auth.example.com',
      name: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      bindings: [{ protocolAgentId: 'protocol-agent-1', hostId: 'host-1', status: 'active' }],
    })
    expect(identity.subject).toMatch(/^00000000-0000-7000-8000-/)
    expect(deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent.identity_enrolled',
        result: 'allowed',
        controllerUserId: 'user-1',
        agentIdentityId: identity.id,
        hostId: 'host-1',
        scopes: null,
      }),
    )
    expect(deps.agentAudit.append).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ credential: expect.anything() }) }),
    )
  })

  it('returns the existing identity when login is retried', async () => {
    const deps = createTestDeps()
    const existing = {
      identity: {
        id: 'identity-1',
        issuer: 'https://auth.example.com',
        subject: 'agt_stable',
        name: 'Build Agent',
        ownerUserId: 'user-1',
        ownerOrganizationId: null,
        status: 'active',
        deletedAt: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      bindings: [
        {
          id: 'binding-1',
          agentIdentityId: 'identity-1',
          protocolAgentId: 'protocol-agent-1',
          hostId: 'host-1',
          status: 'active',
          boundAt: new Date('2026-08-01T00:00:00.000Z'),
          revokedAt: null,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    } satisfies AgentIdentityAggregate
    vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(existing)

    const identity = await createAgentLoginIdentity(
      deps,
      { protocolAgentId: 'protocol-agent-1', name: 'Ignored retry name' },
      'https://auth.example.com',
      'user-1',
    )

    expect(identity.subject).toBe('agt_stable')
    expect(deps.agentIdentities.createIdentity).not.toHaveBeenCalled()
  })
})

describe('Agent identity lifecycle', () => {
  it('lists personal, organization, and inventory identities', async () => {
    const deps = identityDeps()
    const personal = aggregate()
    const organization = aggregate({ ownerUserId: null, ownerOrganizationId: 'org-1' })
    vi.mocked(deps.agentIdentities.listPersonal).mockResolvedValue([personal])
    vi.mocked(deps.agentIdentities.listOrganization).mockResolvedValue([organization])
    vi.mocked(deps.agentIdentities.listAll).mockResolvedValue({
      items: [personal, organization],
      total: 2,
      limit: 20,
      offset: 5,
    })
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('owner'))

    await expect(listPersonalAgentIdentities(deps, 'user-1')).resolves.toMatchObject({
      identities: [{ homeSpace: { type: 'personal', userId: 'user-1' } }],
    })
    await expect(listOrganizationAgentIdentities(deps, 'org-1', 'user-1')).resolves.toMatchObject({
      identities: [{ homeSpace: { type: 'organization', organizationId: 'org-1' } }],
    })
    await expect(listAllAgentIdentities(deps, { limit: 20, offset: 5 })).resolves.toMatchObject({
      total: 2,
      limit: 20,
      offset: 5,
    })

    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('member'))
    await expect(listOrganizationAgentIdentities(deps, 'org-1', 'user-1')).rejects.toMatchObject({ status: 403 })
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(null)
    await expect(listOrganizationAgentIdentities(deps, 'org-1', 'user-1')).rejects.toMatchObject({ status: 403 })
  })

  it('maps paginated Agent resources and public enrollment views', async () => {
    const deps = identityDeps()
    const stored = aggregate()
    vi.mocked(deps.agentIdentities.listPersonal).mockResolvedValue([stored])
    vi.mocked(deps.agentIdentities.listAll).mockResolvedValue({
      items: [stored],
      total: 1,
      limit: 10,
      offset: 0,
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(stored)
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(intent())

    await expect(listPersonalAgents(deps, 'user-1', { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'identity-1', subject: 'agt_stable' }],
      pagination: { total: 1, hasMore: false },
    })
    await expect(listAllAgents(deps, { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'identity-1' }],
      pagination: { total: 1 },
    })
    await expect(getPersonalAgent(deps, 'identity-1', 'user-1')).resolves.toMatchObject({ id: 'identity-1' })
    await expect(getAgent(deps, 'identity-1')).resolves.toMatchObject({ id: 'identity-1' })
    await expect(getPublicAgentEnrollment(deps, 'intent-1', 'user-1')).resolves.toMatchObject({
      id: 'intent-1',
      agentId: null,
      name: 'Build Agent',
      kind: 'new_identity',
      status: 'pending',
      decidedAt: null,
    })

    const approved = toAgentEnrollment(
      {
        id: 'intent-2',
        agentIdentityId: 'identity-1',
        protocolAgentId: 'protocol-agent-1',
        requestedName: null,
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'approved',
        expiresAt: '2026-08-01T01:00:00.000Z',
        approvedAt: '2026-08-01T00:30:00.000Z',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:30:00.000Z',
      },
      'Build Agent',
    )
    expect(approved).toMatchObject({
      agentId: 'identity-1',
      name: 'Build Agent',
      kind: 'additional_host',
      status: 'approved',
      decidedAt: '2026-08-01T00:30:00.000Z',
    })

    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(
      intent({ agentIdentityId: 'identity-1', requestedName: null }),
    )
    await expect(getProtocolAgentEnrollment(deps, 'intent-1', 'protocol-agent-1')).resolves.toMatchObject({
      id: 'intent-1',
      name: 'Build Agent',
      kind: 'additional_host',
    })
    await expect(getProtocolAgentEnrollment(deps, 'intent-1', 'another-agent')).rejects.toMatchObject({ status: 403 })
  })

  it('maps management summaries, installations, access requests, and scope Entitlements [spec: admin-console/admin-agent-governance-detail]', async () => {
    const deps = managementDeps()
    const stored = aggregate()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(stored)
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      id: 'resource-1',
      identifier: 'projects',
      name: 'Projects API',
    } as never)

    await expect(getManagementAgent(deps, 'identity-1')).resolves.toMatchObject({
      agent: {
        id: 'identity-1',
        owner: { id: 'user-1', type: 'user', displayName: 'user-1@example.com' },
        installationCount: 1,
        pendingRequestCount: 0,
        activeResourceCount: 1,
        activeScopeCount: 1,
      },
    })

    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValue([
      {
        id: 'host-1',
        name: 'MacBook',
        jwksUrl: null,
        publicKey: { kty: 'OKP' },
        lastUsedAt: new Date('2026-08-02T01:00:00.000Z'),
      },
    ] as never)
    await expect(listManagementAgentInstallations(deps, 'identity-1', { limit: 20, offset: 0 })).resolves.toEqual({
      items: [
        {
          id: 'binding-1',
          name: 'MacBook',
          status: 'active',
          credentialType: 'public_key',
          boundAt: '2026-08-01T00:00:00.000Z',
          lastSeenAt: '2026-08-02T01:00:00.000Z',
        },
      ],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })

    const grants = [
      {
        id: 'grant-expired',
        userId: null,
        applicationId: null,
        agentIdentityId: 'identity-1',
        organizationId: null,
        resourceServerId: 'resource-1',
        connectionId: null,
        authorizationDetails: [],
        authorizationContextHash: 'hash',
        scope: 'projects:read',
        mode: 'until',
        grantedByUserId: 'user-1',
        grantedByAgentIdentityId: null,
        sourceAccessRequestId: 'request-1',
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        endedAt: null,
        endReason: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        id: 'grant-active',
        userId: null,
        applicationId: null,
        agentIdentityId: 'identity-1',
        organizationId: null,
        resourceServerId: 'resource-1',
        connectionId: null,
        authorizationDetails: [],
        authorizationContextHash: 'hash',
        scope: 'projects:write',
        mode: 'persistent',
        grantedByUserId: 'user-1',
        grantedByAgentIdentityId: null,
        sourceAccessRequestId: 'request-1',
        expiresAt: null,
        endedAt: null,
        endReason: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]
    vi.mocked(deps.externalResources.listAgentPermissions).mockResolvedValue({
      items: [grants[1]].map((entitlement) => ({
        entitlement: entitlement!,
        resource: { id: 'resource-1', identifier: 'projects', name: 'Projects API' },
      })),
      total: 1,
      limit: 20,
      offset: 0,
    } as never)
    await expect(
      listManagementAgentPermissions(deps, { agentId: 'agent-1', limit: 20, offset: 0 }),
    ).resolves.toMatchObject({
      items: [{ id: 'grant-active', status: 'active', expiresAt: null }],
      pagination: { total: 1 },
    })
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grants[1] as never)
    await expect(getManagementAgentPermission(deps, 'grant-active')).resolves.toMatchObject({
      id: 'grant-active',
      status: 'active',
      expiresAt: null,
    })

    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grants[0] as never)
    vi.mocked(deps.externalResources.listAgentPermissions).mockResolvedValue({
      items: [
        {
          entitlement: grants[0]!,
          resource: { id: 'resource-1', identifier: 'projects', name: 'Projects API' },
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    } as never)
    await expect(getManagementAgentPermission(deps, 'grant-expired')).resolves.toMatchObject({
      status: 'ended',
      endReason: 'expired',
      expiresAt: '2020-01-01T00:00:00.000Z',
    })
    expect(deps.externalResources.listAgentPermissions).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'inactive' }),
      undefined,
    )
  })

  it('projects remote JWKS installations with stable pagination and host fallbacks', async () => {
    const deps = managementDeps()
    const stored = aggregate()
    stored.bindings.push({
      ...stored.bindings[0]!,
      id: 'binding-2',
      protocolAgentId: 'protocol-agent-2',
      hostId: 'host-2',
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(stored)
    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValue([
      { id: 'host-1', name: null, jwksUrl: 'https://agent.example.com/jwks', publicKey: null, lastUsedAt: null },
      {
        id: 'host-2',
        name: 'Second host',
        jwksUrl: 'https://agent-2.example.com/jwks',
        publicKey: null,
        lastUsedAt: null,
      },
    ] as never)

    await expect(listManagementAgentInstallations(deps, 'identity-1', { limit: 1, offset: 0 })).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 'binding-2',
          name: 'Second host',
          credentialType: 'remote_jwks',
          lastSeenAt: null,
        }),
      ],
      pagination: { limit: 1, offset: 0, total: 2, hasMore: true, nextOffset: 1 },
    })

    await expect(listManagementAgentInstallations(deps, 'identity-1', { limit: 1, offset: 1 })).resolves.toEqual({
      items: [expect.objectContaining({ id: 'binding-1', name: 'host-1', credentialType: 'remote_jwks' })],
      pagination: { limit: 1, offset: 1, total: 2, hasMore: false, nextOffset: null },
    })
  })

  it('surfaces corrupt management Agent projections and missing governance records', async () => {
    const deps = managementDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())

    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValue([])
    await expect(listManagementAgentInstallations(deps, 'identity-1', { limit: 20, offset: 0 })).rejects.toThrow(
      'was not found',
    )
    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValue([
      { id: 'host-1', name: null, jwksUrl: null, publicKey: null, lastUsedAt: null },
    ] as never)
    await expect(listManagementAgentInstallations(deps, 'identity-1', { limit: 20, offset: 0 })).rejects.toThrow(
      'has no authentication credential',
    )

    await expect(getManagementAgentPermission(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      id: 'deleted-resource-grant',
      resourceId: 'deleted-resource',
      agentIdentityId: 'identity-1',
      status: 'active',
    } as never)
    await expect(getManagementAgentPermission(deps, 'deleted-resource-grant')).rejects.toMatchObject({
      status: 404,
    })

    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(null)
    await expect(getProtocolAgentEnrollment(deps, 'missing', 'protocol-agent-1')).rejects.toMatchObject({ status: 404 })
  })

  it('maps Organization-owned management Agents and validates summary invariants', async () => {
    const deps = managementDeps()
    const organizationOwned = aggregate({ ownerUserId: null, ownerOrganizationId: 'org-1' })
    vi.mocked(deps.agentIdentities.listOwned).mockResolvedValue({
      items: [organizationOwned],
      total: 1,
      limit: 20,
      offset: 0,
    })
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      name: 'acme',
      displayName: null,
    } as never)

    await expect(
      listAllAgents(deps, { limit: 20, offset: 0 }, { ownerOrganizationIds: ['org-1'] }),
    ).resolves.toMatchObject({
      items: [{ owner: { id: 'org-1', type: 'organization', displayName: 'acme' } }],
    })

    vi.mocked(deps.authorization.findOrganization).mockResolvedValue(null)
    await expect(listAllAgents(deps, { limit: 20, offset: 0 }, { ownerOrganizationIds: ['org-1'] })).rejects.toThrow(
      'owner Organization org-1 was not found',
    )

    vi.mocked(deps.agentIdentities.listAll).mockResolvedValue({
      items: [aggregate()],
      total: 1,
      limit: 20,
      offset: 0,
    })
    vi.mocked(deps.externalResources.summarizeAgentAccess).mockResolvedValue(new Map())
    await expect(listAllAgents(deps, { limit: 20, offset: 0 })).rejects.toThrow('access summary was not resolved')
    vi.mocked(deps.externalResources.summarizeAgentAccess).mockResolvedValue(
      new Map([['identity-1', { pendingRequestCount: 0, activeResourceCount: 0, activeScopeCount: 0 }]]),
    )
    await expect(listAllAgents(deps, { limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [{ installationCount: 1 }],
    })
  })

  it('gets only active protocol-bound identities', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(aggregate())
    await expect(getAgentIdentityByProtocolAgent(deps, 'protocol-agent-1')).resolves.toMatchObject({
      subject: 'agt_stable',
    })
    await expect(requireActiveAgentIdentity(deps, 'protocol-agent-1')).resolves.toMatchObject({
      identity: { id: 'identity-1' },
    })

    vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(null)
    await expect(getAgentIdentityByProtocolAgent(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(requireActiveAgentIdentity(deps, 'missing')).rejects.toMatchObject({ status: 403 })
  })

  it('rejects login enrollment without the controller-owned active protocol registration', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue(null)
    await expect(
      createAgentLoginIdentity(deps, loginInput(), 'https://auth.example.com', 'user-1'),
    ).rejects.toMatchObject({ status: 404 })

    vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue({
      id: 'protocol-agent-1',
      hostId: 'host-1',
      userId: 'other-user',
      status: 'active',
    } as AgentRecord)
    await expect(
      createAgentLoginIdentity(deps, loginInput(), 'https://auth.example.com', 'user-1'),
    ).rejects.toMatchObject({ status: 404 })

    vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue({
      id: 'protocol-agent-1',
      hostId: 'host-1',
      userId: 'user-1',
      status: 'revoked',
    } as AgentRecord)
    await expect(
      createAgentLoginIdentity(deps, loginInput(), 'https://auth.example.com', 'user-1'),
    ).rejects.toMatchObject({ status: 404 })

    vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue({
      id: 'protocol-agent-1',
      hostId: 'host-1',
      userId: 'user-1',
      status: 'active',
    } as AgentRecord)
    vi.mocked(deps.agentIdentities.findBindingByProtocolAgent).mockResolvedValue(aggregate().bindings[0]!)
    await expect(
      createAgentLoginIdentity(deps, loginInput(), 'https://auth.example.com', 'user-1'),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('creates personal and organization enrollment intents and reads them through controller checks', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.createIntentIdempotently).mockImplementation(async (record) => ({
      intent: record,
      created: true,
    }))

    const personal = await createAgentEnrollmentIntent(deps, loginInput(), 'user-1', 'personal-key')
    expect(personal.intent).toMatchObject({
      requestedName: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'pending',
    })

    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('admin'))
    const organization = await createAgentEnrollmentIntent(
      deps,
      { ...loginInput(), organizationId: 'org-1' },
      'user-1',
      'organization-key',
    )
    expect(organization.intent.homeSpace).toEqual({ type: 'organization', organizationId: 'org-1' })

    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(intent())
    await expect(getAgentEnrollmentIntent(deps, 'intent-1', 'user-1')).resolves.toMatchObject({ id: 'intent-1' })
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(null)
    await expect(getAgentEnrollmentIntent(deps, 'missing', 'user-1')).rejects.toMatchObject({ status: 404 })
  })

  it('replays a completed identity enrollment without replacing the stable identity [spec: agent-identity/agent-identity-enrollment]', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(
      intent({ idempotencyKey: 'enrollment-key', status: 'approved', approvedAt: new Date() }),
    )

    const result = await createAgentEnrollmentIntent(deps, loginInput(), 'user-1', 'enrollment-key')

    expect(result).toMatchObject({ replayed: true, intent: { id: 'intent-1', status: 'approved' } })
    expect(deps.agentIdentities.createIntentIdempotently).not.toHaveBeenCalled()
    expect(deps.agentIdentities.findBindingByProtocolAgent).not.toHaveBeenCalled()
  })

  it('returns the approved enrollment when a migrated client uses a new retry key [spec: agent-identity/agent-identity-enrollment]', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(aggregate())
    vi.mocked(deps.agentIdentities.findLatestApprovedIdentityIntent).mockResolvedValue(
      intent({ idempotencyKey: null, status: 'approved', approvedAt: new Date() }),
    )

    const result = await createAgentEnrollmentIntent(deps, loginInput(), 'user-1', 'migrated-key')

    expect(result).toMatchObject({ replayed: true, intent: { id: 'intent-1', status: 'approved' } })
    expect(deps.agentIdentities.createIntentIdempotently).not.toHaveBeenCalled()
  })

  it('materializes one approved replay record for a bound legacy identity [spec: agent-identity/agent-identity-enrollment]', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(aggregate())
    vi.mocked(deps.agentIdentities.createIntentIdempotently).mockImplementation(async (record) => ({
      intent: record,
      created: true,
    }))

    const result = await createAgentEnrollmentIntent(deps, loginInput(), 'user-1', 'migrated-key')

    expect(result).toMatchObject({
      replayed: true,
      intent: { requestedName: 'Build Agent', status: 'approved', homeSpace: { type: 'personal', userId: 'user-1' } },
    })
    expect(deps.agentIdentities.createIntentIdempotently).toHaveBeenCalledOnce()
  })

  it('creates an additional host intent for a controlled non-deleted identity', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(deps.agentIdentities.createIntentIdempotently).mockImplementation(async (record) => ({
      intent: record,
      created: true,
    }))

    await expect(
      createAdditionalAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'enrollment-key-1'),
    ).resolves.toMatchObject({
      intent: { agentIdentityId: 'identity-1', requestedName: null },
      replayed: false,
    })

    vi.mocked(deps.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(
      intent({ agentIdentityId: 'identity-1', requestedName: null, idempotencyKey: 'enrollment-key-1' }),
    )
    await expect(
      createAdditionalAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'enrollment-key-1'),
    ).resolves.toMatchObject({ intent: { id: 'intent-1' }, replayed: true })
    await expect(
      createAdditionalAgentEnrollmentIntent(deps, 'other-identity', 'protocol-agent-1', 'user-1', 'enrollment-key-1'),
    ).rejects.toMatchObject({ status: 409 })

    vi.mocked(deps.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(
      intent({
        agentIdentityId: 'identity-1',
        requestedName: null,
        idempotencyKey: 'enrollment-key-1',
        createdByUserId: 'other-user',
      }),
    )
    await expect(
      createAdditionalAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'enrollment-key-1'),
    ).rejects.toMatchObject({ status: 403 })

    vi.mocked(deps.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(null)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate({ status: 'inactive' }))
    await expect(
      createAdditionalAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'enrollment-key-2'),
    ).resolves.toMatchObject({ intent: { agentIdentityId: 'identity-1' }, replayed: false })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(null)
    await expect(
      createAdditionalAgentEnrollmentIntent(deps, 'missing', 'protocol-agent-1', 'user-1', 'enrollment-key-3'),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('approves new and additional host enrollments', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(intent())
    vi.mocked(deps.agentIdentities.approveIntent).mockImplementation(async ({ identity, binding }) => ({
      identity: identity!,
      bindings: [{ ...binding, hostId: 'host-1' }],
    }))

    await expect(approveAgentEnrollment(deps, 'intent-1', 'https://auth.example.com', 'user-1')).resolves.toMatchObject(
      {
        identity: { name: 'Build Agent', homeSpace: { type: 'personal' } },
      },
    )

    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(
      intent({ ownerUserId: null, ownerOrganizationId: 'org-1' }),
    )
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('admin'))
    vi.mocked(deps.agentIdentities.approveIntent).mockImplementation(async ({ identity, binding }) => ({
      identity: identity!,
      bindings: [{ ...binding, hostId: 'host-1' }],
    }))
    await expect(approveAgentEnrollment(deps, 'intent-1', 'https://auth.example.com', 'user-1')).resolves.toMatchObject(
      { identity: { homeSpace: { type: 'organization', organizationId: 'org-1' } } },
    )
    expect(deps.agentAudit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownerUserId: null, ownerOrganizationId: 'org-1' }),
    )

    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(
      intent({ agentIdentityId: 'identity-1', requestedName: null }),
    )
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(deps.agentIdentities.approveIntent).mockImplementation(async ({ binding }) => ({
      ...aggregate(),
      bindings: [{ ...binding, hostId: 'host-1' }],
    }))
    await expect(approveAgentEnrollment(deps, 'intent-1', 'https://auth.example.com', 'user-1')).resolves.toMatchObject(
      {
        identity: { id: 'identity-1' },
      },
    )
  })

  it('rejects invalid enrollment approvals', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(null)
    await expect(approveAgentEnrollment(deps, 'missing', 'https://auth.example.com', 'user-1')).rejects.toMatchObject({
      status: 404,
    })
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(intent({ status: 'approved' }))
    await expect(approveAgentEnrollment(deps, 'intent-1', 'https://auth.example.com', 'user-1')).rejects.toMatchObject({
      status: 400,
    })
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(
      intent({ expiresAt: new Date(Date.now() - 1), status: 'pending' }),
    )
    await expect(approveAgentEnrollment(deps, 'intent-1', 'https://auth.example.com', 'user-1')).rejects.toMatchObject({
      status: 400,
    })
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(
      intent({ agentIdentityId: 'identity-1', requestedName: null }),
    )
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(
      aggregate({ ownerUserId: null, ownerOrganizationId: 'org-1' }),
    )
    await expect(approveAgentEnrollment(deps, 'intent-1', 'https://auth.example.com', 'user-1')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('revokes hosts, recovers, toggles, and soft-deletes identities with state-specific errors', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(deps.agentIdentities.revokeBinding).mockResolvedValue(true)
    vi.mocked(deps.agentIdentities.deactivateIdentity).mockResolvedValue(true)
    vi.mocked(deps.agentIdentities.activateIdentity).mockResolvedValue(true)
    vi.mocked(deps.agentIdentities.deleteIdentity).mockResolvedValue(true)

    await expect(revokeAgentIdentityHost(deps, 'identity-1', 'protocol-agent-1', 'user-1')).resolves.toBeUndefined()
    await expect(recoverAgentIdentity(deps, 'identity-1', 'user-1')).resolves.toBeUndefined()
    await expect(deactivateAgentIdentity(deps, 'identity-1', 'user-1')).resolves.toBeUndefined()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate({ status: 'inactive' }))
    await expect(activateAgentIdentity(deps, 'identity-1', 'user-1')).resolves.toBeUndefined()
    await expect(deleteAgentIdentity(deps, 'identity-1', 'user-1')).resolves.toBeUndefined()
    await expect(emergencyDeleteAgentIdentity(deps, 'identity-1', 'admin-1')).resolves.toBeUndefined()
    await expect(emergencyDeactivateAgentIdentity(deps, 'identity-1', 'admin-1')).resolves.toBeUndefined()
    await expect(emergencyActivateAgentIdentity(deps, 'identity-1', 'admin-1')).resolves.toBeUndefined()

    vi.mocked(deps.agentIdentities.revokeBinding).mockResolvedValue(false)
    await expect(revokeAgentIdentityHost(deps, 'identity-1', 'protocol-agent-1', 'user-1')).rejects.toMatchObject({
      status: 404,
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(deps.agentIdentities.deactivateIdentity).mockResolvedValue(false)
    await expect(recoverAgentIdentity(deps, 'identity-1', 'user-1')).rejects.toMatchObject({ status: 400 })
    await expect(deactivateAgentIdentity(deps, 'identity-1', 'user-1')).rejects.toMatchObject({ status: 404 })
    await expect(emergencyDeactivateAgentIdentity(deps, 'identity-1', 'admin-1')).rejects.toMatchObject({ status: 404 })
    vi.mocked(deps.agentIdentities.deleteIdentity).mockResolvedValue(false)
    await expect(deleteAgentIdentity(deps, 'identity-1', 'user-1')).rejects.toMatchObject({ status: 404 })
    await expect(emergencyDeleteAgentIdentity(deps, 'identity-1', 'admin-1')).rejects.toMatchObject({ status: 404 })

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate({ status: 'inactive' }))
    vi.mocked(deps.agentIdentities.activateIdentity).mockResolvedValue(false)
    await expect(activateAgentIdentity(deps, 'identity-1', 'user-1')).rejects.toMatchObject({ status: 400 })
    await expect(emergencyActivateAgentIdentity(deps, 'identity-1', 'admin-1')).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    await expect(activateAgentIdentity(deps, 'identity-1', 'user-1')).resolves.toBeUndefined()
    await expect(emergencyActivateAgentIdentity(deps, 'identity-1', 'admin-1')).resolves.toBeUndefined()
    const identityWithoutBindings = aggregate()
    identityWithoutBindings.bindings = []
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityWithoutBindings)
    vi.mocked(deps.agentIdentities.deactivateIdentity).mockResolvedValue(true)
    await expect(emergencyDeactivateAgentIdentity(deps, 'identity-1', 'admin-1')).resolves.toBeUndefined()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate({ ownerUserId: 'other-user' }))
    await expect(deleteAgentIdentity(deps, 'identity-1', 'user-1')).rejects.toMatchObject({ status: 403 })

    const withoutMatchingBinding = aggregate()
    withoutMatchingBinding.bindings[0] = {
      ...withoutMatchingBinding.bindings[0]!,
      protocolAgentId: 'another-protocol-agent',
    }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(withoutMatchingBinding)
    vi.mocked(deps.agentIdentities.revokeBinding).mockResolvedValue(true)
    await expect(revokeAgentIdentityHost(deps, 'identity-1', 'protocol-agent-1', 'user-1')).resolves.toBeUndefined()
  })

  it('rejects enrollment projections that cannot resolve a display name', async () => {
    expect(() =>
      toAgentEnrollment({
        id: 'intent-without-name',
        agentIdentityId: null,
        protocolAgentId: 'protocol-agent-1',
        requestedName: null,
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'pending',
        expiresAt: new Date(),
        approvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow('does not resolve to an Agent name')

    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(intent({ requestedName: null, agentIdentityId: null }))
    await expect(getPublicAgentEnrollment(deps, 'intent-1', 'user-1')).rejects.toThrow(
      'has no requested or existing identity',
    )
  })

  it('surfaces the owner invariant when persisted identity data is invalid', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.listPersonal).mockResolvedValue([
      aggregate({ ownerUserId: null, ownerOrganizationId: null }),
    ])
    await expect(listPersonalAgentIdentities(deps, 'user-1')).rejects.toThrow('owner invariant')
  })
})

function enrollmentDeps() {
  const deps = identityDeps()
  vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue({
    id: 'protocol-agent-1',
    hostId: 'host-1',
    userId: 'user-1',
    status: 'active',
  } as AgentRecord)
  vi.mocked(deps.agentIdentities.findBindingByProtocolAgent).mockResolvedValue(null)
  return deps
}

function identityDeps() {
  return createTestDeps({
    authorization: {
      findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
    },
    externalResources: {
      summarizeAgentAccess: vi
        .fn()
        .mockImplementation((agentIds: string[]) =>
          Promise.resolve(
            new Map(
              agentIds.map((agentId) => [
                agentId,
                { pendingRequestCount: 0, activeResourceCount: 0, activeScopeCount: 0 },
              ]),
            ),
          ),
        ),
    },
  })
}

function managementDeps() {
  const deps = createTestDeps()
  vi.mocked(deps.externalResources.summarizeAgentAccess).mockImplementation((agentIds) =>
    Promise.resolve(
      new Map(
        agentIds.map((agentId) => [agentId, { pendingRequestCount: 0, activeResourceCount: 1, activeScopeCount: 1 }]),
      ),
    ),
  )
  return deps
}

function member(role: string) {
  return {
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    roles: [role],
    title: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function loginInput() {
  return { protocolAgentId: 'protocol-agent-1', name: 'Build Agent' }
}

function identity(overrides: Partial<AgentIdentityRecord> = {}): AgentIdentityRecord {
  const now = new Date('2026-08-01T00:00:00.000Z')
  return {
    id: 'identity-1',
    issuer: 'https://auth.example.com',
    subject: 'agt_stable',
    name: 'Build Agent',
    ownerUserId: 'user-1',
    ownerOrganizationId: null,
    status: 'active',
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function aggregate(overrides: Partial<AgentIdentityRecord> = {}): AgentIdentityAggregate {
  const record = identity(overrides)
  const now = record.createdAt
  return {
    identity: record,
    bindings: [
      {
        id: 'binding-1',
        agentIdentityId: record.id,
        protocolAgentId: 'protocol-agent-1',
        hostId: 'host-1',
        status: 'active',
        boundAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}

function intent(overrides: Partial<AgentEnrollmentIntentRecord> = {}): AgentEnrollmentIntentRecord {
  const now = new Date()
  return {
    id: 'intent-1',
    agentIdentityId: null,
    requestedName: 'Build Agent',
    ownerUserId: 'user-1',
    ownerOrganizationId: null,
    protocolAgentId: 'protocol-agent-1',
    idempotencyKey: null,
    status: 'pending',
    createdByUserId: 'user-1',
    approvedByUserId: null,
    expiresAt: new Date(now.getTime() + 60_000),
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
