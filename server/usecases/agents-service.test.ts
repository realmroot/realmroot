import {
  decideAgentApproval,
  getAgentApprovalPreview,
  listAccountAgents,
  listAgentApprovalRequests,
  listAgentCapabilityGrants,
  listAgentHosts,
  listAgents,
  revokeAccountAgent,
  revokeAccountCapabilityGrant,
  revokeAgent,
  revokeAgentCapabilityGrant,
  revokeAgentHost,
} from '@server/usecases/agents'
import type { Deps } from '@server/usecases/deps'
import { createIdentifierGeneratorFake } from '@server/usecases/identifier-generator.fake'
import { describe, expect, it, vi } from 'vitest'

describe('AgentService', () => {
  it('delegates protocol inventory reads to the repository', async () => {
    const repository = createAgentRepositoryMock()
    repository.listHosts.mockResolvedValue({ items: [{ id: 'host-1' }], total: 1, limit: 10, offset: 0 })
    repository.listAgents.mockResolvedValue({ items: [{ id: 'agent-1' }], total: 1, limit: 10, offset: 0 })
    repository.listCapabilityGrants.mockResolvedValue({ items: [{ id: 'grant-1' }], total: 1, limit: 10, offset: 0 })
    repository.listApprovalRequests.mockResolvedValue({
      items: [{ id: 'approval-1' }],
      total: 1,
      limit: 10,
      offset: 0,
    })
    const deps = { users: createUserRepositoryMock(), agents: repository } as unknown as Deps
    const page = { limit: 10, offset: 0 }

    await expect(listAgentHosts(deps, page)).resolves.toMatchObject({ items: [{ id: 'host-1' }] })
    await expect(listAgents(deps, page)).resolves.toMatchObject({ items: [{ id: 'agent-1' }] })
    await expect(listAgentCapabilityGrants(deps, page)).resolves.toMatchObject({ items: [{ id: 'grant-1' }] })
    await expect(listAgentApprovalRequests(deps, page)).resolves.toMatchObject({ items: [{ id: 'approval-1' }] })
  })

  it('maps account-owned agents with capability grants and delegates revokes', async () => {
    const repository = createAgentRepositoryMock()
    repository.listAgentsForUser.mockResolvedValue({
      items: [
        {
          id: 'agent-1',
          name: 'Desktop Agent',
          hostId: 'host-1',
          status: 'active',
          mode: 'delegated',
          lastUsedAt: null,
          activatedAt: null,
          expiresAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    })
    repository.listCapabilityGrantsForUser.mockResolvedValue([
      {
        id: 'grant-1',
        agentId: 'agent-1',
        capability: 'account.profile.read',
        status: 'active',
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    repository.listHostsForAgents.mockResolvedValue([{ id: 'host-1', name: 'Desktop Host', status: 'active' }])
    const deps = { users: createUserRepositoryMock(), agents: repository } as unknown as Deps

    await expect(listAccountAgents(deps, 'user-1', { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [
        {
          id: 'agent-1',
          host: { id: 'host-1', name: 'Desktop Host', status: 'active' },
          capabilityGrants: [{ id: 'grant-1', capability: 'account.profile.read' }],
        },
      ],
      pagination: { page: Math.floor(0 / 10) + 1, pageSize: 10, totalItems: 1, totalPages: Math.ceil(1 / 10) },
    })
    await revokeAccountAgent(deps, 'agent-1', 'user-1')
    await revokeAccountCapabilityGrant(deps, 'grant-1', 'user-1')
    await revokeAgent(deps, 'agent-1')
    await revokeAgentHost(deps, 'host-1')
    await revokeAgentCapabilityGrant(deps, 'grant-1')

    expect(repository.listAgentsForUser).toHaveBeenCalledWith('user-1', { limit: 10, offset: 0 })
    expect(repository.listHostsForAgents).toHaveBeenCalledWith(['host-1'])
    expect(repository.listCapabilityGrantsForUser).toHaveBeenCalledWith('user-1')
    expect(repository.revokeAgentForUser).toHaveBeenCalledWith('agent-1', 'user-1')
    expect(repository.revokeCapabilityGrantForUser).toHaveBeenCalledWith('grant-1', 'user-1')
    expect(repository.revokeAgent).toHaveBeenCalledWith('agent-1')
    expect(repository.revokeHost).toHaveBeenCalledWith('host-1')
    expect(repository.revokeCapabilityGrant).toHaveBeenCalledWith('grant-1')
  })

  it('normalizes and hashes the Agent approval code before persisting an approval', async () => {
    const repository = createAgentRepositoryMock()
    repository.decideApproval.mockResolvedValue('approved')
    repository.listCapabilityGrantsForAgent.mockResolvedValue([
      { agentId: 'agent-1', capability: 'applications:read', status: 'pending' },
    ])
    const agentAudit = { append: vi.fn() }
    const deps = {
      ids: createIdentifierGeneratorFake(),
      agents: repository,
      agentIdentities: createAgentIdentityRepositoryMock(),
      agentAudit,
    } as unknown as Deps

    await expect(
      decideAgentApproval(
        deps,
        {
          agentId: 'agent-1',
          userCode: 'abcd1234',
          action: 'approve',
          capabilities: ['applications:read'],
        },
        'user-1',
      ),
    ).resolves.toEqual({ status: 'approved' })

    expect(repository.decideApproval).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        userCodeHash: await sha256Base64url('ABCD-1234'),
        action: 'approve',
        capabilities: ['applications:read'],
        userId: 'user-1',
        now: expect.any(Date),
      },
      expect.objectContaining({
        action: 'agent.capability_decided',
        result: 'allowed',
        controllerUserId: 'user-1',
        agentIdentityId: 'agid-1',
        hostId: 'host-1',
        scopes: ['applications:read'],
      }),
    )

    repository.decideApproval.mockResolvedValue('approved')
    await expect(
      decideAgentApproval(deps, { agentId: 'agent-1', userCode: 'abcd1234', action: 'approve' }, 'user-1'),
    ).resolves.toEqual({ status: 'approved' })
    expect(repository.decideApproval).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ scopes: ['applications:read'] }),
    )
  })

  it('returns the pending Agent and Host shown on the protocol approval page', async () => {
    const repository = createAgentRepositoryMock()
    repository.findPendingApprovalPreview.mockResolvedValue({
      agent: { id: 'agent-1', name: 'Build Agent', userId: 'user-1' },
      host: { id: 'host-1', name: 'Codex', userId: null },
    })
    const deps = { agents: repository } as unknown as Deps

    await expect(
      getAgentApprovalPreview(deps, { agentId: 'agent-1', userCode: 'abcd1234' }, 'user-1'),
    ).resolves.toEqual({
      agent: { id: 'agent-1', name: 'Build Agent' },
      host: { id: 'host-1', name: 'Codex' },
    })
    expect(repository.findPendingApprovalPreview).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userCodeHash: await sha256Base64url('ABCD-1234'),
      now: expect.any(Date),
    })
  })

  it('rejects unavailable protocol approvals and controller ownership mismatches', async () => {
    const repository = createAgentRepositoryMock()
    const deps = { agents: repository } as unknown as Deps

    repository.findPendingApprovalPreview.mockResolvedValueOnce(null)
    await expect(
      getAgentApprovalPreview(deps, { agentId: 'agent-1', userCode: 'ABCD-1234' }, 'user-1'),
    ).rejects.toThrow('Agent approval is invalid, expired, or no longer pending.')

    repository.findPendingApprovalPreview.mockResolvedValueOnce({
      agent: { id: 'agent-1', name: 'Build Agent', userId: 'user-2' },
      host: { id: 'host-1', name: 'Codex', userId: null },
    })
    await expect(
      getAgentApprovalPreview(deps, { agentId: 'agent-1', userCode: 'ABCD-1234' }, 'user-1'),
    ).rejects.toThrow('Agent approval belongs to another controller.')

    repository.findPendingApprovalPreview.mockResolvedValueOnce({
      agent: { id: 'agent-1', name: 'Build Agent', userId: null },
      host: { id: 'host-1', name: 'Codex', userId: 'user-2' },
    })
    await expect(
      getAgentApprovalPreview(deps, { agentId: 'agent-1', userCode: 'ABCD-1234' }, 'user-1'),
    ).rejects.toThrow('Agent host belongs to another controller.')
  })

  it('preserves a nonstandard Agent approval code shape and returns denial', async () => {
    const repository = createAgentRepositoryMock()
    repository.decideApproval.mockResolvedValue('denied')
    repository.listCapabilityGrantsForAgent.mockResolvedValue([
      { agentId: 'agent-2', capability: 'users:write', status: 'pending' },
    ])
    const agentAudit = { append: vi.fn() }
    const deps = {
      ids: createIdentifierGeneratorFake(),
      agents: repository,
      agentIdentities: createAgentIdentityRepositoryMock(),
      agentAudit,
    } as unknown as Deps

    await expect(
      decideAgentApproval(
        deps,
        {
          agentId: 'agent-2',
          userCode: 'bad-code',
          action: 'deny',
        },
        'user-2',
      ),
    ).resolves.toEqual({ status: 'denied' })

    expect(repository.decideApproval).toHaveBeenCalledWith(
      {
        agentId: 'agent-2',
        userCodeHash: await sha256Base64url('BAD-CODE'),
        action: 'deny',
        capabilities: undefined,
        userId: 'user-2',
        now: expect.any(Date),
      },
      expect.objectContaining({ action: 'agent.capability_decided', result: 'denied', scopes: ['users:write'] }),
    )
  })

  it('materializes the controlled tenant for approval audit and uses the approving controller for first enrollment', async () => {
    const repository = createAgentRepositoryMock()
    repository.decideApproval.mockResolvedValue('approved')
    const identities = createAgentIdentityRepositoryMock()
    const agentAudit = { append: vi.fn() }
    const deps = {
      ids: createIdentifierGeneratorFake(),
      agents: repository,
      agentIdentities: identities,
      agentAudit,
    } as unknown as Deps

    identities.findActiveByProtocolAgent.mockResolvedValueOnce({
      identity: {
        id: 'agid-org',
        issuer: 'https://auth.example.com',
        subject: 'agt-org',
        name: 'Organization Agent',
        ownerUserId: 'user-2',
        ownerOrganizationId: null,
        status: 'active',
      },
      bindings: [],
    })
    await decideAgentApproval(deps, { agentId: 'agent-org', userCode: 'ABCD-1234', action: 'approve' }, 'user-1')
    expect(repository.decideApproval).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerUserId: 'user-2', ownerOrganizationId: null }),
    )

    identities.findActiveByProtocolAgent.mockResolvedValueOnce(null)
    identities.findProtocolAgent.mockResolvedValueOnce({ hostId: 'host-1', userId: 'user-2' })
    await decideAgentApproval(deps, { agentId: 'agent-user', userCode: 'ABCD-1234', action: 'approve' }, 'user-1')
    expect(repository.decideApproval).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerUserId: 'user-2', ownerOrganizationId: null }),
    )

    identities.findActiveByProtocolAgent.mockResolvedValueOnce(null)
    identities.findProtocolAgent.mockResolvedValueOnce({ hostId: 'host-1', userId: null })
    await decideAgentApproval(deps, { agentId: 'agent-unowned', userCode: 'ABCD-1234', action: 'approve' }, 'user-1')
    expect(repository.decideApproval).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerUserId: 'user-1', ownerOrganizationId: null }),
    )
  })
})

