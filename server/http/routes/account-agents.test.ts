import { accountRoutes } from '@server/http/routes/account'
import * as agentsUsecase from '@server/usecases/agents'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('account agent routes', () => {
  it('lists and revokes delegated agents for the signed-in account [spec: account-center/account-agent-management]', async () => {
    const agents = {
      listAccountAgents: vi.fn().mockResolvedValue({
        agents: [
          {
            id: 'agent-1',
            name: 'Desktop Agent',
            hostId: 'host-1',
            host: { id: 'host-1', name: 'Desktop Host', status: 'active' },
            status: 'active',
            mode: 'delegated',
            lastUsedAt: null,
            activatedAt: null,
            expiresAt: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            capabilityGrants: [
              {
                id: 'grant-1',
                agentId: 'agent-1',
                capability: 'account.profile.read',
                status: 'active',
                expiresAt: null,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              },
            ],
          },
        ],
        pagination: { limit: 10, offset: 20, total: 1, hasMore: false, nextOffset: null },
      }),
      revokeAccountAgent: vi.fn().mockResolvedValue(undefined),
      revokeAccountCapabilityGrant: vi.fn().mockResolvedValue(undefined),
    }
    vi.spyOn(agentsUsecase, 'listAccountAgents').mockImplementation((_d, userId, page) =>
      agents.listAccountAgents(userId, page),
    )
    vi.spyOn(agentsUsecase, 'revokeAccountAgent').mockImplementation((_d, agentId, userId) =>
      agents.revokeAccountAgent(agentId, userId),
    )
    vi.spyOn(agentsUsecase, 'revokeAccountCapabilityGrant').mockImplementation((_d, grantId, userId) =>
      agents.revokeAccountCapabilityGrant(grantId, userId),
    )

    const app = withAccountContext()
    app.route('/account', accountRoutes({} as never))

    const listResponse = await app.request('/account/agents?limit=10&offset=20')
    const agentResponse = await app.request('/account/agents/agent-1', { method: 'DELETE' })
    const grantResponse = await app.request('/account/agent-capability-grants/grant-1', { method: 'DELETE' })

    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      agents: [{ id: 'agent-1', capabilityGrants: [{ id: 'grant-1', capability: 'account.profile.read' }] }],
      pagination: { limit: 10, offset: 20, total: 1 },
    })
    expect(agentResponse.status).toBe(204)
    expect(grantResponse.status).toBe(204)
    expect(agents.listAccountAgents).toHaveBeenCalledWith('user-1', { limit: 10, offset: 20 })
    expect(agents.revokeAccountAgent).toHaveBeenCalledWith('agent-1', 'user-1')
    expect(agents.revokeAccountCapabilityGrant).toHaveBeenCalledWith('grant-1', 'user-1')
  })
})

function withAccountContext() {
  const app = new Hono()
  const deps = createTestDeps()
  app.use('*', async (c, next) => {
    const user = { id: 'user-1', role: 'user', email: 'user@example.com' }
    c.set('authContext', {
      session: { session: { id: 'session-1' }, user },
      user,
    })
    c.set('deps', deps)
    await next()
  })
  return app
}
