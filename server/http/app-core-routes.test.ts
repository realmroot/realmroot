import { createApp } from '@server/http/app'
import { realmrootAgentBindingClaim } from '@shared/oauth-token-profile'
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from './test-deps'

describe('app.test 1', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves health status [spec: platform-onboarding/api-health-smoke]', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, createTestDeps()).request('/api/health')

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'realmroot',
    })
  })

  it('serves OAuth authorization server metadata at the issuer-path well-known route', async () => {
    const getOAuthServerConfig = vi.fn().mockResolvedValue({
      issuer: 'https://auth.example.com/api/auth',
      authorization_endpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      device_authorization_endpoint: 'https://auth.example.com/api/auth/device/code',
      token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      response_types_supported: ['code'],
      grant_types_supported: [
        'authorization_code',
        'refresh_token',
        'client_credentials',
        'urn:ietf:params:oauth:grant-type:device_code',
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
      ],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    })
    const auth = {
      api: {
        getOAuthServerConfig,
        getOpenIdConfig: vi.fn(),
        getSession: vi.fn().mockResolvedValue(null),
      },
      handler: async () => new Response(null, { status: 204 }),
    }

    const response = await createApp(auth, createTestDeps()).request(
      '/.well-known/oauth-authorization-server/api/auth',
      { headers: { origin: 'https://wallet.example.com' } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://wallet.example.com')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      issuer: 'https://auth.example.com/api/auth',
      dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
      agent_profile_uri_template: 'https://auth.example.com/api/public/agents/{subject}',
      grant_types_supported: [
        'authorization_code',
        'refresh_token',
        'client_credentials',
        'urn:ietf:params:oauth:grant-type:device_code',
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
      ],
      code_challenge_methods_supported: ['S256'],
    })
    expect(getOAuthServerConfig).toHaveBeenCalledWith({
      request: expect.any(Request),
      asResponse: false,
    })
  })

  it('keeps provider introspection in Better Auth and rejects ambiguous custom-token client authentication', async () => {
    const auth = createAuthMock()
    auth.handler.mockResolvedValue(Response.json({ active: true, source: 'provider' }))
    const app = createApp(auth, createTestDeps())

    const providerResponse = await app.request('/api/auth/oauth2/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'provider-token' }),
    })
    expect(providerResponse.status).toBe(200)
    await expect(providerResponse.json()).resolves.toEqual({ active: true, source: 'provider' })
    expect(auth.handler).toHaveBeenCalledOnce()

    const customResponse = await app.request('/api/auth/oauth2/introspect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer malformed-client-auth',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: 'fatx_unknown',
        client_id: 'client-1',
        client_secret: 'secret-1',
      }),
    })
    expect(customResponse.status).toBe(401)
    await expect(customResponse.json()).resolves.toEqual({
      error: 'invalid_client',
      error_description: 'Client authentication is required.',
    })
    expect(auth.handler).toHaveBeenCalledOnce()
  })

  it('authenticates an ID-token exchange client before verifying its subject token', async () => {
    const auth = createAuthMock()
    const verifyJWT = vi.fn().mockRejectedValue(new Error('subject token must not be inspected'))
    Object.assign(auth.api, { verifyJWT })
    const deps = createTestDeps()

    const response = await createApp(auth, deps).request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa('unknown-client:wrong-secret')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'malformed-subject-token',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        audience: 'oidc-client',
        scope: 'openid groups',
      }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_client' })
    expect(verifyJWT).not.toHaveBeenCalled()
    expect(deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'oauth.agent_identity_token_exchanged',
        result: 'denied',
        realmOwned: true,
        reasonCode: 'invalid_client',
      }),
    )
  })

  it('rejects Agent token exchange until explicit enrollment creates a binding [spec: agent-identity/agent-whoami-requires-enrollment]', async () => {
    const auth = createAuthMock()
    auth.api.getAgentSession.mockResolvedValue({
      agentId: 'protocol-agent-1',
      agent: { id: 'protocol-agent-1', hostId: 'host-1', mode: 'delegated', capabilityGrants: [] },
      host: { id: 'host-1', userId: 'controller-1', status: 'active' },
    })
    const baseDeps = createTestDeps()
    const deps = createTestDeps({
      authorization: {
        ...baseDeps.authorization,
        createResource: vi.fn().mockResolvedValue({}),
      },
    })
    const assertionKey = await generateKeyPair('ES256')
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', typ: 'agent+jwt' })
      .sign(assertionKey.privateKey)
    const response = await createApp(auth, deps, { baseURL: 'https://auth.example.com' }).request(
      'https://auth.example.com/api/auth/oauth2/token',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          DPoP: 'proof-is-not-reached-before-enrollment-validation',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          client_id: 'realmroot-cli',
          assertion,
          resource: 'https://auth.example.com/api',
          scope: 'agent:read',
        }),
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      error_description: 'The Agent is not enrolled.',
    })
    expect(deps.agentIdentities.findProtocolAgent).not.toHaveBeenCalled()
  })

  it('rejects runtime session context bound to another protocol Agent', async () => {
    const auth = createAuthMock()
    auth.api.getAgentSession.mockResolvedValue({
      agentId: 'protocol-agent-1',
      agent: { id: 'protocol-agent-1', hostId: 'host-1', mode: 'delegated', capabilityGrants: [] },
      host: { id: 'host-1', userId: 'controller-1', status: 'active' },
    })
    const assertionKey = await generateKeyPair('ES256')
    const assertion = await new SignJWT({
      [realmrootAgentBindingClaim]: {
        protocol_agent_id: 'protocol-agent-2',
        host_id: 'host-1',
        runtime: 'codex',
        session_id: 'thread-raw-123',
      },
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'agent+jwt' })
      .sign(assertionKey.privateKey)
    const deps = createTestDeps()

    const response = await createApp(auth, deps, { baseURL: 'https://auth.example.com' }).request(
      'https://auth.example.com/api/auth/oauth2/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          client_id: 'realmroot-cli',
          assertion,
          resource: 'https://auth.example.com/api',
          scope: 'agent:read',
        }),
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      error_description: 'The Agent assertion binding does not match its authenticated Agent and Host.',
    })
    expect(deps.agentIdentities.findActiveBindingByProtocolAgent).not.toHaveBeenCalled()
  })

  it('issues and verifies an Agent bootstrap JWT through the OAuth HTTP boundary', async () => {
    const issuer = 'https://auth.example.com/api/auth'
    const endpoint = `${issuer}/oauth2/token`
    const auth = createAuthMock()
    auth.api.getAgentSession.mockResolvedValue({
      agentId: 'protocol-agent-1',
      agent: { id: 'protocol-agent-1', hostId: 'host-1', mode: 'delegated', capabilityGrants: [] },
      host: { id: 'host-1', userId: 'controller-1', status: 'active' },
    })
    const signingKey = await generateKeyPair('ES256', { extractable: true })
    auth.api.signJWT.mockImplementation(async ({ body }) => ({
      token: await new SignJWT(body.payload)
        .setProtectedHeader({ alg: 'ES256', kid: 'issuer-key', typ: body.overrideOptions.jwt.type })
        .sign(signingKey.privateKey),
    }))
    const now = new Date('2026-08-18T00:00:00.000Z')
    const identity = {
      id: 'identity-1',
      issuer,
      subject: 'agt_1',
      username: 'agent',
      name: 'Agent',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      status: 'active' as const,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const binding = {
      id: 'binding-1',
      agentIdentityId: identity.id,
      protocolAgentId: 'protocol-agent-1',
      hostId: 'host-1',
      status: 'active',
      boundAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findActiveBindingByProtocolAgent).mockResolvedValue({ identity, binding })
    const dpopKey = await generateKeyPair('ES256', { extractable: true })
    const proof = await new SignJWT({ htm: 'POST', htu: endpoint })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: await exportJWK(dpopKey.publicKey) })
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .sign(dpopKey.privateKey)
    const assertion = await new SignJWT({
      [realmrootAgentBindingClaim]: {
        protocol_agent_id: 'protocol-agent-1',
        host_id: 'host-1',
        runtime: 'codex',
        session_id: 'thread-raw-123',
      },
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'agent+jwt' })
      .sign(signingKey.privateKey)

    const response = await createApp(auth, deps, { baseURL: 'https://auth.example.com' }).request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', DPoP: proof },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        client_id: 'realmroot-cli',
        assertion,
        resource: 'https://auth.example.com/api',
        scope: 'agent:read',
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json<{ access_token: string; token_type: string; scope: string }>()
    expect(body).toMatchObject({ token_type: 'DPoP', scope: 'agent:read' })
    const verified = await jwtVerify(body.access_token, signingKey.publicKey, {
      issuer,
      audience: 'https://auth.example.com/api',
      typ: 'at+jwt',
    })
    expect(verified.protectedHeader).toMatchObject({ alg: 'ES256', kid: 'issuer-key', typ: 'at+jwt' })
    expect(verified.payload).toMatchObject({
      sub: 'agt_1',
      client_id: 'realmroot-cli',
      scope: 'agent:read',
      cnf: { jkt: expect.any(String) },
      [realmrootAgentBindingClaim]: {
        protocol_agent_id: 'protocol-agent-1',
        host_id: 'host-1',
        runtime: 'codex',
        session_id: 'thread-raw-123',
      },
    })
    expect(verified.payload).not.toHaveProperty('act')
    expect(auth.api.getAgentSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      asResponse: false,
    })
    expect(auth.api.signJWT).toHaveBeenCalledOnce()
  })

  it('serves OpenID metadata at the issuer-path well-known route', async () => {
    const getOpenIdConfig = vi.fn().mockResolvedValue({
      issuer: 'https://auth.example.com/api/auth',
      authorization_endpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      userinfo_endpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
      end_session_endpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
      response_types_supported: ['code'],
      scopes_supported: ['openid', 'profile', 'email'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['EdDSA'],
    })
    const auth = {
      api: {
        getOAuthServerConfig: vi.fn(),
        getOpenIdConfig,
        getSession: vi.fn().mockResolvedValue(null),
      },
      handler: async () => new Response(null, { status: 204 }),
    }

    const response = await createApp(auth, createTestDeps()).request('/.well-known/openid-configuration/api/auth', {
      headers: { origin: 'https://wallet.example.com' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://wallet.example.com')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    const metadata = await response.json()
    expect(metadata).toMatchObject({
      issuer: 'https://auth.example.com/api/auth',
      userinfo_endpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
      end_session_endpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
    })
    expect(metadata).not.toHaveProperty('agent_profile_uri_template')
    expect(getOpenIdConfig).toHaveBeenCalledWith({
      request: expect.any(Request),
      asResponse: false,
    })
  })

  it('answers issuer-path OAuth metadata preflights from any browser origin', async () => {
    const app = createApp(createAuthMock(), createTestDeps())

    for (const path of [
      '/.well-known/openid-configuration/api/auth',
      '/.well-known/oauth-authorization-server/api/auth',
    ]) {
      const response = await app.request(path, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://wallet.example.com',
          'access-control-request-method': 'GET',
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://wallet.example.com')
      expect(response.headers.get('access-control-allow-methods')).toBe('GET,OPTIONS')
      expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    }
  })

  it('publishes one canonical Agent and OAuth issuer on the requested host', async () => {
    const getAgentConfiguration = vi.fn().mockResolvedValue({
      issuer: 'https://auth.example.com',
      default_location: 'https://auth.example.com/capability/execute',
      modes: ['delegated'],
      approval_methods: ['device_authorization'],
      endpoints: {
        register: 'https://auth.example.com/agent/register',
        execute: 'https://auth.example.com/capability/execute',
        status: 'https://auth.example.com/api/auth/agent/status',
      },
      agent_identity_issuer: 'https://tenant.example.net/api/auth',
      agent_token_endpoint: 'https://tenant.example.net/api/auth/oauth2/token',
      agent_jwks_uri: 'https://tenant.example.net/api/auth/jwks',
    })
    const auth = {
      api: {
        getOAuthServerConfig: vi.fn(),
        getOpenIdConfig: vi.fn(),
        getAgentConfiguration,
        getSession: vi.fn().mockResolvedValue(null),
      },
      handler: async () => new Response(null, { status: 204 }),
    }

    const response = await createApp(auth, createTestDeps()).request(
      'https://tenant.example.net/.well-known/agent-configuration',
    )

    expect(response.status).toBe(200)
    const metadata = await response.json()
    expect(metadata).toMatchObject({
      issuer: 'https://tenant.example.net/api/auth',
      agent_identity_issuer: 'https://tenant.example.net/api/auth',
      agent_endpoint: 'https://tenant.example.net/api/agent',
      agent_enrollment_endpoint: 'https://tenant.example.net/api/agent/enrollments',
      agent_profile_uri_template: 'https://tenant.example.net/api/public/agents/{subject}',
      modes: ['delegated'],
      approval_methods: ['device_authorization'],
      endpoints: {
        register: 'https://tenant.example.net/api/auth/agent/register',
        status: 'https://tenant.example.net/api/auth/agent/status',
      },
    })
    expect(getAgentConfiguration).toHaveBeenCalledWith({
      request: expect.any(Request),
      asResponse: false,
    })
  })

  it('serves a cacheable public Agent summary [spec: agent-identity/public-agent-profile]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findByIssuerSubject).mockResolvedValue({
      id: 'identity-1',
      issuer: 'https://auth.example.com/api/auth',
      subject: 'agt_stable',
      username: 'build-agent.00000000000000000000000000000004',
      name: 'Build Agent',
      runtime: 'codex',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      status: 'inactive',
      deletedAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    })
    const app = createApp(createAuthMock(), deps, { baseURL: 'https://auth.example.com' })
    const response = await app.request('https://preview.example.net/api/public/agents/agt_stable', {
      headers: { origin: 'https://resource.example.com' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://resource.example.com')
    expect(response.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300')
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/)
    await expect(response.json()).resolves.toEqual({
      type: 'agent',
      view: 'summary',
      issuer: 'https://auth.example.com/api/auth',
      subject: 'agt_stable',
      username: 'build-agent.00000000000000000000000000000004',
      name: 'Build Agent',
      runtime: 'codex',
      picture: 'https://auth.example.com/agent-picture-v1.svg',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    })
    expect(deps.agentIdentities.findByIssuerSubject).toHaveBeenCalledWith(
      'https://auth.example.com/api/auth',
      'agt_stable',
    )

    const cached = await app.request('https://preview.example.net/api/public/agents/agt_stable', {
      headers: { 'if-none-match': response.headers.get('etag')! },
    })
    expect(cached.status).toBe(304)
    expect(await cached.text()).toBe('')
  })

  it('does not publish a second root OpenID issuer [spec: agent-identity/agent-stable-issuer]', async () => {
    const response = await createApp(createAuthMock(), createTestDeps(), {
      baseURL: 'https://auth.example.com',
    }).request('/.well-known/openid-configuration')

    expect(response.status).toBe(404)
  })

  it('returns not found when AgentAuth discovery is not installed', async () => {
    const auth = {
      api: {
        getOAuthServerConfig: vi.fn(),
        getOpenIdConfig: vi.fn(),
        getSession: vi.fn().mockResolvedValue(null),
      },
      handler: async () => new Response(null, { status: 204 }),
    }
    const response = await createApp(auth, createTestDeps()).request('/.well-known/agent-configuration', {
      headers: { 'cf-ray': 'request-1' },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'not_found',
        message: 'Agent configuration is not available.',
        requestId: 'request-1',
      },
    })
  })

  it('returns consistent JSON errors from the boundary', async () => {
    const response = await createApp(createAuthMock(), createTestDeps()).request('/api/missing', {
      headers: {
        'cf-ray': 'request-1',
      },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_found',
        message: 'Resource not found.',
        requestId: 'request-1',
      },
    })
  })

  it('rejects untrusted API origins before handlers run', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, createTestDeps(), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/health', {
      headers: {
        origin: 'https://evil.example.com',
      },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Origin is not trusted for this issuer.',
      },
    })
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('allows cross-site identity-provider callbacks without granting CORS access', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, createTestDeps(), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/auth/callback/apple', {
      method: 'POST',
      headers: {
        origin: 'https://appleid.apple.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ code: 'provider-code', state: 'provider-state' }),
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(auth.handler).toHaveBeenCalledOnce()

    const unrelatedResponse = await createApp(auth, createTestDeps(), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/auth/callback/apple/unrelated', {
      method: 'POST',
      headers: { origin: 'https://appleid.apple.com' },
    })

    expect(unrelatedResponse.status).toBe(403)
    expect(auth.handler).toHaveBeenCalledOnce()
  })

  it('allows trusted API origins and emits CORS response headers', async () => {
    const response = await createApp(createAuthMock(), createTestDeps(), {
      trustedOrigins: ['https://tenant.example.com'],
    }).request('/api/health', {
      headers: {
        origin: 'https://tenant.example.com',
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://tenant.example.com')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })
})

function createAuthMock() {
  return {
    api: {
      getOAuthServerConfig: vi.fn(),
      getOpenIdConfig: vi.fn(),
      getAgentConfiguration: vi.fn(),
      getAgentSession: vi.fn().mockResolvedValue(null),
      signJWT: vi.fn().mockResolvedValue({ token: 'signed-token' }),
      getSession: vi.fn().mockImplementation(({ headers }: { headers: Headers }) => {
        const id = headers.get('x-user-id')
        if (!id) return null

        return {
          session: { id: 'session-1' },
          user: {
            id,
            email: `${id}@example.com`,
            role: headers.get('x-user-role'),
          },
        }
      }),
    },
    handler: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  }
}

function _createConfigzServiceMock(overrides: Record<string, unknown> = {}) {
  return {
    getConfig: vi.fn().mockResolvedValue({
      signIn: {
        passwordEnabled: true,
        signupEnabled: true,
        socialLoginEnabled: true,
        emailOtpEnabled: true,
        usernameEnabled: true,
        identifierFirst: false,
      },
      builtInProviders: {
        email: { enabled: true },
        phone: { enabled: false },
        web3Wallet: { enabled: true, chains: [1], allowSignUp: true },
        passkey: { allowSignUp: true },
        oneTap: {
          enabled: false,
          clientId: '',
          autoSelect: false,
          cancelOnTapOutside: true,
          uxMode: 'popup',
          context: 'signin',
          promptBaseDelayMs: 1000,
          promptMaxAttempts: 5,
        },
      },
      accountCenter: {
        profileEditingEnabled: true,
        displayNameEditable: true,
        usernameEditable: true,
        avatarEditable: true,
        emailChangeEnabled: true,
        passwordChangeEnabled: true,
        connectedAccountsEnabled: true,
        sessionsViewEnabled: true,
        dangerZoneEnabled: false,
      },
      ...overrides,
    }),
  }
}

function _applicationCorsFactory(origins: string[]) {
  return () => ({
    list: vi.fn().mockResolvedValue({
      applications: [
        applicationResponse({ corsOrigins: origins }),
        applicationResponse({ disabled: true, corsOrigins: ['https://disabled.example.com'] }),
      ],
      pagination: { limit: 100, offset: 0, total: 2, hasMore: false, nextOffset: null },
    }),
    revokeConsent: vi.fn(),
  })
}

function applicationResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    slug: 'customer-portal',
    name: 'Customer Portal',
    description: null,
    homepageUrl: 'https://app.example.com',
    iconUrl: null,
    clientId: 'client-1',
    clientType: 'public_spa',
    public: true,
    firstParty: false,
    trusted: false,
    disabled: false,
    disabledReason: null,
    redirectUris: ['https://app.example.com/callback'],
    postLogoutRedirectUris: [],
    corsOrigins: [],
    customData: {},
    allowedGrantTypes: ['authorization_code'],
    oidcScopes: ['openid'],
    requirePkce: true,
    tokenEndpointAuthMethod: 'none',
    secretMetadata: [],
    oidc: {
      issuer: 'https://auth.example.com/api/auth',
      authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwksUri: 'https://auth.example.com/api/auth/jwks',
      userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
      endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function _createWalletRepositoryMock({ linked }: { linked: boolean }) {
  const wallet = linked
    ? {
        id: 'wallet-1',
        userId: 'user-1',
        address: '0x0000000000000000000000000000000000000001',
        chainId: 1,
        isPrimary: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }
    : null
  return {
    findWalletAddress: vi.fn().mockResolvedValue(wallet),
    findAnyWalletAddress: vi.fn().mockResolvedValue(wallet),
    getSiweNonce: vi.fn().mockResolvedValue(null),
    deleteSiweNonce: vi.fn().mockResolvedValue(undefined),
    linkWalletAddress: vi.fn().mockResolvedValue(wallet),
    unlinkWalletAddress: vi.fn().mockResolvedValue(undefined),
  }
}

function _createAssetServiceMock() {
  return {
    upload: vi.fn().mockResolvedValue({
      asset: {
        id: 'asset-1',
        purpose: 'avatar',
        publicUrl: 'https://auth.example.com/api/assets/asset-1',
        contentType: 'image/png',
        byteSize: 6,
        checksumSha256: 'checksum-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }),
    updateUserAvatar: vi.fn().mockResolvedValue(undefined),
  }
}

function _createUserRepositoryMock() {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    listManagedUsers: vi.fn().mockResolvedValue(createPage()),
    createManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    updateManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    suspendManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    restoreManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    deleteManagedUser: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue({ id: 'user-1' }),
    assertAccountAvatarReference: vi.fn().mockResolvedValue(undefined),
    assertAdminAvatarReference: vi.fn().mockResolvedValue(undefined),
    listLinkedAccounts: vi.fn().mockResolvedValue(createPage()),
    listSessions: vi.fn().mockResolvedValue(createPage()),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
    deleteSessions: vi.fn().mockResolvedValue([]),
  }
}

function _createSecurityRepositoryMock() {
  return {
    getPolicy: vi.fn().mockResolvedValue(securityPolicy()),
    updatePolicy: vi.fn().mockResolvedValue(securityPolicy()),
    getSecurityState: vi.fn().mockResolvedValue({
      userId: 'user-1',
      mfa: { enabled: true, factors: [{ id: 'factor-1', type: 'totp', verified: true }] },
      passkeys: { enabled: true, count: 1 },
      policy: securityPolicy(),
    }),
    listPasskeys: vi.fn().mockResolvedValue(createPage()),
    deletePasskey: vi.fn().mockResolvedValue(undefined),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
  }
}

function securityPolicy() {
  return {
    mfa: { mode: 'optional' as const },
    passkeys: {
      enabled: true,
      rpId: 'auth.example.com',
      rpName: 'Realmroot',
      origins: ['https://auth.example.com'],
    },
    sessions: {
      expiresInSeconds: 60 * 60 * 24 * 7,
      updateAgeSeconds: 60 * 60 * 24,
      freshAgeSeconds: 60 * 60 * 24,
      cookieCacheSeconds: 60 * 5,
    },
    password: {
      minLength: 8,
      requiredCharacterTypes: 1,
      customWords: [],
      rejectUserInfo: false,
      rejectSequential: false,
      rejectCustomWords: false,
    },
    captcha: { enabled: false, provider: 'turnstile' as const, siteKey: '', projectId: null, secretKey: '' },
    blocklist: { blockSubaddressing: false, entries: [] },
  }
}

function createPage() {
  return {
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  }
}

function _requestWithFile(app: ReturnType<typeof createApp>) {
  const request = new Request('https://auth.example.com/api/account/avatar', {
    method: 'POST',
    headers: { 'x-user-id': 'user-1', 'x-user-role': 'user' },
  })
  Object.defineProperty(request, 'formData', {
    value: async () => ({
      get: (key: string) =>
        key === 'file'
          ? {
              name: 'avatar.png',
              type: 'image/png',
              size: 6,
              arrayBuffer: async () => new TextEncoder().encode('avatar').buffer,
            }
          : null,
    }),
  })
  return app.fetch(request)
}
