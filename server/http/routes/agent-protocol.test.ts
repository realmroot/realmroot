import { handleApiError } from '@server/http/errors'
import { depsMiddleware } from '@server/http/middleware/deps'
import { createAgentProtocolRoutes } from '@server/http/routes/agent-protocol'
import * as agentIdentities from '@server/usecases/agent-identities'
import * as externalResources from '@server/usecases/external-resources'
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

  it('does not expose enrollment intents as public protocol resources [spec: agent-identity/agent-public-resource-model]', async () => {
    const app = createRouteApp({ getAgentSession: vi.fn().mockResolvedValue(session()) })

    const response = await app.request('https://auth.example.com/api/agent/enrollment-intents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Build Agent' }),
    })

    expect(response.status).toBe(404)
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

    const response = await app.request('/api/agent', { headers: { authorization: 'Bearer agent-jwt' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      agent: { id: 'identity-1', issuer: 'https://auth.example.com/api/auth', subject: 'agt_1' },
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

    const response = await app.request('/api/agent/enrollments', {
      method: 'POST',
      headers: { authorization: 'Bearer agent-jwt', ...jsonHeaders() },
      body: JSON.stringify({ name: 'Build Agent' }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      agent: { issuer: 'https://auth.example.com/api/auth', subject: 'agt_1', name: 'Build Agent' },
    })
    expect(createIdentity).toHaveBeenCalledWith(
      expect.anything(),
      { protocolAgentId: 'protocol-agent-1', name: 'Build Agent' },
      'https://auth.example.com/api/auth',
      'user-1',
    )
  })

  it('creates and exposes an additional-host enrollment [spec: agent-identity/agent-multi-host-continuity]', async () => {
    const now = new Date('2026-08-01T00:00:00.000Z')
    const intent = {
      id: 'enrollment-1',
      agentIdentityId: 'identity-1',
      requestedName: null,
      homeSpace: { type: 'personal' as const, userId: 'user-1' },
      protocolAgentId: 'protocol-agent-1',
      status: 'pending' as const,
      expiresAt: new Date('2026-08-01T00:10:00.000Z'),
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const enrollment = {
      id: 'enrollment-1',
      agentId: 'identity-1',
      name: 'Build Agent',
      kind: 'additional_host' as const,
      homeSpace: { type: 'personal' as const, userId: 'user-1' },
      status: 'pending' as const,
      expiresAt: '2026-08-01T00:10:00.000Z',
      decidedAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }
    const createEnrollment = vi
      .spyOn(agentIdentities, 'createAdditionalAgentEnrollmentIntent')
      .mockResolvedValue({ intent, replayed: false })
    vi.spyOn(agentIdentities, 'getPublicAgentEnrollment').mockResolvedValue(enrollment)
    const readEnrollment = vi.spyOn(agentIdentities, 'getProtocolAgentEnrollment').mockResolvedValue(enrollment)
    const app = createRouteApp(
      { getAgentSession: vi.fn().mockResolvedValue(session()) },
      'https://auth.example.com/api/auth',
    )

    const createResponse = await app.request('https://preview.example.net/api/agent/installation-enrollments', {
      method: 'POST',
      headers: { authorization: 'Bearer agent-jwt', 'idempotency-key': 'enrollment-key-1', ...jsonHeaders() },
      body: JSON.stringify({ agentId: 'identity-1' }),
    })

    expect(createResponse.status).toBe(201)
    expect(createResponse.headers.get('location')).toBe('/api/agent/installation-enrollments/enrollment-1')
    await expect(createResponse.json()).resolves.toEqual({
      enrollment,
      verificationUri: 'https://auth.example.com/agent/enrollments/approve?intent_id=enrollment-1',
    })
    expect(createEnrollment).toHaveBeenCalledWith(
      expect.anything(),
      'identity-1',
      'protocol-agent-1',
      'user-1',
      'enrollment-key-1',
    )

    const missingKeyResponse = await app.request('/api/agent/installation-enrollments', {
      method: 'POST',
      headers: { authorization: 'Bearer agent-jwt', ...jsonHeaders() },
      body: JSON.stringify({ agentId: 'identity-1' }),
    })
    expect(missingKeyResponse.status).toBe(400)

    const readResponse = await app.request('/api/agent/installation-enrollments/enrollment-1', {
      headers: { authorization: 'Bearer agent-jwt' },
    })
    expect(readResponse.status).toBe(200)
    await expect(readResponse.json()).resolves.toEqual(enrollment)
    expect(readEnrollment).toHaveBeenCalledWith(expect.anything(), 'enrollment-1', 'protocol-agent-1')
  })

  it('uses the configured origin for hosted resource approval [spec: agent-identity/agent-stable-issuer]', async () => {
    const now = new Date('2026-08-01T00:00:00.000Z')
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue({
      id: 'identity-1',
      issuer: 'https://auth.example.com/api/auth',
      subject: 'agt_1',
      name: 'Build Agent',
      homeSpace: { type: 'personal', userId: 'user-1' },
      status: 'active',
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
      bindings: [
        {
          id: 'binding-1',
          protocolAgentId: 'protocol-agent-1',
          hostId: 'host-1',
          status: 'active',
          boundAt: now,
          revokedAt: null,
        },
      ],
    })
    const createAccessRequest = vi.spyOn(externalResources, 'createAccessRequest').mockResolvedValue({
      id: 'request-1',
      agentId: 'identity-1',
      target: {
        type: 'api-resource',
        apiResourceId: 'resource-1',
        accountConnectionId: 'connection-1',
      },
      scopes: ['projects:read'],
      authorizationDetails: [],
      reason: 'Read projects',
      status: 'pending',
      approval: {
        url: 'https://auth.example.com/agent/resource-access/approve#token=approval-token',
        expiresAt: new Date(now.getTime() + 600_000).toISOString(),
      },
      grantId: null,
      expiresAt: new Date(now.getTime() + 600_000).toISOString(),
      decidedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    const app = createRouteApp(
      { getAgentSession: vi.fn().mockResolvedValue(session()) },
      'https://auth.example.com/api/auth',
    )

    const response = await app.request('https://preview.example.net/api/agent/access-requests', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        target: {
          type: 'api-resource',
          apiResourceId: 'resource-1',
          accountConnectionId: 'connection-1',
        },
        scopes: ['projects:read'],
        reason: 'Read projects',
      }),
    })

    expect(response.status).toBe(201)
    expect(createAccessRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'https://auth.example.com',
    )
  })

  it('accepts scopes and rejects the obsolete permissions field for resource access', async () => {
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue(activeIdentity())
    const createAccessRequest = vi.spyOn(externalResources, 'createAccessRequest')
    const app = createRouteApp(
      { getAgentSession: vi.fn().mockResolvedValue(session()) },
      'https://auth.example.com/api/auth',
    )

    const response = await app.request('https://auth.example.com/api/agent/access-requests', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        target: { type: 'api-resource', apiResourceId: 'resource-1' },
        permissions: ['projects:read'],
        reason: 'Read projects',
      }),
    })

    expect(response.status).toBe(400)
    expect(createAccessRequest).not.toHaveBeenCalled()
  })

  it('exposes authorization context discovery to the authenticated Agent [spec: agent-identity/external-resource-contextual-delegation]', async () => {
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue(activeIdentity())
    const listCatalog = vi.spyOn(externalResources, 'listAgentAuthorizationDetailCatalog').mockResolvedValue({
      items: [
        {
          authorizationDetail: { type: 'workspace', identifier: 'workspace-1' },
          display: { label: 'Workspace One' },
          connectionAuthorized: true,
          agentGrants: [],
        },
      ],
      pagination: { limit: 25, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })
    const app = createRouteApp({ getAgentSession: vi.fn().mockResolvedValue(session()) })

    const response = await app.request(
      'https://auth.example.com/api/agent/api-resources/resource-1/authorization-detail-catalog?limit=25',
      { headers: { authorization: 'Bearer agent-jwt' } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          authorizationDetail: { type: 'workspace', identifier: 'workspace-1' },
          connectionAuthorized: true,
        },
      ],
    })
    expect(listCatalog).toHaveBeenCalledWith(expect.anything(), 'resource-1', expect.anything(), {
      limit: 25,
      offset: 0,
    })
  })

  it('uses the unified grant token operation for native APIs [spec: agent-identity/native-api-resource-token]', async () => {
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue(activeIdentity())
    const issue = vi.spyOn(externalResources, 'issueTargetAccessToken').mockResolvedValue({
      accessToken: 'realmroot-access-token',
      tokenType: 'DPoP',
      expiresIn: 300,
      expiresAt: '2026-01-01T00:05:00.000Z',
      scopes: ['projects:read'],
      authorizationDetails: [],
      resourceUrl: 'https://projects.example.com/api',
    })
    const app = createRouteApp(
      {
        getAgentSession: vi.fn().mockResolvedValue(session()),
        signJWT: vi.fn().mockResolvedValue({ token: 'realmroot-access-token' }),
      },
      'https://auth.example.com/api/auth',
    )

    const response = await app.request('https://preview.example.net/api/agent/access-grants/grant-1/tokens', {
      method: 'POST',
      headers: { ...jsonHeaders(), DPoP: 'dpop-proof' },
    })

    expect(response.status).toBe(200)
    expect(issue).toHaveBeenCalledWith(
      expect.anything(),
      'grant-1',
      'dpop-proof',
      'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
      expect.objectContaining({ identityId: 'identity-1' }),
      expect.objectContaining({ issuer: 'https://auth.example.com/api/auth', sign: expect.any(Function) }),
    )
  })
})

function createRouteApp(
  authApi: {
    getAgentSession: (context: { headers: Headers; asResponse: false }) => Promise<ReturnType<typeof session> | null>
    signJWT?: (context: {
      body: { payload: Record<string, unknown>; overrideOptions?: { jwt?: { type?: string } } }
      asResponse: false
    }) => Promise<{ token: string }>
  },
  oidcIssuer?: string,
) {
  return new Hono()
    .use('*', depsMiddleware(createTestDeps()))
    .onError((error, c) => handleApiError(error, c))
    .route('/api/agent', createAgentProtocolRoutes(authApi, oidcIssuer))
}

function activeIdentity() {
  const now = new Date('2026-08-01T00:00:00.000Z')
  return {
    id: 'identity-1',
    issuer: 'https://auth.example.com/api/auth',
    subject: 'agt_1',
    name: 'Build Agent',
    homeSpace: { type: 'personal' as const, userId: 'user-1' },
    status: 'active' as const,
    retiredAt: null,
    createdAt: now,
    updatedAt: now,
    bindings: [
      {
        id: 'binding-1',
        protocolAgentId: 'protocol-agent-1',
        hostId: 'host-1',
        status: 'active' as const,
        boundAt: now,
        revokedAt: null,
      },
    ],
  }
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
