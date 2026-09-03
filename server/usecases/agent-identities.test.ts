import { createTestDeps } from '@server/http/test-deps'
import {
  activateAgentIdentity,
  approveAgentEnrollment,
  createAdditionalAgentEnrollmentIntent,
  createAgentEnrollmentIntent,
  createAgentLoginIdentity,
  createAgentWithInstallation,
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
  listManagementAgentAuthorizedResourceServers,
  listManagementAgentInstallations,
  listManagementAgentPermissions,
  listPersonalAgentIdentities,
  listPersonalAgents,
  recoverAgentIdentity,
  requireActiveAgentIdentity,
  revokeAgentIdentityHost,
  toAgent,
  toAgentEnrollment,
} from '@server/usecases/agent-identities'
import type {
  AgentAuditEventRecord,
  AgentEnrollmentIntentRecord,
  AgentHostRecord,
  AgentIdentityAggregate,
  AgentIdentityRecord,
  AgentRecord,
} from '@server/usecases/ports'
import type { CreateAgent } from '@shared/api/agent-api'
import { exportJWK, generateKeyPair } from 'jose'
import { describe, expect, it, vi } from 'vitest'

describe('Agent login identity', () => {
  it('projects an already-normalized Agent identity', () => {
    expect(
      toAgent({
        id: 'identity-1',
        issuer: 'https://agent.example.com',
        subject: 'agent-1',
        username: 'agent.0000000000000000000000000000000c',
        name: 'Agent',
        runtime: 'codex',
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

    const identity = await createAgentLoginIdentity(deps, loginInput(), 'https://auth.example.com', 'user-1')

    expect(identity).toMatchObject({
      issuer: 'https://auth.example.com',
      username: 'build-agent',
      name: 'Build Agent',
      runtime: 'codex',
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
        username: 'build-agent',
        name: 'Build Agent',
        ownerUserId: 'user-1',
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

    const identity = await createAgentLoginIdentity(deps, loginInput(), 'https://auth.example.com', 'user-1')

    expect(identity.subject).toBe('agt_stable')
    expect(deps.agentIdentities.createIdentity).not.toHaveBeenCalled()
  })

  it('claims an explicit profile once for a legacy identity', async () => {
    const deps = createTestDeps()
    const legacy = aggregate({ username: null, runtime: null })
    const claimed = aggregate({ username: 'mira.chen', name: 'Mira Chen', runtime: 'codex' })
    vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(legacy)
    vi.mocked(deps.agentIdentities.claimIdentityProfile).mockResolvedValue(claimed)

    await expect(
      createAgentLoginIdentity(
        deps,
        { protocolAgentId: 'protocol-agent-1', username: 'mira.chen', nickname: 'Mira Chen', runtime: 'codex' },
        'https://auth.example.com',
        'user-1',
      ),
    ).resolves.toMatchObject({ username: 'mira.chen', name: 'Mira Chen', runtime: 'codex' })
    expect(deps.agentIdentities.claimIdentityProfile).toHaveBeenCalledWith(
      'identity-1',
      expect.objectContaining({ username: 'mira.chen', name: 'Mira Chen', runtime: 'codex' }),
    )
  })

  it('rejects unavailable, changed, and concurrently claimed usernames', async () => {
    const duplicate = enrollmentDeps()
    vi.mocked(duplicate.agentIdentities.findByUsername).mockResolvedValue(identity())
    await expect(
      createAgentLoginIdentity(duplicate, loginInput(), 'https://auth.example.com', 'user-1'),
    ).rejects.toMatchObject({ status: 409 })

    const immutable = createTestDeps()
    vi.mocked(immutable.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(aggregate())
    await expect(
      createAgentLoginIdentity(
        immutable,
        { ...loginInput(), username: 'mira.chen' },
        'https://auth.example.com',
        'user-1',
      ),
    ).rejects.toMatchObject({ status: 409 })

    const raced = createTestDeps()
    vi.mocked(raced.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(
      aggregate({ username: null, runtime: null }),
    )
    vi.mocked(raced.agentIdentities.claimIdentityProfile).mockResolvedValue(null)
    await expect(
      createAgentLoginIdentity(raced, loginInput(), 'https://auth.example.com', 'user-1'),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('Application-created Agent installation', () => {
  it('passes the idempotency reservation and five UUIDv7 records to the atomic repository', async () => {
    const fixture = await applicationAgentFixture()

    expect(fixture.deps.agentIdentities.createAgentWithInstallation).toHaveBeenCalledWith({
      host: expect.objectContaining({ id: 'ama-host-1', status: 'active', userId: 'user-1' }),
      protocolAgent: expect.objectContaining({ id: 'ama-agent-1', hostId: 'ama-host-1', status: 'active' }),
      identity: expect.objectContaining({ ownerUserId: 'user-1', status: 'active' }),
      binding: expect.objectContaining({ protocolAgentId: 'ama-agent-1', status: 'active' }),
      audit: expect.objectContaining({
        action: 'agent.identity_enrolled',
        result: 'allowed',
        controllerUserId: 'user-1',
        hostId: 'ama-host-1',
      }),
      reservation: expect.objectContaining({
        applicationId: 'ama-application',
        actorUserId: 'user-1',
        idempotencyKey: 'ama-create-1',
        requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    })
    const records = vi.mocked(fixture.deps.agentIdentities.createAgentWithInstallation).mock.calls[0]?.[0]
    expect([
      records?.identity.id,
      records?.identity.subject,
      records?.binding.id,
      records?.audit.id,
      records?.reservation.id,
    ]).toEqual([
      '00000000-0000-7000-8000-000000000000',
      '00000000-0000-7000-8000-000000000001',
      '00000000-0000-7000-8000-000000000002',
      '00000000-0000-7000-8000-000000000003',
      '00000000-0000-7000-8000-000000000004',
    ])
    const reservation = vi.mocked(fixture.deps.agentIdentities.createAgentWithInstallation).mock.calls[0]?.[0]
      .reservation
    if (!reservation) throw new Error('The Agent creation reservation was not passed to the repository.')
    vi.mocked(fixture.deps.agentIdentities.findApplicationCreation).mockResolvedValue({
      reservation,
      identity: fixture.persisted,
    })

    await expect(createAgentWithInstallation(fixture.deps, fixture.input, fixture.context)).resolves.toMatchObject({
      replayed: true,
      agent: { id: fixture.persisted.identity.id },
    })
    expect(fixture.deps.agentIdentities.createAgentWithInstallation).toHaveBeenCalledTimes(1)
  })

  it('reports a concurrent identical repository commit as an idempotent replay', async () => {
    const fixture = await applicationAgentFixture(false)
    expect(fixture.result.replayed).toBe(true)
  })

  it('migrates a matching pre-reservation Agent creation into the durable idempotency map', async () => {
    const { publicKey } = await generateKeyPair('Ed25519')
    const input = applicationAgentInput(await exportedAgentPublicJwk(publicKey, 'ama-key-1'))
    const context = applicationAgentContext()
    const fixture = await legacyApplicationAgentFixture(input, context)
    const deps = createTestDeps()
    deps.ids.generate = vi.fn(deps.ids.generate)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(fixture.identity)
    vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue(fixture.protocolAgent)
    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValue([fixture.host])
    vi.mocked(deps.agentAudit.findById).mockResolvedValue(fixture.audit)
    vi.mocked(deps.agentIdentities.reserveApplicationCreation).mockImplementation(async (reservation) => ({
      reservation,
      identity: fixture.identity,
      created: true,
    }))

    await expect(createAgentWithInstallation(deps, input, context)).resolves.toEqual({
      agent: toAgent(fixture.identity),
      replayed: true,
    })
    expect(deps.agentIdentities.reserveApplicationCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '00000000-0000-7000-8000-000000000000',
        applicationId: context.applicationId,
        actorUserId: context.actorUserId,
        idempotencyKey: context.idempotencyKey,
        requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        agentIdentityId: fixture.identity.identity.id,
      }),
    )
    expect(deps.agentIdentities.createAgentWithInstallation).not.toHaveBeenCalled()
    expect(deps.ids.generate).toHaveBeenCalledTimes(1)
  })

  it('propagates an unknown failure while reserving a matching legacy Agent', async () => {
    const { publicKey } = await generateKeyPair('Ed25519')
    const input = applicationAgentInput(await exportedAgentPublicJwk(publicKey, 'ama-key-1'))
    const context = applicationAgentContext()
    const fixture = await legacyApplicationAgentFixture(input, context)
    const deps = createTestDeps()
    const storageFailure = new Error('D1 unavailable')
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(fixture.identity)
    vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue(fixture.protocolAgent)
    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValue([fixture.host])
    vi.mocked(deps.agentAudit.findById).mockResolvedValue(fixture.audit)
    vi.mocked(deps.agentIdentities.reserveApplicationCreation).mockRejectedValue(storageFailure)

    await expect(createAgentWithInstallation(deps, input, context)).rejects.toBe(storageFailure)
  })

  it.each([
    [
      'identity subject',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.identity.identity.subject = 'agt_changed'
      },
    ],
    [
      'identity issuer',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.identity.identity.issuer = 'https://changed.example.com/api/auth'
      },
    ],
    [
      'identity username',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.identity.identity.username = 'changed-agent'
      },
    ],
    [
      'identity name',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.identity.identity.name = 'Changed Agent'
      },
    ],
    [
      'identity runtime',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.identity.identity.runtime = 'changed'
      },
    ],
    [
      'identity owner',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.identity.identity.ownerUserId = 'other-user'
      },
    ],
    [
      'identity status',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.identity.identity.status = 'inactive'
      },
    ],
    [
      'binding',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.identity.bindings[0] = { ...fixture.identity.bindings[0]!, status: 'revoked' }
      },
    ],
    [
      'protocol Agent',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.protocolAgent = { ...fixture.protocolAgent, mode: 'changed' }
      },
    ],
    [
      'Host',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.host = { ...fixture.host, name: 'Changed Host' }
      },
    ],
    [
      'protocol Agent kid',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.protocolAgent = { ...fixture.protocolAgent, kid: 'changed-key' }
      },
    ],
    [
      'protocol Agent public key',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.protocolAgent = { ...fixture.protocolAgent, publicKey: '{}' }
      },
    ],
    [
      'Host kid',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.host = { ...fixture.host, kid: 'changed-key' }
      },
    ],
    [
      'Host public key',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.host = { ...fixture.host, publicKey: '{}' }
      },
    ],
    [
      'audit',
      (fixture: Awaited<ReturnType<typeof legacyApplicationAgentFixture>>) => {
        fixture.audit = { ...fixture.audit, action: 'changed' }
      },
    ],
  ])('rejects a pre-reservation legacy lookup with a different %s representation', async (_field, mutate) => {
    const { publicKey } = await generateKeyPair('Ed25519')
    const input = applicationAgentInput(await exportedAgentPublicJwk(publicKey, 'ama-key-1'))
    const context = applicationAgentContext()
    const fixture = await legacyApplicationAgentFixture(input, context)
    mutate(fixture)
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(fixture.identity)
    vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue(fixture.protocolAgent)
    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValue([fixture.host])
    vi.mocked(deps.agentAudit.findById).mockResolvedValue(fixture.audit)

    await expect(createAgentWithInstallation(deps, input, context)).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
    })
    expect(deps.agentIdentities.reserveApplicationCreation).not.toHaveBeenCalled()
    expect(deps.agentIdentities.createAgentWithInstallation).not.toHaveBeenCalled()
  })

  it('recovers a pre-reservation Agent committed by an older concurrent deployment', async () => {
    const { publicKey } = await generateKeyPair('Ed25519')
    const input = applicationAgentInput(await exportedAgentPublicJwk(publicKey, 'ama-key-1'))
    const context = applicationAgentContext()
    const fixture = await legacyApplicationAgentFixture(input, context)
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValueOnce(null).mockResolvedValue(fixture.identity)
    vi.mocked(deps.agentIdentities.findProtocolAgent)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(fixture.protocolAgent)
    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValueOnce([]).mockResolvedValue([fixture.host])
    vi.mocked(deps.agentAudit.findById).mockResolvedValue(fixture.audit)
    vi.mocked(deps.agentIdentities.createAgentWithInstallation).mockRejectedValue(new Error('unique constraint'))
    vi.mocked(deps.agentIdentities.reserveApplicationCreation).mockImplementation(async (reservation) => ({
      reservation,
      identity: fixture.identity,
      created: true,
    }))

    await expect(createAgentWithInstallation(deps, input, context)).resolves.toMatchObject({
      agent: { id: fixture.identity.identity.id },
      replayed: true,
    })
  })

  it('rejects a different representation committed by an older concurrent deployment', async () => {
    const { publicKey } = await generateKeyPair('Ed25519')
    const input = applicationAgentInput(await exportedAgentPublicJwk(publicKey, 'ama-key-1'))
    const context = applicationAgentContext()
    const fixture = await legacyApplicationAgentFixture(input, context)
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValueOnce(null).mockResolvedValue(fixture.identity)
    vi.mocked(deps.agentIdentities.findProtocolAgent)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(fixture.protocolAgent)
    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValueOnce([]).mockResolvedValue([fixture.host])
    vi.mocked(deps.agentAudit.findById).mockResolvedValue({ ...fixture.audit, action: 'changed' })
    vi.mocked(deps.agentIdentities.createAgentWithInstallation).mockRejectedValue(new Error('unique constraint'))

    await expect(createAgentWithInstallation(deps, input, context)).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
    })
  })

  it('preserves the original create failure when concurrent legacy recovery cannot be confirmed', async () => {
    const { publicKey } = await generateKeyPair('Ed25519')
    const input = applicationAgentInput(await exportedAgentPublicJwk(publicKey, 'ama-key-1'))
    const context = applicationAgentContext()
    const fixture = await legacyApplicationAgentFixture(input, context)
    const deps = createTestDeps()
    const storageFailure = new Error('D1 write unavailable')
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValueOnce(null).mockResolvedValue(fixture.identity)
    vi.mocked(deps.agentIdentities.findProtocolAgent)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(fixture.protocolAgent)
    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValueOnce([]).mockResolvedValue([fixture.host])
    vi.mocked(deps.agentAudit.findById).mockRejectedValue(new Error('D1 read unavailable'))
    vi.mocked(deps.agentIdentities.createAgentWithInstallation).mockRejectedValue(storageFailure)

    await expect(createAgentWithInstallation(deps, input, context)).rejects.toBe(storageFailure)
  })

  it('rejects replay after the reserved Agent identity was deleted', async () => {
    const fixture = await applicationAgentFixture()
    const reservation = vi.mocked(fixture.deps.agentIdentities.createAgentWithInstallation).mock.calls[0]?.[0]
      .reservation
    if (!reservation) throw new Error('The Agent creation reservation was not passed to the repository.')
    vi.mocked(fixture.deps.agentIdentities.findApplicationCreation).mockResolvedValue({
      reservation,
      identity: {
        ...fixture.persisted,
        identity: { ...fixture.persisted.identity, deletedAt: new Date() },
      },
    })

    await expect(createAgentWithInstallation(fixture.deps, fixture.input, fixture.context)).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
    })
  })

  it('rejects invalid installation keys, occupied installation identifiers, and duplicate usernames', async () => {
    const { publicKey } = await generateKeyPair('Ed25519')
    const publicJwk = await exportedAgentPublicJwk(publicKey, 'different-kid')
    const deps = createTestDeps()
    const input = applicationAgentInput(publicJwk)
    await expect(createAgentWithInstallation(deps, input, applicationAgentContext())).rejects.toMatchObject({
      status: 400,
    })

    const occupied = createTestDeps()
    vi.mocked(occupied.agentIdentities.findProtocolAgent).mockResolvedValue({ id: 'ama-agent-1' } as AgentRecord)
    await expect(
      createAgentWithInstallation(
        occupied,
        { ...input, installation: { ...input.installation, kid: 'different-kid' } },
        applicationAgentContext(),
      ),
    ).rejects.toMatchObject({ status: 409 })

    const duplicate = createTestDeps()
    vi.mocked(duplicate.agentIdentities.findByUsername).mockResolvedValue(identity())
    await expect(
      createAgentWithInstallation(
        duplicate,
        { ...input, installation: { ...input.installation, kid: 'different-kid' } },
        applicationAgentContext(),
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('rejects a malformed public JWK and a mismatched idempotent representation', async () => {
    const malformed = createTestDeps()
    await expect(
      createAgentWithInstallation(
        malformed,
        applicationAgentInput({
          kty: 'OKP',
          crv: 'Ed25519',
          x: 'AA',
          kid: 'ama-key-1',
          alg: 'EdDSA',
          use: 'sig',
          key_ops: ['verify'],
        } satisfies CreateAgent['installation']['publicKey']),
        applicationAgentContext(),
      ),
    ).rejects.toMatchObject({ status: 400 })

    const fixture = await applicationAgentFixture()
    const reservation = vi.mocked(fixture.deps.agentIdentities.createAgentWithInstallation).mock.calls[0]?.[0]
      .reservation
    if (!reservation) throw new Error('The Agent creation reservation was not passed to the repository.')
    vi.mocked(fixture.deps.agentIdentities.findApplicationCreation).mockResolvedValue({
      reservation,
      identity: fixture.persisted,
    })
    await expect(
      createAgentWithInstallation(fixture.deps, { ...fixture.input, name: 'Different Agent' }, fixture.context),
    ).rejects.toMatchObject({ status: 409 })
  })

  it.each([
    ['applicationId', 'different-application'],
    ['actorUserId', 'different-user'],
    ['issuer', 'https://different.example.com/api/auth'],
  ] as const)('includes %s in the idempotency request fingerprint', async (boundary, value) => {
    const fixture = await applicationAgentFixture()
    const reservation = vi.mocked(fixture.deps.agentIdentities.createAgentWithInstallation).mock.calls[0]?.[0]
      .reservation
    if (!reservation) throw new Error('The Agent creation reservation was not passed to the repository.')
    vi.mocked(fixture.deps.agentIdentities.findApplicationCreation).mockResolvedValue({
      reservation,
      identity: fixture.persisted,
    })

    await expect(
      createAgentWithInstallation(fixture.deps, fixture.input, { ...fixture.context, [boundary]: value }),
    ).rejects.toMatchObject({ status: 409, code: 'conflict' })
  })

  it('propagates an unknown atomic create failure when all race rechecks remain available', async () => {
    const { publicKey } = await generateKeyPair('Ed25519')
    const input = applicationAgentInput(await exportedAgentPublicJwk(publicKey, 'ama-key-1'))
    const deps = createTestDeps()
    const storageFailure = new Error('D1 unavailable')
    vi.mocked(deps.agentIdentities.createAgentWithInstallation).mockRejectedValue(storageFailure)

    await expect(createAgentWithInstallation(deps, input, applicationAgentContext())).rejects.toBe(storageFailure)
  })

  it('preserves an ambiguous storage failure even when the installation appears committed afterward', async () => {
    const { publicKey } = await generateKeyPair('Ed25519')
    const input = applicationAgentInput(await exportedAgentPublicJwk(publicKey, 'ama-key-1'))
    const deps = createTestDeps()
    const storageFailure = new Error('D1 write result is unknown')
    vi.mocked(deps.agentIdentities.findProtocolAgent)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: input.installation.agentId } as AgentRecord)
    vi.mocked(deps.agents.listHostsForAgents)
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: input.installation.hostId }] as never)
    vi.mocked(deps.agentIdentities.createAgentWithInstallation).mockRejectedValue(storageFailure)

    await expect(createAgentWithInstallation(deps, input, applicationAgentContext())).rejects.toBe(storageFailure)
    expect(deps.agentIdentities.findProtocolAgent).toHaveBeenCalledTimes(1)
    expect(deps.agents.listHostsForAgents).toHaveBeenCalledTimes(1)
  })
})

