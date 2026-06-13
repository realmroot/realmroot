import { managementAgentsRoute } from '@server/http/routes/management/agents'
import * as agentsUsecase from '@server/usecases/agents'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('management agent routes', () => {
  it('reads delegated AgentAuth protocol inventory from the agent module', async () => {
    const service = {
      listHosts: vi
        .fn()
        .mockResolvedValue(page([{ id: 'host-1', status: 'active', enrollmentTokenHash: 'enrollment-secret' }])),
      listAgents: vi.fn().mockResolvedValue(page([{ id: 'agent-1', mode: 'delegated', status: 'pending' }])),
      listCapabilityGrants: vi
        .fn()
        .mockResolvedValue(page([{ id: 'grant-1', capability: 'account.profile.read', status: 'pending' }])),
      listApprovalRequests: vi.fn().mockResolvedValue(
        page([
          {
            id: 'approval-1',
            method: 'device_authorization',
            status: 'pending',
            userCodeHash: 'code-secret',
            clientNotificationToken: 'notification-secret',
          },
        ]),
      ),
    }
    vi.spyOn(agentsUsecase, 'listAgentHosts').mockImplementation((_deps, query) => service.listHosts(query))
    vi.spyOn(agentsUsecase, 'listAgents').mockImplementation((_deps, query) => service.listAgents(query))
    vi.spyOn(agentsUsecase, 'listAgentCapabilityGrants').mockImplementation((_deps, query) =>
      service.listCapabilityGrants(query),
    )
    vi.spyOn(agentsUsecase, 'listAgentApprovalRequests').mockImplementation((_deps, query) =>
      service.listApprovalRequests(query),
    )
    const app = withAdminContext()
    app.route('/', managementAgentsRoute)

    const response = await app.request('/agents/protocol-inventory?limit=10&offset=20')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      hosts: {
        items: [{ id: 'host-1', status: 'active' }],
        pagination: { limit: 10, offset: 20, total: 1, hasMore: false, nextOffset: null },
      },
      agents: {
        items: [{ id: 'agent-1', mode: 'delegated', status: 'pending' }],
        pagination: { limit: 10, offset: 20, total: 1, hasMore: false, nextOffset: null },
      },
      capabilityGrants: {
        items: [{ id: 'grant-1', capability: 'account.profile.read', status: 'pending' }],
        pagination: { limit: 10, offset: 20, total: 1, hasMore: false, nextOffset: null },
      },
      approvalRequests: {
        items: [{ id: 'approval-1', method: 'device_authorization', status: 'pending' }],
        pagination: { limit: 10, offset: 20, total: 1, hasMore: false, nextOffset: null },
      },
    })
    expect(service.listHosts).toHaveBeenCalledWith({ limit: 10, offset: 20 })
    expect(service.listAgents).toHaveBeenCalledWith({ limit: 10, offset: 20 })
    expect(service.listCapabilityGrants).toHaveBeenCalledWith({ limit: 10, offset: 20 })
    expect(service.listApprovalRequests).toHaveBeenCalledWith({ limit: 10, offset: 20 })
    const body = JSON.stringify(await (await app.request('/agents/protocol-inventory?limit=10&offset=20')).json())
    expect(body).not.toContain('enrollment-secret')
    expect(body).not.toContain('code-secret')
    expect(body).not.toContain('notification-secret')
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

function page<T>(items: T[]) {
  return {
    items,
    limit: 10,
    offset: 20,
    total: items.length,
  }
}