function createUserRepositoryMock() {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }),
    listSessions: vi.fn().mockResolvedValue({
      items: [{ id: 'session-1' }],
      total: 1,
      limit: 25,
      offset: 50,
    }),
  }
}

function createAgentRepositoryMock() {
  return {
    listHosts: vi.fn(),
    listAgents: vi.fn(),
    listCapabilityGrants: vi.fn(),
    listApprovalRequests: vi.fn(),
    listAgentsForUser: vi.fn(),
    listHostsForAgents: vi.fn(),
    listCapabilityGrantsForUser: vi.fn(),
    listCapabilityGrantsForAgent: vi.fn().mockResolvedValue([]),
    findPendingApprovalPreview: vi.fn(),
    decideApproval: vi.fn(),
    revokeAgentForUser: vi.fn(),
    revokeCapabilityGrantForUser: vi.fn(),
    revokeAgent: vi.fn(),
    revokeHost: vi.fn(),
    revokeCapabilityGrant: vi.fn(),
  }
}

async function sha256Base64url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function createAgentIdentityRepositoryMock() {
  return {
    findActiveByProtocolAgent: vi.fn().mockResolvedValue({
      identity: {
        id: 'agid-1',
        issuer: 'https://auth.example.com',
        subject: 'agt-1',
        name: 'Test Agent',
        ownerUserId: 'user-1',
        status: 'active',
      },
      bindings: [],
    }),
    findProtocolAgent: vi.fn().mockResolvedValue({ hostId: 'host-1' }),
  }
}
