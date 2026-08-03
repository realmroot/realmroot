import { handleApiError } from '@server/http/errors'
import { depsMiddleware } from '@server/http/middleware/deps'
import { createAgentProtocolRoutes } from '@server/http/routes/agent-protocol'
import * as agentIdentities from '@server/usecases/agent-identities'
import * as externalResources from '@server/usecases/external-resources'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

const now = new Date('2026-08-01T00:00:00.000Z')
const expiresAt = '2026-08-01T00:10:00.000Z'
const resourceHref = 'https://auth.example.com/api/resource-servers/resource-1/resources/service'

describe('Agent protocol routes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('exposes the stable identity at its canonical resource path', async () => {
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue(activeIdentity())
    const response = await createRouteApp().request('/api/agent-identities/current', {
      headers: { authorization: 'Bearer agent-jwt' },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ agent: { id: 'identity-1', subject: 'agt_1' } })
  })

  it('creates and reads an additional-host enrollment at root-level resources', async () => {
    const intent = {
      id: 'enrollment-1',
      agentIdentityId: 'identity-1',
      requestedName: null,
      homeSpace: { type: 'personal' as const, userId: 'user-1' },
      protocolAgentId: 'protocol-agent-1',
      status: 'pending' as const,
      expiresAt: new Date(expiresAt),
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const enrollment = {
      id: intent.id,
      agentId: 'identity-1',
      name: 'Build Agent',
      kind: 'additional_host' as const,
      homeSpace: intent.homeSpace,
      status: intent.status,
      expiresAt,
      decidedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    vi.spyOn(agentIdentities, 'createAdditionalAgentEnrollmentIntent').mockResolvedValue({ intent, replayed: false })
    vi.spyOn(agentIdentities, 'getPublicAgentEnrollment').mockResolvedValue(enrollment)
    vi.spyOn(agentIdentities, 'getProtocolAgentEnrollment').mockResolvedValue(enrollment)
    const app = createRouteApp()

    const created = await app.request('/api/installation-enrollments', {
      method: 'POST',
      headers: { ...jsonHeaders(), 'idempotency-key': 'enrollment-key-1' },
      body: JSON.stringify({ agentId: 'identity-1' }),
    })
    expect(created.status).toBe(201)
    expect(created.headers.get('location')).toBe('https://auth.example.com/api/installation-enrollments/enrollment-1')
    expect((await app.request('/api/installation-enrollments/enrollment-1')).status).toBe(200)
  })

  it('lists Resource Servers and provider-owned Resources without exposing RFC 9396 details [spec: agent-identity/agent-resource-server-model]', async () => {
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue(activeIdentity())
    vi.spyOn(externalResources, 'listAgentResourceServers').mockResolvedValue({
      items: [
        {
          id: 'resource-1',
          identifier: 'zpan',
          name: 'ZPan',
          description: null,
          serviceUrl: 'https://drive.example.com/api',
          resourceIndicator: 'https://drive.example.com/api',
          availability: { status: 'available', checkedAt: now.toISOString() },
          scopes: [{ value: 'objects:read', description: 'Read objects' }],
          connection: { status: 'connected', displayName: 'Account', authorizedScopes: ['objects:read'] },
          links: {
            self: 'https://auth.example.com/api/resource-servers/resource-1',
            resources: 'https://auth.example.com/api/resource-servers/resource-1/resources',
            connectionRequests: 'https://auth.example.com/api/resource-servers/resource-1/connection-requests',
          },
        },
      ],
      pagination: page(1),
    })
    vi.spyOn(externalResources, 'listAgentResourceServerResources').mockResolvedValue({
      items: [
        {
          id: 'service',
          type: 'service',
          name: 'ZPan',
          description: null,
          metadata: {},
          accountAuthorization: { status: 'not_required' },
          agentAuthorization: { authorizedScopes: [], requestableScopes: ['objects:read'] },
          links: { self: resourceHref, accessRequests: 'https://auth.example.com/api/access-requests' },
        },
      ],
      pagination: page(1),
    })
    const app = createRouteApp()
    const servers = await app.request('/api/resource-servers')
    const resources = await app.request('/api/resource-servers/resource-1/resources')
    expect(servers.status).toBe(200)
    expect(resources.status).toBe(200)
    expect(JSON.stringify(await resources.json())).not.toContain('authorizationDetail')
  })

  it('creates a generic interactive connection request with canonical polling metadata', async () => {
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue(activeIdentity())
    const request = connectionRequest()
    vi.spyOn(externalResources, 'createAgentConnectionRequest').mockResolvedValue(request)
    const response = await createRouteApp().request('/api/resource-servers/resource-1/connection-requests', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ resources: [{ href: resourceHref }], scopes: ['objects:read'], reason: 'Use ZPan' }),
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBe(request.links.self)
    expect(response.headers.get('link')).toContain('interactive-resource')
    expect(response.headers.get('retry-after')).toBe('2')
  })

  it('dereferences Resource Server and Resource self links', async () => {
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue(activeIdentity())
    vi.spyOn(externalResources, 'getAgentResourceServer').mockResolvedValue({
      id: 'resource-1',
      identifier: 'zpan',
      name: 'ZPan',
      description: null,
      serviceUrl: 'https://drive.example.com/api',
      resourceIndicator: 'https://drive.example.com/api',
      availability: { status: 'available', checkedAt: now.toISOString() },
      scopes: [{ value: 'objects:read', description: 'Read objects' }],
      connection: { status: 'connected', displayName: 'Account', authorizedScopes: ['objects:read'] },
      links: {
        self: 'https://auth.example.com/api/resource-servers/resource-1',
        resources: 'https://auth.example.com/api/resource-servers/resource-1/resources',
        connectionRequests: 'https://auth.example.com/api/resource-servers/resource-1/connection-requests',
      },
    })
    vi.spyOn(externalResources, 'getAgentResourceServerResource').mockResolvedValue({
      id: 'service',
      type: 'service',
      name: 'ZPan',
      description: null,
      metadata: {},
      accountAuthorization: { status: 'not_required' },
      agentAuthorization: { authorizedScopes: [], requestableScopes: ['objects:read'] },
      links: { self: resourceHref, accessRequests: 'https://auth.example.com/api/access-requests' },
    })
    const app = createRouteApp()

    expect((await app.request('/api/resource-servers/resource-1')).status).toBe(200)
    expect((await app.request('/api/resource-servers/resource-1/resources/service')).status).toBe(200)
  })

  it('creates Resource access and exchanges its credential offer without exposing a grant', async () => {
    vi.spyOn(agentIdentities, 'getAgentIdentityByProtocolAgent').mockResolvedValue(activeIdentity())
    const request = accessRequest()
    vi.spyOn(externalResources, 'createAccessRequest').mockResolvedValue(request)
    const credential = {
      accessToken: 'secret',
      tokenType: 'DPoP' as const,
      expiresIn: 300,
      expiresAt,
      scopes: ['objects:read'],
      authorizationDetails: [],
      resourceIndicator: 'https://drive.example.com/api',
      resource: { href: resourceHref },
      resourceUrl: 'https://drive.example.com/api',
    }
    vi.spyOn(externalResources, 'createAccessRequestCredential').mockResolvedValue(credential)
    const app = createRouteApp({ signJWT: vi.fn().mockResolvedValue({ token: 'signed' }) })
    const created = await app.request('/api/access-requests', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ resource: { href: resourceHref }, scopes: ['objects:read'] }),
    })
    expect(created.status).toBe(201)
    expect(await created.clone().json()).not.toHaveProperty('grantId')
    const issued = await app.request('/api/access-requests/request-1/credentials', {
      method: 'POST',
      headers: { DPoP: 'proof' },
    })
    expect(issued.status).toBe(200)
    await expect(issued.json()).resolves.toEqual({
      accessToken: credential.accessToken,
      tokenType: credential.tokenType,
      expiresIn: credential.expiresIn,
      expiresAt: credential.expiresAt,
      scopes: credential.scopes,
      authorizationDetails: credential.authorizationDetails,
      resourceIndicator: credential.resourceIndicator,
      resource: credential.resource,
    })
  })

  it('does not expose the obsolete Agent API resource, activation, or grant routes', async () => {
    const app = createRouteApp()
    expect((await app.request('/api/agent/api-resources')).status).toBe(404)
    expect((await app.request('/api/access-requests/request-1/activation')).status).toBe(404)
    expect((await app.request('/api/agent/access-grants')).status).toBe(404)
  })
})

