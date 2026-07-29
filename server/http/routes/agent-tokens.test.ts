import { handleApiError } from '@server/http/errors'
import { depsMiddleware } from '@server/http/middleware/deps'
import { createAgentTokenRoutes } from '@server/http/routes/agent-tokens'
import * as agentIdentities from '@server/usecases/agent-identities'
import * as agentTokens from '@server/usecases/agent-tokens'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

describe('Agent token routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires an active Agent protocol session', async () => {
    const app = createRouteApp({ getAgentSession: vi.fn().mockResolvedValue(null) })

    const response = await app.request('/api/agent/oauth2/token', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ grantId: 'grant-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized', message: 'An active Agent protocol session is required.' },
    })
  })

  it('preserves Better Auth Agent authentication errors at the HTTP boundary', async () => {
    const app = createRouteApp({
      getAgentSession: vi.fn().mockRejectedValue({
        statusCode: 401,
        message: 'JWT is invalid.',
        body: { message: 'JWT is invalid.' },
      }),
    })

    const response = await app.request('/api/agent/oauth2/token', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ grantId: 'grant-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized', message: 'JWT is invalid.' },
    })
  })

  it('validates the token request before invoking the usecase', async () => {
    const issue = vi.spyOn(agentTokens, 'issueAgentAccessToken')
    const app = createRouteApp({ getAgentSession: vi.fn().mockResolvedValue(session()) })

    const response = await app.request('/api/agent/oauth2/token', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ scope: 'repo:read' }),
    })

    expect(response.status).toBe(400)
    expect(issue).not.toHaveBeenCalled()
  })

  it('passes the authenticated Agent session and DPoP request to token issuance', async () => {
    const issue = vi.spyOn(agentTokens, 'issueAgentAccessToken').mockResolvedValue({
      access_token: 'faat_token',
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'DPoP',
      expires_in: 300,
      scope: 'repo:read',
    })
    const getAgentSession = vi.fn().mockResolvedValue(session())
    const app = createRouteApp({ getAgentSession })

    const response = await app.request('/api/agent/oauth2/token', {
      method: 'POST',
      headers: { ...jsonHeaders(), dpop: 'proof' },
      body: JSON.stringify({ grantId: 'grant-1', scope: 'repo:read' }),
    })

    expect(response.status).toBe(200)
    expect(getAgentSession).toHaveBeenCalledWith({ headers: expect.any(Headers), asResponse: false })
    expect(issue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'POST' }),
      { grantId: 'grant-1', scope: 'repo:read' },
      session(),
    )
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
      issuer: 'https://auth.example.com',
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
      identity: { id: 'identity-1', issuer: 'https://auth.example.com', subject: 'agt_1' },
    })
  })

  it('creates the stable identity after the single controller login approval [spec: agent-identity/agent-identity-enrollment]', async () => {
    const createIdentity = vi.spyOn(agentIdentities, 'createAgentLoginIdentity').mockResolvedValue({
      id: 'identity-1',
      issuer: 'https://agents.example.com',
      subject: 'agt_1',
      name: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'active',
      retiredAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      bindings: [],
    })
    const app = createRouteApp({ getAgentSession: vi.fn().mockResolvedValue(session()) }, 'https://agents.example.com')

    const response = await app.request('/api/agent/identity', {
      method: 'POST',
      headers: { authorization: 'Bearer agent-jwt', ...jsonHeaders() },
      body: JSON.stringify({ name: 'Build Agent' }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      identity: { issuer: 'https://agents.example.com', subject: 'agt_1', name: 'Build Agent' },
    })
    expect(createIdentity).toHaveBeenCalledWith(
      expect.anything(),
      { protocolAgentId: 'protocol-agent-1', name: 'Build Agent' },
      'https://agents.example.com',
      'user-1',
    )
  })
})

function createRouteApp(
  authApi: {
    getAgentSession: (context: { headers: Headers; asResponse: false }) => Promise<ReturnType<typeof session> | null>
  },
  agentIdentityIssuer?: string,
) {
  return new Hono()
    .use('*', depsMiddleware(createTestDeps()))
    .onError((error, c) => handleApiError(error, c))
    .route('/api/agent', createAgentTokenRoutes(authApi, agentIdentityIssuer))
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
