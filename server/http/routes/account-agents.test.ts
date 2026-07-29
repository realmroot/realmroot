import { accountRoutes } from '@server/http/routes/account'
import * as agentIdentitiesUsecase from '@server/usecases/agent-identities'
import * as agentsUsecase from '@server/usecases/agents'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('account agent routes', () => {
  it('submits a controller decision through the account approval boundary [spec: agent-identity/agent-identity-enrollment]', async () => {
    const decide = vi.spyOn(agentsUsecase, 'decideAgentApproval').mockResolvedValue({ status: 'approved' } as const)
    const app = withAccountContext()
    app.route('/account', accountRoutes({} as never))

    const response = await app.request('/account/agent-enrollments/agent-1/decision', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'protocol',
        userCode: 'ABCD-1234',
        decision: 'approve',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'approved' })
    expect(decide).toHaveBeenCalledWith(
      expect.anything(),
      { agentId: 'agent-1', userCode: 'ABCD-1234', action: 'approve' },
      'user-1',
    )
  })

  it('lists and retires stable Agents for the signed-in account [spec: account-center/account-agent-management]', async () => {
    const stableAgents = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'agent-1',
            issuer: 'https://auth.example.com/api/auth',
            subject: 'agt_1',
            name: 'Desktop Agent',
            homeSpace: { type: 'personal', userId: 'user-1' },
            status: 'active',
            retiredAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        pagination: { limit: 10, offset: 20, total: 1, hasMore: false, nextOffset: null },
      }),
      retire: vi.fn().mockResolvedValue(undefined),
    }
    vi.spyOn(agentIdentitiesUsecase, 'listPersonalAgents').mockImplementation((_d, userId, page) =>
      stableAgents.list(userId, page),
    )
    vi.spyOn(agentIdentitiesUsecase, 'retireAgentIdentity').mockImplementation((_d, agentId, userId) =>
      stableAgents.retire(agentId, userId),
    )

    const app = withAccountContext()
    app.route('/account', accountRoutes({} as never))

    const listResponse = await app.request('/account/agents?limit=10&offset=20')
    const agentResponse = await app.request('/account/agents/agent-1', { method: 'DELETE' })

    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      items: [{ id: 'agent-1', subject: 'agt_1' }],
      pagination: { limit: 10, offset: 20, total: 1 },
    })
    expect(agentResponse.status).toBe(204)
    expect(stableAgents.list).toHaveBeenCalledWith('user-1', { limit: 10, offset: 20 })
    expect(stableAgents.retire).toHaveBeenCalledWith('agent-1', 'user-1')
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
