import { createTestDeps } from '@server/http/test-deps'
import {
  approveAgentEnrollment,
  createAdditionalAgentEnrollmentIntent,
  createAgentEnrollmentIntent,
  createAgentLoginIdentity,
  createRecoveryAgentEnrollmentIntent,
  emergencyRetireAgentIdentity,
  getAgent,
  getAgentEnrollmentIntent,
  getAgentIdentityByProtocolAgent,
  getAgentIdentityInstallationRevocation,
  getAgentIdentityRecovery,
  getAgentInfo,
  getManagementAgent,
  getManagementAgentAccessGrant,
  getManagementAgentAccessRequest,
  getPersonalAgent,
  getProtocolAgentEnrollment,
  getPublicAgentEnrollment,
  listAllAgentIdentities,
  listAllAgents,
  listManagementAgentAccessGrants,
  listManagementAgentAccessRequests,
  listManagementAgentInstallations,
  listOrganizationAgentIdentities,
  listPersonalAgentIdentities,
  listPersonalAgents,
  recoverAgentIdentity,
  replaceAgentIdentityInstallationRevocation,
  replaceAgentIdentityRecovery,
  replaceAgentIdentityRetirement,
  requireActiveAgentIdentity,
  retireAgentIdentity,
  revokeAgentIdentityHost,
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
  it('returns public display information for a stable Agent subject [spec: agent-identity/agent-info-resolution]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findByIssuerSubject).mockResolvedValue(
      identity({ status: 'retired', retiredAt: new Date('2026-08-02T00:00:00.000Z') }),
    )

    await expect(getAgentInfo(deps, 'https://auth.example.com', 'agt_stable')).resolves.toEqual({
      iss: 'https://auth.example.com',
      sub: 'agt_stable',
      sub_profile: 'ai_agent',
      name: 'Build Agent',
      picture: 'https://auth.example.com/agent-picture-v1.svg',
      updated_at: 1785542400,
    })
    expect(deps.agentIdentities.findByIssuerSubject).toHaveBeenCalledWith('https://auth.example.com', 'agt_stable')
  })

  it('does not resolve an unknown Agent subject', async () => {
    const deps = createTestDeps()

    await expect(getAgentInfo(deps, 'https://auth.example.com', 'agt_unknown')).rejects.toMatchObject({
      status: 404,
    })
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
    expect(identity.subject).toMatch(/^agt_/)
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
        retiredAt: null,
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
        recovery: false,
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

  it('maps management summaries, installations, access requests, and access grants', async () => {
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
        roleCount: 0,
        pendingRequestCount: 0,
        activeGrantCount: 0,
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

    const request = {
      id: 'request-1',
      agentIdentityId: 'identity-1',
      resourceId: 'resource-1',
      scopes: ['projects:read'],
      reason: null,
      status: 'pending',
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      decidedAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    }
    vi.mocked(deps.externalResources.listAccessRequests).mockResolvedValue({
      items: [request],
      total: 1,
      limit: 20,
      offset: 0,
    } as never)
    await expect(
      listManagementAgentAccessRequests(deps, { limit: 20, offset: 0 }, { ownerOrganizationIds: ['org-1'] }),
    ).resolves.toMatchObject({
      items: [{ id: 'request-1', status: 'expired', resource: { id: 'resource-1' }, decidedAt: null }],
      pagination: { total: 1 },
    })
    expect(deps.externalResources.listAccessRequests).toHaveBeenCalledWith(
      { limit: 20, offset: 0 },
      { ownerOrganizationIds: ['org-1'] },
    )

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...request,
      status: 'approved',
      decidedAt: new Date('2026-08-02T00:00:00.000Z'),
    } as never)
    await expect(getManagementAgentAccessRequest(deps, 'request-1')).resolves.toMatchObject({
      status: 'approved',
      decidedAt: '2026-08-02T00:00:00.000Z',
    })

    const grants = [
      {
        id: 'grant-expired',
        agentIdentityId: 'identity-1',
        resourceId: 'resource-1',
        scopes: ['projects:read'],
        mode: 'native',
        status: 'active',
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        id: 'grant-active',
        agentIdentityId: 'identity-1',
        resourceId: 'resource-1',
        scopes: ['projects:write'],
        mode: 'external',
        status: 'active',
        expiresAt: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]
    vi.mocked(deps.externalResources.listGrants).mockResolvedValue({
      items: grants,
      total: 2,
      limit: 20,
      offset: 0,
    } as never)
    await expect(listManagementAgentAccessGrants(deps, { limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [
        { id: 'grant-expired', status: 'expired', expiresAt: '2020-01-01T00:00:00.000Z' },
        { id: 'grant-active', status: 'active', expiresAt: null },
      ],
      pagination: { total: 2 },
    })
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grants[1] as never)
    await expect(getManagementAgentAccessGrant(deps, 'grant-active')).resolves.toMatchObject({
      id: 'grant-active',
      status: 'active',
      expiresAt: null,
    })

    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grants[0] as never)
    await expect(getManagementAgentAccessGrant(deps, 'grant-expired')).resolves.toMatchObject({
      status: 'expired',
      expiresAt: '2020-01-01T00:00:00.000Z',
    })
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

    await expect(getManagementAgentAccessRequest(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(getManagementAgentAccessGrant(deps, 'missing')).rejects.toMatchObject({ status: 404 })

    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(null)
    await expect(getProtocolAgentEnrollment(deps, 'missing', 'protocol-agent-1')).rejects.toMatchObject({ status: 404 })

    vi.mocked(deps.externalResources.listAccessRequests).mockResolvedValue({
      items: [
        {
          resourceId: 'missing-resource',
          agentIdentityId: 'identity-1',
          scopes: [],
          reason: null,
          status: 'pending',
          expiresAt: new Date(),
          decidedAt: null,
          createdAt: new Date(),
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    } as never)
    await expect(listManagementAgentAccessRequests(deps, { limit: 20, offset: 0 })).rejects.toThrow(
      'referenced by Agent governance was not found',
    )
  })

  it('maps Organization-owned management Agents and validates summary invariants', async () => {
    const deps = managementDeps()
    const organizationOwned = aggregate({ ownerUserId: null, ownerOrganizationId: 'org-1' })
    vi.mocked(deps.agentIdentities.listOwnedByOrganizations).mockResolvedValue({
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

    await expect(listAllAgents(deps, { limit: 20, offset: 0 }, ['org-1'])).resolves.toMatchObject({
      items: [{ owner: { id: 'org-1', type: 'organization', displayName: 'acme' } }],
    })

    vi.mocked(deps.authorization.findOrganization).mockResolvedValue(null)
    await expect(listAllAgents(deps, { limit: 20, offset: 0 }, ['org-1'])).rejects.toThrow(
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
      new Map([['identity-1', { pendingRequestCount: 0, activeGrantCount: 0 }]]),
    )
    vi.mocked(deps.authorization.countEffectiveAgentRoles).mockResolvedValue(new Map())
    await expect(listAllAgents(deps, { limit: 20, offset: 0 })).rejects.toThrow('Role summary was not resolved')
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
    vi.mocked(deps.agentIdentities.createIntent).mockImplementation(async (record) => record)

    const personal = await createAgentEnrollmentIntent(deps, loginInput(), 'user-1')
    expect(personal).toMatchObject({
      requestedName: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'pending',
    })

    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(member('admin'))
    const organization = await createAgentEnrollmentIntent(deps, { ...loginInput(), organizationId: 'org-1' }, 'user-1')
    expect(organization.homeSpace).toEqual({ type: 'organization', organizationId: 'org-1' })

    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(intent())
    await expect(getAgentEnrollmentIntent(deps, 'intent-1', 'user-1')).resolves.toMatchObject({ id: 'intent-1' })
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(null)
    await expect(getAgentEnrollmentIntent(deps, 'missing', 'user-1')).rejects.toMatchObject({ status: 404 })
  })

  it('creates an additional host intent only for an active controlled identity', async () => {
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
        recovery: true,
      }),
    )
    await expect(
      createAdditionalAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'enrollment-key-1'),
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
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate({ status: 'retired' }))
    await expect(
      createAdditionalAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'enrollment-key-2'),
    ).rejects.toMatchObject({ status: 400 })
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

  it('performs destructive recovery only inside the dedicated enrollment approval', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(
      intent({ agentIdentityId: 'identity-1', requestedName: null, recovery: true }),
    )
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(deps.agentIdentities.recoverIdentity).mockResolvedValue(true)
    vi.mocked(deps.agentIdentities.approveIntent).mockImplementation(async ({ binding }) => ({
      ...aggregate(),
      bindings: [{ ...binding, hostId: 'host-1' }],
    }))

    await expect(approveAgentEnrollment(deps, 'intent-1', 'https://auth.example.com', 'user-1')).resolves.toMatchObject(
      { identity: { id: 'identity-1' } },
    )
    expect(deps.agentIdentities.recoverIdentity).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.agentIdentities.recoverIdentity).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.agentIdentities.approveIntent).mock.invocationCallOrder[0]!,
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
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate({ status: 'retired' }))
    await expect(approveAgentEnrollment(deps, 'intent-1', 'https://auth.example.com', 'user-1')).rejects.toMatchObject({
      status: 400,
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(
      aggregate({ ownerUserId: null, ownerOrganizationId: 'org-1' }),
    )
    await expect(approveAgentEnrollment(deps, 'intent-1', 'https://auth.example.com', 'user-1')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('revokes hosts, recovers and retires identities with state-specific errors', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(deps.agentIdentities.revokeBinding).mockResolvedValue(true)
    vi.mocked(deps.agentIdentities.recoverIdentity).mockResolvedValue(true)
    vi.mocked(deps.agentIdentities.retireIdentity).mockResolvedValue(true)

    await expect(revokeAgentIdentityHost(deps, 'identity-1', 'protocol-agent-1', 'user-1')).resolves.toBeUndefined()
    await expect(recoverAgentIdentity(deps, 'identity-1', 'user-1')).resolves.toBeUndefined()
    await expect(retireAgentIdentity(deps, 'identity-1', 'user-1')).resolves.toBeUndefined()
    await expect(emergencyRetireAgentIdentity(deps, 'identity-1', 'admin-1')).resolves.toBeUndefined()

    vi.mocked(deps.agentIdentities.revokeBinding).mockResolvedValue(false)
    await expect(revokeAgentIdentityHost(deps, 'identity-1', 'protocol-agent-1', 'user-1')).rejects.toMatchObject({
      status: 404,
    })
    vi.mocked(deps.agentIdentities.recoverIdentity).mockResolvedValue(false)
    await expect(recoverAgentIdentity(deps, 'identity-1', 'user-1')).rejects.toMatchObject({ status: 400 })
    vi.mocked(deps.agentIdentities.retireIdentity).mockResolvedValue(false)
    await expect(retireAgentIdentity(deps, 'identity-1', 'user-1')).rejects.toMatchObject({ status: 400 })
    await expect(emergencyRetireAgentIdentity(deps, 'identity-1', 'admin-1')).rejects.toMatchObject({ status: 400 })

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate({ status: 'retired' }))
    await expect(revokeAgentIdentityHost(deps, 'identity-1', 'protocol-agent-1', 'user-1')).rejects.toMatchObject({
      status: 400,
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate({ ownerUserId: 'other-user' }))
    await expect(retireAgentIdentity(deps, 'identity-1', 'user-1')).rejects.toMatchObject({ status: 403 })

    const withoutMatchingBinding = aggregate()
    withoutMatchingBinding.bindings[0] = {
      ...withoutMatchingBinding.bindings[0]!,
      protocolAgentId: 'another-protocol-agent',
    }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(withoutMatchingBinding)
    vi.mocked(deps.agentIdentities.revokeBinding).mockResolvedValue(true)
    await expect(revokeAgentIdentityHost(deps, 'identity-1', 'protocol-agent-1', 'user-1')).resolves.toBeUndefined()
  })

  it('replaces one installation revocation idempotently [spec: agent-identity/restish-agent-installation-revocation]', async () => {
    const deps = createTestDeps()
    const active = aggregate()
    const revokedAt = new Date('2026-08-04T12:00:00.000Z')
    const revoked = aggregate()
    revoked.bindings[0] = { ...revoked.bindings[0]!, status: 'revoked', revokedAt }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValueOnce(active).mockResolvedValue(revoked)
    vi.mocked(deps.agentIdentities.revokeBinding).mockResolvedValue(true)

    const first = await replaceAgentIdentityInstallationRevocation(deps, 'identity-1', 'binding-1', null)
    expect(first).toMatchObject({ agentId: 'identity-1', installationId: 'binding-1', status: 'revoked' })
    expect(deps.agentIdentities.revokeBinding).toHaveBeenCalledTimes(1)

    await expect(replaceAgentIdentityInstallationRevocation(deps, 'identity-1', 'binding-1', null)).resolves.toEqual({
      agentId: 'identity-1',
      installationId: 'binding-1',
      status: 'revoked',
      revokedAt: revokedAt.toISOString(),
    })
    await expect(getAgentIdentityInstallationRevocation(deps, 'identity-1', 'binding-1')).resolves.toMatchObject({
      status: 'revoked',
    })
    expect(deps.agentIdentities.revokeBinding).toHaveBeenCalledTimes(1)
    expect(deps.externalResources.listActiveTokenLeasesByBinding).toHaveBeenCalledTimes(2)
  })

  it('starts recovery once and idempotently enrolls a replacement installation [spec: agent-identity/restish-agent-recovery]', async () => {
    const deps = enrollmentDeps()
    const recovering = aggregate({ status: 'recovering', updatedAt: new Date('2026-08-04T12:00:00.000Z') })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValueOnce(aggregate()).mockResolvedValue(recovering)
    vi.mocked(deps.agentIdentities.recoverIdentity).mockResolvedValue(true)

    await expect(replaceAgentIdentityRecovery(deps, 'identity-1', null)).resolves.toMatchObject({
      agentId: 'identity-1',
      status: 'recovering',
    })
    await expect(replaceAgentIdentityRecovery(deps, 'identity-1', null)).resolves.toEqual({
      agentId: 'identity-1',
      status: 'recovering',
      startedAt: '2026-08-04T12:00:00.000Z',
    })
    expect(deps.agentIdentities.recoverIdentity).toHaveBeenCalledTimes(1)
    expect(deps.externalResources.listActiveGrantsByAgent).toHaveBeenCalledTimes(2)
    await expect(getAgentIdentityRecovery(deps, 'identity-1')).resolves.toMatchObject({ status: 'recovering' })

    vi.mocked(deps.agentIdentities.createIntentIdempotently).mockImplementation(async (record) => ({
      intent: record,
      created: true,
    }))
    await expect(
      createRecoveryAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'recovery-key'),
    ).resolves.toMatchObject({ intent: { agentIdentityId: 'identity-1' } })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(deps.agentIdentities.findIntentByIdempotencyKey).mockResolvedValueOnce(null)
    await expect(
      createRecoveryAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'other-key'),
    ).resolves.toMatchObject({ intent: { agentIdentityId: 'identity-1' } })

    vi.mocked(deps.agentIdentities.findIdentity).mockClear()
    vi.mocked(deps.agentIdentities.recoverIdentity).mockClear()
    vi.mocked(deps.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(
      intent({
        agentIdentityId: 'identity-1',
        idempotencyKey: 'recovery-key',
        recovery: true,
        status: 'approved',
        approvedAt: new Date(),
      }),
    )
    await expect(
      createRecoveryAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'recovery-key'),
    ).resolves.toMatchObject({ replayed: true, intent: { status: 'approved' } })
    expect(deps.agentIdentities.findIdentity).not.toHaveBeenCalled()
    expect(deps.agentIdentities.recoverIdentity).not.toHaveBeenCalled()
  })

  it('re-authorizes a pending recovery replay before changing identity state', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(
      intent({
        agentIdentityId: 'identity-1',
        idempotencyKey: 'recovery-key',
        recovery: true,
        ownerUserId: null,
        ownerOrganizationId: 'org-1',
      }),
    )
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(
      aggregate({ ownerUserId: null, ownerOrganizationId: 'org-1' }),
    )
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(null)

    await expect(
      createRecoveryAgentEnrollmentIntent(deps, 'identity-1', 'protocol-agent-1', 'user-1', 'recovery-key'),
    ).rejects.toMatchObject({ status: 403 })
    expect(deps.agentIdentities.recoverIdentity).not.toHaveBeenCalled()
  })

  it('replaces retirement idempotently while keeping recovery distinct [spec: agent-identity/restish-agent-retirement]', async () => {
    const deps = createTestDeps()
    const retiredAt = new Date('2026-08-04T12:00:00.000Z')
    vi.mocked(deps.agentIdentities.findIdentity)
      .mockResolvedValueOnce(aggregate())
      .mockResolvedValue(aggregate({ status: 'retired', retiredAt }))
    vi.mocked(deps.agentIdentities.retireIdentity).mockResolvedValue(true)

    await expect(replaceAgentIdentityRetirement(deps, 'identity-1', null)).resolves.toMatchObject({
      agentId: 'identity-1',
      status: 'retired',
    })
    await expect(replaceAgentIdentityRetirement(deps, 'identity-1', null)).resolves.toEqual({
      agentId: 'identity-1',
      status: 'retired',
      retiredAt: retiredAt.toISOString(),
    })
    expect(deps.agentIdentities.retireIdentity).toHaveBeenCalledTimes(1)
    expect(deps.agentIdentities.recoverIdentity).not.toHaveBeenCalled()
    expect(deps.externalResources.listActiveGrantsByAgent).toHaveBeenCalledTimes(2)
  })

  it('surfaces lifecycle resource state and transition conflicts', async () => {
    const revocation = createTestDeps()
    vi.mocked(revocation.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    await expect(getAgentIdentityInstallationRevocation(revocation, 'identity-1', 'binding-1')).rejects.toMatchObject({
      status: 404,
    })
    await expect(getAgentIdentityInstallationRevocation(revocation, 'identity-1', 'missing')).rejects.toMatchObject({
      status: 404,
    })
    await expect(getAgentIdentityRecovery(revocation, 'identity-1')).rejects.toMatchObject({ status: 404 })

    const retiredRevocation = createTestDeps()
    vi.mocked(retiredRevocation.agentIdentities.findIdentity).mockResolvedValue(aggregate({ status: 'retired' }))
    await expect(
      replaceAgentIdentityInstallationRevocation(retiredRevocation, 'identity-1', 'binding-1', null),
    ).rejects.toMatchObject({ status: 400 })

    const missingInstallation = createTestDeps()
    vi.mocked(missingInstallation.agentIdentities.findIdentity).mockResolvedValue({ ...aggregate(), bindings: [] })
    await expect(
      replaceAgentIdentityInstallationRevocation(missingInstallation, 'identity-1', 'missing', null),
    ).rejects.toMatchObject({ status: 404 })

    const changedInstallation = createTestDeps()
    vi.mocked(changedInstallation.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(changedInstallation.agentIdentities.revokeBinding).mockResolvedValue(false)
    await expect(
      replaceAgentIdentityInstallationRevocation(changedInstallation, 'identity-1', 'binding-1', null),
    ).rejects.toMatchObject({ status: 409 })

    const retiredRecovery = createTestDeps()
    vi.mocked(retiredRecovery.agentIdentities.findIdentity).mockResolvedValue(aggregate({ status: 'retired' }))
    await expect(replaceAgentIdentityRecovery(retiredRecovery, 'identity-1', null)).rejects.toMatchObject({
      status: 400,
    })

    const changedRecovery = createTestDeps()
    vi.mocked(changedRecovery.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(changedRecovery.agentIdentities.recoverIdentity).mockResolvedValue(false)
    await expect(replaceAgentIdentityRecovery(changedRecovery, 'identity-1', null)).rejects.toMatchObject({
      status: 409,
    })

    const changedRetirement = createTestDeps()
    vi.mocked(changedRetirement.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(changedRetirement.agentIdentities.retireIdentity).mockResolvedValue(false)
    await expect(replaceAgentIdentityRetirement(changedRetirement, 'identity-1', null)).rejects.toMatchObject({
      status: 409,
    })

    const emergencyRetirement = createTestDeps()
    vi.mocked(emergencyRetirement.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    vi.mocked(emergencyRetirement.agentIdentities.retireIdentity).mockResolvedValue(true)
    await expect(replaceAgentIdentityRetirement(emergencyRetirement, 'identity-1', null, true)).resolves.toMatchObject({
      status: 'retired',
    })
    expect(emergencyRetirement.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { emergency: true } }),
    )
  })

  it('rejects enrollment projections that cannot resolve a display name', async () => {
    expect(
      toAgentEnrollment(
        {
          id: 'recovery-intent',
          agentIdentityId: 'identity-1',
          protocolAgentId: 'protocol-agent-1',
          requestedName: null,
          recovery: true,
          homeSpace: { type: 'personal', userId: 'user-1' },
          status: 'pending',
          expiresAt: new Date(),
          approvedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        'Build Agent',
      ).kind,
    ).toBe('recovery')
    expect(() =>
      toAgentEnrollment({
        id: 'intent-without-name',
        agentIdentityId: null,
        protocolAgentId: 'protocol-agent-1',
        requestedName: null,
        recovery: false,
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
      countEffectiveAgentRoles: vi
        .fn()
        .mockImplementation((agents: Array<{ agentIdentityId: string }>) =>
          Promise.resolve(new Map(agents.map((agent) => [agent.agentIdentityId, 0]))),
        ),
    },
    externalResources: {
      summarizeAgentAccess: vi
        .fn()
        .mockImplementation((agentIds: string[]) =>
          Promise.resolve(
            new Map(agentIds.map((agentId) => [agentId, { pendingRequestCount: 0, activeGrantCount: 0 }])),
          ),
        ),
    },
  })
}

function managementDeps() {
  const deps = createTestDeps()
  vi.mocked(deps.authorization.countEffectiveAgentRoles).mockImplementation((agents) =>
    Promise.resolve(new Map(agents.map((agent) => [agent.agentIdentityId, 0]))),
  )
  vi.mocked(deps.externalResources.summarizeAgentAccess).mockImplementation((agentIds) =>
    Promise.resolve(new Map(agentIds.map((agentId) => [agentId, { pendingRequestCount: 0, activeGrantCount: 0 }]))),
  )
  return deps
}

function member(role: string) {
  return {
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    role,
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
    retiredAt: null,
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
    recovery: false,
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
