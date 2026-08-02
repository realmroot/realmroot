import { createTestDeps } from '@server/http/test-deps'
import {
  approveAgentEnrollment,
  createAdditionalAgentEnrollmentIntent,
  createAgentEnrollmentIntent,
  createAgentLoginIdentity,
  emergencyRetireAgentIdentity,
  getAgent,
  getAgentEnrollmentIntent,
  getAgentIdentityByProtocolAgent,
  getAgentInfo,
  getPersonalAgent,
  getProtocolAgentEnrollment,
  getPublicAgentEnrollment,
  listAllAgentIdentities,
  listAllAgents,
  listOrganizationAgentIdentities,
  listPersonalAgentIdentities,
  listPersonalAgents,
  recoverAgentIdentity,
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
