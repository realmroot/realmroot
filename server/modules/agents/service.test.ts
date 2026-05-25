import type { AgentSession } from '@better-auth/agent-auth'
import { describe, expect, it, vi } from 'vitest'
import { agentCapabilities, areKnownAgentCapabilities } from './capabilities'
import { AgentService } from './service'

describe('AgentService', () => {
  it('executes only read-only account capabilities through the user repository', async () => {
    const users = createUserRepositoryMock()
    const service = new AgentService(users as never, createAgentRepositoryMock())
    const agentSession = createAgentSession()

    await expect(
      service.executeReadOnlyCapability({
        capability: 'account.profile.read',
        agentSession,
      }),
    ).resolves.toEqual({ user: { id: 'user-1', email: 'user@example.com' } })
    await expect(
      service.executeReadOnlyCapability({
        capability: 'account.sessions.list',
        arguments: { limit: 25, offset: 50 },
        agentSession,
      }),
    ).resolves.toEqual({
      sessions: [{ id: 'session-1' }],
      pagination: { limit: 25, offset: 50, total: 1, hasMore: false, nextOffset: null },
    })
    await expect(
      service.executeReadOnlyCapability({
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
    const service = new AgentService(users as never, createAgentRepositoryMock())

    await expect(
      service.executeReadOnlyCapability({
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
    const service = new AgentService(createUserRepositoryMock() as never, createAgentRepositoryMock())
    const agentSession = createAgentSession()

    await expect(
      service.executeReadOnlyCapability({
        capability: 'account.profile.write',
        agentSession,
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      service.executeReadOnlyCapability({
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
    const service = new AgentService(createUserRepositoryMock() as never, repository as never)
    const page = { limit: 10, offset: 0 }

    await expect(service.listHosts(page)).resolves.toMatchObject({ items: [{ id: 'host-1' }] })
    await expect(service.listAgents(page)).resolves.toMatchObject({ items: [{ id: 'agent-1' }] })
    await expect(service.listCapabilityGrants(page)).resolves.toMatchObject({ items: [{ id: 'grant-1' }] })
    await expect(service.listApprovalRequests(page)).resolves.toMatchObject({ items: [{ id: 'approval-1' }] })
  })

  it('declares only the narrow MVP capability catalog', () => {
    expect(agentCapabilities.map((capability) => capability.name)).toEqual([
      'account.profile.read',
      'account.sessions.list',
      'account.authorized_apps.list',
    ])
    expect(areKnownAgentCapabilities(['account.profile.read', 'account.sessions.list'])).toBe(true)
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
  }
}

function createAgentSession(): AgentSession {
  return {
    type: 'delegated',
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