function createRouteApp(overrides: { signJWT?: () => Promise<{ token: string }> } = {}) {
  const authApi = {
    getAgentSession: vi.fn().mockResolvedValue(session()),
    ...overrides,
  }
  return new Hono()
    .use('*', depsMiddleware(createTestDeps()))
    .onError((error, c) => handleApiError(error, c))
    .route('/api', createAgentProtocolRoutes(authApi, 'https://auth.example.com/api/auth'))
}

function activeIdentity() {
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

function connectionRequest() {
  return {
    id: 'connection-request-1',
    agentId: 'identity-1',
    resourceServerId: 'resource-1',
    resources: [{ href: resourceHref }],
    scopes: ['objects:read'],
    reason: 'Use ZPan',
    status: 'pending' as const,
    interaction: {
      type: 'user-approval' as const,
      status: 'pending' as const,
      url: 'https://auth.example.com/agent/resource-connection/approve#token=opaque',
      expiresAt,
    },
    links: { self: 'https://auth.example.com/api/connection-requests/connection-request-1' },
    createdAt: now.toISOString(),
    expiresAt,
  }
}

function accessRequest() {
  return {
    id: 'request-1',
    agentId: 'identity-1',
    target: { type: 'resource' as const, resource: { href: resourceHref } },
    scopes: ['objects:read'],
    reason: null,
    status: 'approved' as const,
    interaction: { type: 'user-approval' as const, status: 'completed' as const, url: null, expiresAt: null },
    links: {
      self: 'https://auth.example.com/api/access-requests/request-1',
      credentials: 'https://auth.example.com/api/access-requests/request-1/credentials',
    },
    credentialOffer: {
      type: 'dpop' as const,
      resource: { href: resourceHref },
      resourceIndicator: 'https://drive.example.com/api',
      endpoint: 'https://auth.example.com/api/access-requests/request-1/credentials',
      proof: {
        algorithm: 'ES256' as const,
        method: 'POST' as const,
        uri: 'https://auth.example.com/api/access-requests/request-1/credentials',
      },
    },
    expiresAt,
    decidedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

function session() {
  return {
    agentId: 'protocol-agent-1',
    agent: { id: 'protocol-agent-1', hostId: 'host-1', mode: 'delegated', capabilityGrants: [] },
    host: { id: 'host-1', userId: 'user-1', status: 'active' },
  }
}

function jsonHeaders() {
  return { authorization: 'Bearer agent-jwt', 'content-type': 'application/json' }
}

function page(total: number) {
  return { limit: 20, offset: 0, total, hasMore: false, nextOffset: null }
}
