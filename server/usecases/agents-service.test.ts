import type { AgentSession } from '@better-auth/agent-auth'
import { agentCapabilities } from '@server/auth-capabilities'
import { areKnownAgentCapabilities } from '@server/domain/agents/capabilities'
import {
  decideAgentApproval,
  executeReadOnlyCapability,
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
import { describe, expect, it, vi } from 'vitest'

describe('AgentService', () => {
  it('executes only read-only account capabilities through the user repository', async () => {
    const users = createUserRepositoryMock()
    const deps = {
      users,
      agents: createAgentRepositoryMock(),
      agentIdentities: createAgentIdentityRepositoryMock(),
    } as unknown as Deps
    const agentSession = createAgentSession()

    await expect(
      executeReadOnlyCapability(deps, {
        capability: 'account.profile.read',
        agentSession,
      }),
    ).resolves.toEqual({ user: { id: 'user-1', email: 'user@example.com' } })
    await expect(
      executeReadOnlyCapability(deps, {
        capability: 'account.sessions.list',
        arguments: { limit: 25, offset: 50 },
        agentSession,
      }),
    ).resolves.toEqual({
      sessions: [{ id: 'session-1' }],
      pagination: { limit: 25, offset: 50, total: 1, hasMore: false, nextOffset: null },
    })
    await expect(
      executeReadOnlyCapability(deps, {
        capability: 'account.authorized_apps.list',
        arguments: { limit: 10 },
        agentSession,
      }),
    ).resolves.toEqual({
      applications: [{ id: 'consent-1' }],
      pagination: { limit: 10, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })

    expect(users.getUser).toHaveBeenCalledWith('user-1')
    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 25, offset: 50 })
    expect(users.listConsentedApplications).toHaveBeenCalledWith('user-1', { limit: 10, offset: 0 })
  })

  it('uses default pagination when list capability arguments are omitted', async () => {
    const users = createUserRepositoryMock()
    users.listSessions.mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    })
    const deps = {
      users,
      agents: createAgentRepositoryMock(),
      agentIdentities: createAgentIdentityRepositoryMock(),
    } as unknown as Deps

    await expect(
      executeReadOnlyCapability(deps, {
        capability: 'account.sessions.list',
        agentSession: createAgentSession(),
      }),
    ).resolves.toEqual({
      sessions: [],
      pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
    })

    expect(users.listSessions).toHaveBeenCalledWith('user-1', { limit: 50, offset: 0 })
  })

  it('rejects unknown capabilities and invalid pagination arguments', async () => {
    const deps = {
      users: createUserRepositoryMock(),
      agents: createAgentRepositoryMock(),
      agentIdentities: createAgentIdentityRepositoryMock(),
    } as unknown as Deps
    const agentSession = createAgentSession()

    await expect(
      executeReadOnlyCapability(deps, {
        capability: 'account.profile.write',
        agentSession,
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      executeReadOnlyCapability(deps, {
        capability: 'account.sessions.list',
        arguments: { limit: 101 },
        agentSession,
      }),
    ).rejects.toThrow()
  })

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

  it('fails closed when a protocol Agent has no active stable identity binding [spec: agent-identity/agent-identity-enrollment]', async () => {
    const agentIdentities = createAgentIdentityRepositoryMock()
    agentIdentities.findActiveByProtocolAgent.mockResolvedValue(null)
    const deps = {
      users: createUserRepositoryMock(),
      agents: createAgentRepositoryMock(),
      agentIdentities,
    } as unknown as Deps

    await expect(
      executeReadOnlyCapability(deps, {
        capability: 'account.profile.read',
        agentSession: createAgentSession(),
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(deps.users.getUser).not.toHaveBeenCalled()
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
      agents: [
        {
          id: 'agent-1',
          host: { id: 'host-1', name: 'Desktop Host', status: 'active' },
          capabilityGrants: [{ id: 'grant-1', capability: 'account.profile.read' }],
        },
      ],
      pagination: { limit: 10, offset: 0, total: 1 },
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
    const deps = { agents: repository } as unknown as Deps

    await expect(
      decideAgentApproval(
        deps,
        {
          agentId: 'agent-1',
          userCode: 'abcd1234',
          action: 'approve',
          capabilities: ['management:read'],
        },
        'user-1',
      ),
    ).resolves.toEqual({ status: 'approved' })

    expect(repository.decideApproval).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userCodeHash: await sha256Base64url('ABCD-1234'),
      action: 'approve',
      capabilities: ['management:read'],
      userId: 'user-1',
      now: expect.any(Date),
    })
  })

  it('preserves a nonstandard Agent approval code shape and returns denial', async () => {
    const repository = createAgentRepositoryMock()
    repository.decideApproval.mockResolvedValue('denied')
    const deps = { agents: repository } as unknown as Deps

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

    expect(repository.decideApproval).toHaveBeenCalledWith({
      agentId: 'agent-2',
      userCodeHash: await sha256Base64url('BAD-CODE'),
      action: 'deny',
      capabilities: undefined,
      userId: 'user-2',
      now: expect.any(Date),
    })
  })

  it('declares account data capabilities and coarse unified API management permissions', () => {
    expect(agentCapabilities.map((capability) => capability.name)).toEqual([
      'account.profile.read',
      'account.sessions.list',
      'account.authorized_apps.list',
      'management:read',
      'management:write',
    ])
    expect(areKnownAgentCapabilities(['account.profile.read', 'management:read'])).toBe(true)
    expect(areKnownAgentCapabilities(['management.openapi.generate'])).toBe(false)
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
    listConsentedApplications: vi.fn().mockResolvedValue({
      items: [{ id: 'consent-1' }],
      total: 1,
      limit: 10,
      offset: 0,
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
        ownerOrganizationId: null,
        status: 'active',
      },
      bindings: [],
    }),
  }
}

function createAgentSession(): AgentSession {
  return {
    type: 'delegated',
    agentId: 'agent-1',
    userId: 'user-1',
    agent: {
      id: 'agent-1',
      name: 'Test Agent',
      mode: 'delegated',
      capabilityGrants: [],
      hostId: 'host-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      activatedAt: null,
      metadata: null,
    },
    host: {
      id: 'host-1',
      userId: 'user-1',
      status: 'active',
    },
    user: {
      id: 'user-1',
      name: 'User',
      email: 'user@example.com',
    },
  }
}
