import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('management agent routes', () => {
  it('reads and revokes delegated AgentAuth inventory from the management surface', async () => {
    const service = {
      listHosts: vi.fn().mockResolvedValue(page([{ id: 'host-1', status: 'active' }])),
      listAgents: vi.fn().mockResolvedValue(page([{ id: 'agent-1', name: 'Desktop Agent', status: 'active' }])),
      listCapabilityGrants: vi.fn().mockResolvedValue(page([{ id: 'grant-1', capability: 'account.profile.read' }])),
      listApprovalRequests: vi.fn().mockResolvedValue(page([{ id: 'approval-1', method: 'device_authorization' }])),
      revokeAgent: vi.fn().mockResolvedValue(undefined),
      revokeHost: vi.fn().mockResolvedValue(undefined),
      revokeCapabilityGrant: vi.fn().mockResolvedValue(undefined),
    }
    vi.doMock('../modules/agents/context', () => ({
      createAgentService: () => service,
    }))
    const { managementAgentsRoute } = await import('./management/agents')
    const app = withAdminContext()
    app.route('/management', managementAgentsRoute)

    const inventoryResponse = await app.request('/management/agents/protocol-inventory?limit=10&offset=20')
    const agentResponse = await app.request('/management/agents/agent-1', { method: 'DELETE' })
    const hostResponse = await app.request('/management/agent-hosts/host-1', { method: 'DELETE' })
    const grantResponse = await app.request('/management/agent-capability-grants/grant-1', { method: 'DELETE' })

    expect(inventoryResponse.status).toBe(200)
    await expect(inventoryResponse.json()).resolves.toMatchObject({
      hosts: { items: [{ id: 'host-1', status: 'active' }] },
      agents: { items: [{ id: 'agent-1', name: 'Desktop Agent', status: 'active' }] },
      capabilityGrants: { items: [{ id: 'grant-1', capability: 'account.profile.read' }] },
      approvalRequests: { items: [{ id: 'approval-1', method: 'device_authorization' }] },
    })
    expect(agentResponse.status).toBe(204)
    expect(hostResponse.status).toBe(204)
    expect(grantResponse.status).toBe(204)
    expect(service.revokeAgent).toHaveBeenCalledWith('agent-1')
    expect(service.revokeHost).toHaveBeenCalledWith('host-1')
    expect(service.revokeCapabilityGrant).toHaveBeenCalledWith('grant-1')
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
