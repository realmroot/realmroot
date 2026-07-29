import { handleApiError } from '@server/http/errors'
import { depsMiddleware } from '@server/http/middleware/deps'
import { createAgentProtocolRoutes } from '@server/http/routes/agent-protocol'
import * as agentIdentities from '@server/usecases/agent-identities'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

describe('Agent protocol routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not publish a second Agent-only OAuth token endpoint [spec: agent-identity/agent-stable-issuer]', async () => {
    const app = createRouteApp({ getAgentSession: vi.fn().mockResolvedValue(null) })

    expect((await app.request('/api/agent/oauth2/token', { method: 'POST' })).status).toBe(404)
    expect((await app.request('/api/agent/jwks')).status).toBe(404)
  })

  it('lets an authenticated delegated Agent request stable identity enrollment [spec: agent-identity/agent-identity-enrollment]', async () => {
    const intent = {
      id: 'intent-1',
      agentIdentityId: null,
      requestedName: 'Build Agent',
      homeSpace: { type: 'personal' as const, userId: 'user-1' },
      protocolAgentId: 'protocol-agent-1',
      status: 'pending' as const,
      expiresAt: new Date('2026-08-01T00:10:00.000Z'),
      approvedAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    }
    const createIntent = vi.spyOn(agentIdentities, 'createAgentEnrollmentIntent').mockResolvedValue(intent)
    const app = createRouteApp({ getAgentSession: vi.fn().mockResolvedValue(session()) })

    const response = await app.request('https://auth.example.com/api/agent/enrollment-intents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Build Agent' }),
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      intent: { id: 'intent-1', protocolAgentId: 'protocol-agent-1' },
      verification_uri: 'https://auth.example.com/agent/identity/approve',
      verification_uri_complete: 'https://auth.example.com/agent/identity/approve?intent_id=intent-1',
    })
    expect(createIntent).toHaveBeenCalledWith(
      expect.anything(),
      { name: 'Build Agent', protocolAgentId: 'protocol-agent-1' },
      'user-1',
    )
  })

  it('returns the authenticated Agent stable identity [spec: agent-identity/agent-identity-enrollment]', async () => {
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue({
      id: 'identity-1',
      issuer: 'https://auth.example.com/api/auth',
      subject: 'agt_1',
      name: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'active',
      retiredAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      bindings: [
        {
          id: 'binding-1',
          protocolAgentId: 'protocol-agent-1',
          hostId: 'host-1',
          status: 'active',
          boundAt: new Date('2026-08-01T00:00:00.000Z'),
          revokedAt: null,
        },
      ],
    })
    const app = createRouteApp({ getAgentSession: vi.fn().mockResolvedValue(session()) })

    const response = await app.request('/api/agent/identity', { headers: { authorization: 'Bearer agent-jwt' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      identity: { id: 'identity-1', issuer: 'https://auth.example.com/api/auth', subject: 'agt_1' },
    })
  })

  it('creates the stable identity after the single controller login approval [spec: agent-identity/agent-identity-enrollment]', async () => {
    const createIdentity = vi.spyOn(agentIdentities, 'createAgentLoginIdentity').mockResolvedValue({
      id: 'identity-1',
      issuer: 'https://auth.example.com/api/auth',
      subject: 'agt_1',
      name: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'active',
      retiredAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      bindings: [],
    })
    const app = createRouteApp(
      { getAgentSession: vi.fn().mockResolvedValue(session()) },
      'https://auth.example.com/api/auth',
    )

    const response = await app.request('/api/agent/identity', {
      method: 'POST',
      headers: { authorization: 'Bearer agent-jwt', ...jsonHeaders() },
      body: JSON.stringify({ name: 'Build Agent' }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      identity: { issuer: 'https://auth.example.com/api/auth', subject: 'agt_1', name: 'Build Agent' },
    })
    expect(createIdentity).toHaveBeenCalledWith(
      expect.anything(),
      { protocolAgentId: 'protocol-agent-1', name: 'Build Agent' },
      'https://auth.example.com/api/auth',
      'user-1',
    )
  })
})

function createRouteApp(
  authApi: {
    getAgentSession: (context: { headers: Headers; asResponse: false }) => Promise<ReturnType<typeof session> | null>
  },
  oidcIssuer?: string,
) {
  return new Hono()
    .use('*', depsMiddleware(createTestDeps()))
    .onError((error, c) => handleApiError(error, c))
    .route('/api/agent', createAgentProtocolRoutes(authApi, oidcIssuer))
}

function session() {
  return {
    agentId: 'protocol-agent-1',
    agent: { id: 'protocol-agent-1', hostId: 'host-1', mode: 'delegated' },
    host: { id: 'host-1', userId: 'user-1', status: 'active' },
  }
}

function jsonHeaders() {
  return { 'content-type': 'application/json' }
}
