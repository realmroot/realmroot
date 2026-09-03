import { managementAgentsRoute } from '@server/http/routes/management/agents'
import * as agentIdentitiesUsecase from '@server/usecases/agent-identities'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('management Agent routes', () => {
  it('creates a User-owned Agent for an authorized delegated Application [spec: agent-identity/application-agent-creation]', async () => {
    vi.spyOn(agentIdentitiesUsecase, 'createAgentWithInstallation').mockResolvedValue({
      replayed: false,
      agent: {
        id: 'agent-1',
        issuer: 'https://auth.example.com/api/auth',
        subject: 'agt_1',
        username: 'build-agent',
        name: 'Build Agent',
        runtime: 'ama',
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    const app = withApplicationContext()
    app.route('/', managementAgentsRoute)

    const response = await app.request('/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'ama-agent-1' },
      body: JSON.stringify({
        username: 'build-agent',
        name: 'Build Agent',
        runtime: 'ama',
        installation: {
          agentId: 'ama-protocol-agent-1',
          hostId: 'ama-host-1',
          name: 'AMA Runner',
          kid: 'key-1',
          publicKey: { kty: 'OKP', crv: 'Ed25519', x: 'public', kid: 'key-1' },
        },
      }),
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBe('/api/agents/agent-1')
    await expect(response.json()).resolves.toMatchObject({ id: 'agent-1', subject: 'agt_1', status: 'active' })
    expect(agentIdentitiesUsecase.createAgentWithInstallation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ username: 'build-agent' }),
      expect.objectContaining({ applicationId: 'application-1', actorUserId: 'user-1', idempotencyKey: 'ama-agent-1' }),
    )
  })

  it('uses the configured canonical origin for the persisted Agent issuer instead of the request Host', async () => {
    vi.spyOn(agentIdentitiesUsecase, 'createAgentWithInstallation').mockResolvedValue({
      replayed: false,
      agent: {
        id: 'agent-canonical',
        issuer: 'https://auth.example.com/api/auth',
        subject: 'agt_canonical',
        username: 'canonical-agent',
        name: 'Canonical Agent',
        runtime: 'ama',
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    const app = withApplicationContext('https://auth.example.com')
    app.route('/', managementAgentsRoute)

    const response = await app.request('https://untrusted.example/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'canonical-agent-1' },
      body: JSON.stringify({
        username: 'canonical-agent',
        name: 'Canonical Agent',
        runtime: 'ama',
        installation: {
          agentId: 'canonical-protocol-agent',
          hostId: 'canonical-host',
          name: 'Canonical Runner',
          kid: 'key-1',
          publicKey: { kty: 'OKP', crv: 'Ed25519', x: 'public', kid: 'key-1' },
        },
      }),
    })

    expect(response.status, await response.clone().text()).toBe(201)
    expect(agentIdentitiesUsecase.createAgentWithInstallation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ issuer: 'https://auth.example.com/api/auth' }),
    )
  })

  it('exposes stable Agents without protocol hosts, bindings, or approval records', async () => {
    vi.spyOn(agentIdentitiesUsecase, 'listAllAgents').mockResolvedValue({
      items: [
        {
          id: 'agent-1',
          issuer: 'https://auth.example.com/api/auth',
          subject: 'agt_1',
          username: 'build-agent.00000000000000000000000000000003',
          name: 'Build Agent',
          runtime: 'codex',
          homeSpace: { type: 'personal', userId: 'user-1' },
          owner: { id: 'user-1', type: 'user', displayName: 'Alice' },
          status: 'active',
          installationCount: 1,
          pendingRequestCount: 1,
          activeResourceCount: 1,
          activeScopeCount: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      pagination: { page: Math.floor(20 / 10) + 1, pageSize: 10, totalItems: 1, totalPages: Math.ceil(1 / 10) },
    })
    const app = withAdminContext()
    app.route('/', managementAgentsRoute)

    const response = await app.request('/agents?page=3&pageSize=10')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: 'agent-1',
          issuer: 'https://auth.example.com/api/auth',
          subject: 'agt_1',
          username: 'build-agent.00000000000000000000000000000003',
          name: 'Build Agent',
          runtime: 'codex',
          homeSpace: { type: 'personal', userId: 'user-1' },
          owner: { id: 'user-1', type: 'user', displayName: 'Alice' },
          status: 'active',
          installationCount: 1,
          pendingRequestCount: 1,
          activeResourceCount: 1,
          activeScopeCount: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      pagination: { page: Math.floor(20 / 10) + 1, pageSize: 10, totalItems: 1, totalPages: Math.ceil(1 / 10) },
    })
    expect(agentIdentitiesUsecase.listAllAgents).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 10, offset: 20 },
      undefined,
    )
  })
})

function withAdminContext() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    const user = { id: 'admin-1', role: 'admin' }
    c.set('principal', {
      session: { session: { id: 'session-1' }, user },
      user,
    })
    c.set('deps', createTestDeps())
    await next()
  })
  return app
}

function withApplicationContext(canonicalOrigin?: string) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('principal', {
      session: null,
      user: { id: 'user-1' },
      agent: null,
      application: {
        id: 'application-1',
        clientId: 'ama',
        ownerOrganizationId: 'org-1',
        scopes: ['agents:write'],
      },
    })
    c.set('deps', createTestDeps())
    if (canonicalOrigin) c.set('realmrootCanonicalOrigin', canonicalOrigin)
    await next()
  })
  return app
}
