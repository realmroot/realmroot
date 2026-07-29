import { managementAgentsRoute } from '@server/http/routes/management/agents'
import * as agentIdentitiesUsecase from '@server/usecases/agent-identities'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('management Agent routes', () => {
  it('exposes stable Agents without protocol hosts, bindings, or approval records', async () => {
    vi.spyOn(agentIdentitiesUsecase, 'listAllAgents').mockResolvedValue({
      items: [
        {
          id: 'agent-1',
          issuer: 'https://auth.example.com/api/auth',
          subject: 'agt_1',
          name: 'Build Agent',
          homeSpace: { type: 'personal', userId: 'user-1' },
          status: 'active',
          retiredAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      pagination: { limit: 10, offset: 20, total: 1, hasMore: false, nextOffset: null },
    })
    const app = withAdminContext()
    app.route('/', managementAgentsRoute)

    const response = await app.request('/agents?limit=10&offset=20')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: 'agent-1',
          issuer: 'https://auth.example.com/api/auth',
          subject: 'agt_1',
          name: 'Build Agent',
          homeSpace: { type: 'personal', userId: 'user-1' },
          status: 'active',
          retiredAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      pagination: { limit: 10, offset: 20, total: 1, hasMore: false, nextOffset: null },
    })
    expect(agentIdentitiesUsecase.listAllAgents).toHaveBeenCalledWith(expect.anything(), {
      limit: 10,
      offset: 20,
    })
  })
})

function withAdminContext() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    const user = { id: 'admin-1', role: 'admin' }
    c.set('authContext', {
      session: { session: { id: 'session-1' }, user },
      user,
    })
    c.set('deps', {} as never)
    await next()
  })
  return app
}