describe('Agent identity lifecycle', () => {
  it('lists Resource Servers authorized for a managed Agent', async () => {
    const deps = identityDeps()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate())
    Object.assign(deps.authorization, {
      listAuthorizedResourceServers: vi.fn().mockResolvedValue({
        items: [],
        pagination: { page: Math.floor(0 / 20) + 1, pageSize: 20, totalItems: 0, totalPages: Math.ceil(0 / 20) },
      }),
    })

    await expect(
      listManagementAgentAuthorizedResourceServers(deps, 'identity-1', { page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({ pagination: { totalItems: 0 } })
    expect(deps.authorization.listAuthorizedResourceServers).toHaveBeenCalledWith(
      { type: 'agent', id: 'identity-1' },
      { limit: 20, offset: 0 },
      expect.any(Date),
    )
  })

  it('lists personal and inventory identities', async () => {
    const deps = identityDeps()
    const personal = aggregate()
    vi.mocked(deps.agentIdentities.listPersonal).mockResolvedValue([personal])
    vi.mocked(deps.agentIdentities.listAll).mockResolvedValue({
      items: [personal],
      total: 1,
      limit: 20,
      offset: 5,
    })
    await expect(listPersonalAgentIdentities(deps, 'user-1')).resolves.toMatchObject({
      items: [{ homeSpace: { type: 'personal', userId: 'user-1' } }],
    })
    await expect(listAllAgentIdentities(deps, { limit: 20, offset: 5 })).resolves.toMatchObject({
      total: 1,
      limit: 20,
      offset: 5,
    })
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
      pagination: { totalItems: 1 },
    })
    await expect(listAllAgents(deps, { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'identity-1' }],
      pagination: { totalItems: 1 },
    })
    await expect(getPersonalAgent(deps, 'identity-1', 'user-1')).resolves.toMatchObject({ id: 'identity-1' })
    await expect(getAgent(deps, 'identity-1')).resolves.toMatchObject({ id: 'identity-1' })
    await expect(getPublicAgentEnrollment(deps, 'intent-1', 'user-1')).resolves.toMatchObject({
      id: 'intent-1',
      agentId: null,
      nickname: 'Build Agent',
      username: 'build-agent',
      runtime: 'codex',
      kind: 'new_identity',
      status: 'pending',
      decidedAt: null,
    })

    const approved = toAgentEnrollment(
      {
        id: 'intent-2',
        agentIdentityId: 'identity-1',
        protocolAgentId: 'protocol-agent-1',
        requestedNickname: null,
        requestedUsername: null,
        requestedRuntime: null,
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'approved',
        expiresAt: '2026-08-01T01:00:00.000Z',
        approvedAt: '2026-08-01T00:30:00.000Z',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:30:00.000Z',
      },
      { nickname: 'Build Agent', username: 'build-agent', runtime: 'codex' },
    )
    expect(approved).toMatchObject({
      agentId: 'identity-1',
      nickname: 'Build Agent',
      kind: 'additional_host',
      status: 'approved',
      decidedAt: '2026-08-01T00:30:00.000Z',
    })

    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(
      intent({ agentIdentityId: 'identity-1', requestedName: null }),
    )
    await expect(getProtocolAgentEnrollment(deps, 'intent-1', 'protocol-agent-1')).resolves.toMatchObject({
      id: 'intent-1',
      nickname: 'Build Agent',
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
      pagination: { page: Math.floor(0 / 20) + 1, pageSize: 20, totalItems: 1, totalPages: Math.ceil(1 / 20) },
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
      listManagementAgentPermissions(deps, { agentId: 'agent-1', page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({
      items: [{ id: 'grant-active', status: 'active', expiresAt: null }],
      pagination: { totalItems: 1 },
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
      pagination: { page: Math.floor(0 / 1) + 1, pageSize: 1, totalItems: 2, totalPages: Math.ceil(2 / 1) },
    })

    await expect(listManagementAgentInstallations(deps, 'identity-1', { limit: 1, offset: 1 })).resolves.toEqual({
      items: [expect.objectContaining({ id: 'binding-1', name: 'host-1', credentialType: 'remote_jwks' })],
      pagination: { page: Math.floor(1 / 1) + 1, pageSize: 1, totalItems: 2, totalPages: Math.ceil(2 / 1) },
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

  it('maps User-owned management Agents and validates summary invariants', async () => {
    const deps = managementDeps()
    vi.mocked(deps.agentIdentities.listOwned).mockResolvedValue({
      items: [aggregate()],
      total: 1,
      limit: 20,
      offset: 0,
    })
    await expect(listAllAgents(deps, { limit: 20, offset: 0 }, { ownerUserId: 'user-1' })).resolves.toMatchObject({
      items: [{ owner: { id: 'user-1', type: 'user' } }],
    })

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

  it('batches access summaries within the production D1 parameter limit', async () => {
    const deps = managementDeps()
    const items = Array.from({ length: 100 }, (_, index) => aggregate({ id: `identity-${index}` }))
    vi.mocked(deps.agentIdentities.listAll).mockResolvedValue({ items, total: items.length, limit: 100, offset: 0 })

    const result = await listAllAgents(deps, { limit: 100, offset: 0 })
    expect(result.items.map((item) => item.id)).toEqual(items.map((item) => item.identity.id))
    expect(vi.mocked(deps.externalResources.summarizeAgentAccess).mock.calls.map(([ids]) => ids.length)).toEqual([
      50, 50,
    ])
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
      requestedNickname: 'Build Agent',
      requestedUsername: 'build-agent',
      requestedRuntime: 'codex',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'pending',
    })

    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(intent())
    await expect(getAgentEnrollmentIntent(deps, 'intent-1', 'user-1')).resolves.toMatchObject({ id: 'intent-1' })
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(null)
    await expect(getAgentEnrollmentIntent(deps, 'missing', 'user-1')).rejects.toMatchObject({ status: 404 })
  })

  it('rejects incompatible enrollment replays and missing legacy bindings', async () => {
    const missingBinding = enrollmentDeps()
    vi.mocked(missingBinding.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(
      intent({ requestedUsername: null, requestedRuntime: null }),
    )
    await expect(
      createAgentEnrollmentIntent(missingBinding, loginInput(), 'user-1', 'legacy-key'),
    ).rejects.toMatchObject({ status: 409 })

    const wrongActor = enrollmentDeps()
    vi.mocked(wrongActor.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(
      intent({ createdByUserId: 'another-user' }),
    )
    await expect(createAgentEnrollmentIntent(wrongActor, loginInput(), 'user-1', 'reused-key')).rejects.toMatchObject({
      status: 403,
    })

    const changedProfile = enrollmentDeps()
    vi.mocked(changedProfile.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(
      intent({ requestedName: 'Another Name' }),
    )
    await expect(
      createAgentEnrollmentIntent(changedProfile, loginInput(), 'user-1', 'reused-key'),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('replays a legacy enrollment after claiming its explicit identity profile', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findIntentByIdempotencyKey).mockResolvedValue(
      intent({ requestedName: null, requestedUsername: null, requestedRuntime: null }),
    )
    vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(
      aggregate({ username: null, runtime: null }),
    )
    vi.mocked(deps.agentIdentities.claimIdentityProfile).mockResolvedValue(aggregate())

    await expect(createAgentEnrollmentIntent(deps, loginInput(), 'user-1', 'legacy-key')).resolves.toMatchObject({
      replayed: true,
      intent: {
        requestedUsername: 'build-agent',
        requestedNickname: 'Build Agent',
        requestedRuntime: 'codex',
      },
    })
  })

  it('uses the detected runtime as the nickname when enrollment omits one', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.createIntentIdempotently).mockImplementation(async (record) => ({
      intent: record,
      created: true,
    }))

    const result = await createAgentEnrollmentIntent(
      deps,
      { ...loginInput(), nickname: undefined, runtime: 'codex' },
      'user-1',
      'runtime-nickname-key',
    )

    expect(result.intent).toMatchObject({
      requestedNickname: 'codex',
      requestedUsername: 'build-agent',
      requestedRuntime: 'codex',
    })
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
      intent: {
        requestedNickname: 'Build Agent',
        requestedUsername: 'build-agent',
        requestedRuntime: 'codex',
        status: 'approved',
        homeSpace: { type: 'personal', userId: 'user-1' },
      },
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
      intent: { agentIdentityId: 'identity-1', requestedNickname: null },
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
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(aggregate({ ownerUserId: 'user-2' }))
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

  it('rejects enrollment projections without a requested or existing identity', async () => {
    const deps = enrollmentDeps()
    vi.mocked(deps.agentIdentities.findIntent).mockResolvedValue(intent({ requestedName: null, agentIdentityId: null }))
    await expect(getPublicAgentEnrollment(deps, 'intent-1', 'user-1')).rejects.toThrow(
      'has no requested or existing identity',
    )
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

async function applicationAgentFixture(created = true) {
  const deps = createTestDeps()
  const { publicKey } = await generateKeyPair('Ed25519')
  const input = applicationAgentInput(await exportedAgentPublicJwk(publicKey, 'ama-key-1'))
  const context = applicationAgentContext()
  let persisted: AgentIdentityAggregate | undefined
  vi.mocked(deps.agentIdentities.createAgentWithInstallation).mockImplementation(async (records) => {
    persisted = {
      identity: records.identity,
      bindings: [{ ...records.binding, hostId: records.host.id }],
    }
    vi.mocked(deps.agentIdentities.findProtocolAgent).mockResolvedValue(records.protocolAgent)
    vi.mocked(deps.agents.listHostsForAgents).mockResolvedValue([records.host])
    return { identity: persisted, reservation: records.reservation, created }
  })
  const result = await createAgentWithInstallation(deps, input, context)
  if (!persisted) throw new Error('The Agent installation repository was not called.')
  return { deps, input, context, persisted, result }
}

async function legacyApplicationAgentFixture(input: CreateAgent, context: ReturnType<typeof applicationAgentContext>) {
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${context.applicationId}\u0000${context.actorUserId}\u0000${context.idempotencyKey}`),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
  const now = new Date('2026-08-01T00:00:00.000Z')
  const publicKey = JSON.stringify(
    Object.fromEntries(
      Object.entries(input.installation.publicKey).sort(([left], [right]) => left.localeCompare(right)),
    ),
  )
  const identity: AgentIdentityAggregate = {
    identity: {
      id: `agi_${hash}`,
      issuer: context.issuer,
      subject: `agt_${hash}`,
      username: input.username,
      name: input.name,
      runtime: input.runtime,
      ownerUserId: context.actorUserId,
      status: 'active',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    bindings: [
      {
        id: `agb_${hash}`,
        agentIdentityId: `agi_${hash}`,
        protocolAgentId: input.installation.agentId,
        hostId: input.installation.hostId,
        status: 'active',
        boundAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
  const protocolAgent: AgentRecord = {
    id: input.installation.agentId,
    name: input.name,
    userId: context.actorUserId,
    hostId: input.installation.hostId,
    status: 'active',
    mode: 'delegated',
    publicKey,
    kid: input.installation.kid,
    jwksUrl: null,
    lastUsedAt: null,
    activatedAt: now,
    expiresAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  }
  const host: AgentHostRecord = {
    id: input.installation.hostId,
    name: input.installation.name,
    userId: context.actorUserId,
    defaultCapabilities: JSON.stringify([]),
    publicKey,
    kid: input.installation.kid,
    jwksUrl: null,
    enrollmentTokenHash: null,
    enrollmentTokenExpiresAt: null,
    status: 'active',
    activatedAt: now,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const audit: AgentAuditEventRecord = {
    id: `aga_${hash}`,
    action: 'agent.identity_enrolled',
    result: 'allowed',
    realmOwned: false,
    ownerUserId: context.actorUserId,
    ownerOrganizationId: null,
    controllerUserId: context.actorUserId,
    subjectIssuer: context.issuer,
    subject: `agt_${hash}`,
    agentIdentityId: `agi_${hash}`,
    hostId: input.installation.hostId,
    resourceId: null,
    resourceConnectionId: null,
    accessRequestId: null,
    scopes: null,
    reasonCode: null,
    metadata: { source: 'application', applicationId: context.applicationId },
    occurredAt: now,
  }
  return { identity, protocolAgent, host, audit }
}

function applicationAgentInput(publicKey: CreateAgent['installation']['publicKey']): CreateAgent {
  return {
    username: 'ama-worker',
    name: 'AMA Worker',
    runtime: 'ama',
    installation: {
      agentId: 'ama-agent-1',
      hostId: 'ama-host-1',
      name: 'AMA Runner',
      kid: 'ama-key-1',
      publicKey,
    },
  }
}

async function exportedAgentPublicJwk(publicKey: CryptoKey, kid: string) {
  return { ...(await exportJWK(publicKey)), kid } as CreateAgent['installation']['publicKey']
}

function applicationAgentContext() {
  return {
    applicationId: 'ama-application',
    actorUserId: 'user-1',
    issuer: 'https://auth.example.com/api/auth',
    idempotencyKey: 'ama-create-1',
  }
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

function loginInput() {
  return {
    protocolAgentId: 'protocol-agent-1',
    username: 'build-agent',
    nickname: 'Build Agent',
    runtime: 'codex',
  }
}

function identity(overrides: Partial<AgentIdentityRecord> = {}): AgentIdentityRecord {
  const now = new Date('2026-08-01T00:00:00.000Z')
  return {
    id: 'identity-1',
    issuer: 'https://auth.example.com',
    subject: 'agt_stable',
    username: 'build-agent',
    name: 'Build Agent',
    runtime: 'codex',
    ownerUserId: 'user-1',
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
    requestedUsername: 'build-agent',
    requestedRuntime: 'codex',
    ownerUserId: 'user-1',
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
