import { createTestDeps } from '@server/http/test-deps'
import { proxyAgentEgress as proxyAgentEgressVerified } from '@server/usecases/agent-egress'
import type { AgentAccessTokenVerifier } from '@server/usecases/agent-tokens'
import type {
  AgentAccessTokenRecord,
  AgentAuthorityGrantRecord,
  ConnectorRecord,
  ExternalAccountGrantRecord,
  ExternalAccountRecord,
  ExternalCredentialRecord,
} from '@server/usecases/ports'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const egressVerifiers = new WeakMap<object, AgentAccessTokenVerifier>()

function proxyAgentEgress(
  deps: Parameters<typeof proxyAgentEgressVerified>[0],
  request: Request,
  externalAccountId: string,
  rawRelativePath: string,
) {
  const verifier = egressVerifiers.get(deps)
  if (!verifier) throw new Error('Test Agent access token verifier is not configured.')
  return proxyAgentEgressVerified(deps, verifier, request, externalAccountId, rawRelativePath)
}

describe('Agent credential egress', () => {
  it(`injects a credential only after token, grant, method, path, and origin checks
      [spec: agent-identity/agent-egress-proxy]
      [spec: agent-identity/agent-audit-chain]`, async () => {
    const fixture = await egressFixture()
    const request = await fixture.request('GET', '/v1/repos?limit=1', 'allowed')

    const response = await proxyAgentEgress(fixture.deps, request, 'account-1', '/v1/repos')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('x-ratelimit-remaining')).toBe('9')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(fixture.externalFetch).toHaveBeenCalledOnce()
    const upstream = fixture.externalFetch.mock.calls[0]![0]
    expect(upstream.url).toBe('https://api.example.com/v1/repos?limit=1')
    expect(upstream.headers.get('x-api-key')).toBe('external-secret')
    expect(upstream.headers.get('authorization')).toBeNull()
    expect(upstream.headers.get('dpop')).toBeNull()
    expect(fixture.deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'external_account.egress',
        result: 'allowed',
        controllerUserId: 'user-1',
        subjectIssuer: 'https://auth.example.com/api/auth',
        subject: 'agent-subject',
        agentIdentityId: 'identity-1',
        hostId: 'host-1',
        authorityGrantId: 'authority-1',
        externalAccountId: 'account-1',
        externalAccountGrantId: 'external-grant-1',
        targetOrigin: 'https://api.example.com',
        targetPath: '/v1/repos',
        method: 'GET',
        metadata: { upstreamStatus: 200 },
      }),
    )
    expect(JSON.stringify(vi.mocked(fixture.deps.agentAudit.append).mock.calls)).not.toContain('external-secret')
  })

  it('rejects boundary escapes and never sends the credential [spec: agent-identity/agent-egress-boundaries]', async () => {
    const fixture = await egressFixture()
    await expect(
      proxyAgentEgress(fixture.deps, await fixture.request('POST', '/v1/repos', 'method'), 'account-1', '/v1/repos'),
    ).rejects.toMatchObject({ status: 403, message: 'HTTP method is outside the egress grant.' })
    await expect(
      proxyAgentEgress(fixture.deps, await fixture.request('GET', '/v1/admin', 'path'), 'account-1', '/v1/admin'),
    ).rejects.toMatchObject({ status: 403, message: 'HTTP path is outside the egress grant.' })
    await expect(
      proxyAgentEgress(
        fixture.deps,
        await fixture.request('GET', '/v1/repos', 'header', { 'x-api-key': 'override' }),
        'account-1',
        '/v1/repos',
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(fixture.externalFetch).not.toHaveBeenCalled()
    expect(vi.mocked(fixture.deps.agentAudit.append).mock.calls).toHaveLength(3)
    expect(vi.mocked(fixture.deps.agentAudit.append).mock.calls.every(([event]) => event.result === 'denied')).toBe(
      true,
    )
  })

  it('blocks egress immediately after grant or host revocation [spec: agent-identity/agent-egress-revocation]', async () => {
    const grantRevoked = await egressFixture()
    vi.mocked(grantRevoked.deps.externalAccounts.findActiveGrant).mockResolvedValue(null)
    await expect(
      proxyAgentEgress(
        grantRevoked.deps,
        await grantRevoked.request('GET', '/v1/repos', 'grant-revoked'),
        'account-1',
        '/v1/repos',
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(grantRevoked.externalFetch).not.toHaveBeenCalled()

    const hostRevoked = await egressFixture()
    vi.mocked(hostRevoked.deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue(null)
    await expect(
      proxyAgentEgress(
        hostRevoked.deps,
        await hostRevoked.request('GET', '/v1/repos', 'host-revoked'),
        'account-1',
        '/v1/repos',
      ),
    ).rejects.toMatchObject({ status: 401 })
    expect(hostRevoked.externalFetch).not.toHaveBeenCalled()
  })

  it('rejects unavailable account, credential, grant, Connector, audience, and scopes', async () => {
    for (const configure of [
      (fixture: Awaited<ReturnType<typeof egressFixture>>) =>
        vi.mocked(fixture.deps.externalAccounts.findAccount).mockResolvedValue(null),
      (fixture: Awaited<ReturnType<typeof egressFixture>>) =>
        vi
          .mocked(fixture.deps.externalAccounts.findAccount)
          .mockResolvedValue({ ...accountRecord(), status: 'revoked' }),
      (fixture: Awaited<ReturnType<typeof egressFixture>>) =>
        vi.mocked(fixture.deps.externalAccounts.findCredential).mockResolvedValue(null),
      (fixture: Awaited<ReturnType<typeof egressFixture>>) =>
        vi
          .mocked(fixture.deps.externalAccounts.findCredential)
          .mockResolvedValue({ ...credentialRecord(), status: 'revoked' }),
      (fixture: Awaited<ReturnType<typeof egressFixture>>) =>
        vi.mocked(fixture.deps.externalAccounts.findActiveGrant).mockResolvedValue(null),
    ]) {
      const fixture = await egressFixture()
      configure(fixture)
      await expect(
        proxyAgentEgress(
          fixture.deps,
          await fixture.request('GET', '/v1/repos', crypto.randomUUID()),
          'account-1',
          '/v1/repos',
        ),
      ).rejects.toMatchObject({ status: 403 })
    }

    const expired = await egressFixture()
    vi.mocked(expired.deps.externalAccounts.findActiveGrant).mockResolvedValue({
      ...externalGrantRecord(),
      expiresAt: new Date(Date.now() - 1),
    })
    await expect(
      proxyAgentEgress(expired.deps, await expired.request('GET', '/v1/repos', 'expired'), 'account-1', '/v1/repos'),
    ).rejects.toMatchObject({ status: 403 })

    for (const connector of [null, connectorRecord({ enabled: false }), connectorRecord({ apiBaseUrl: null })]) {
      const fixture = await egressFixture()
      vi.mocked(fixture.deps.connectors.findById).mockResolvedValue(connector)
      await expect(
        proxyAgentEgress(
          fixture.deps,
          await fixture.request('GET', '/v1/repos', crypto.randomUUID()),
          'account-1',
          '/v1/repos',
        ),
      ).rejects.toMatchObject({ status: 403 })
    }

    const audience = await egressFixture()
    vi.mocked(audience.deps.agentTokens.findAccessTokenByHash).mockResolvedValue({
      ...audience.token,
      audience: 'https://other.example.com',
    })
    await expect(
      proxyAgentEgress(audience.deps, await audience.request('GET', '/v1/repos', 'audience'), 'account-1', '/v1/repos'),
    ).rejects.toMatchObject({ status: 401 })

    const scope = await egressFixture()
    vi.mocked(scope.deps.agentTokens.findAccessTokenByHash).mockResolvedValue({
      ...scope.token,
      scopes: ['repo:write'],
    })
    vi.mocked(scope.deps.agentTokens.findGrant).mockResolvedValue({
      ...scope.authorityGrant,
      scopes: ['repo:read', 'repo:write'],
    })
    await expect(
      proxyAgentEgress(scope.deps, await scope.request('GET', '/v1/repos', 'scope'), 'account-1', '/v1/repos'),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('rejects non-canonical paths, private or malformed origins, and redirects', async () => {
    for (const path of ['v1//repos', '/v1/../admin', '/v1/%2e%2e/admin', '/v1\\repos']) {
      const fixture = await egressFixture()
      await expect(
        proxyAgentEgress(
          fixture.deps,
          await fixture.request('GET', '/v1/repos', crypto.randomUUID()),
          'account-1',
          path,
        ),
      ).rejects.toMatchObject({ status: 400 })
    }

    for (const apiBaseUrl of [
      'http://api.example.com',
      'https://user@api.example.com',
      'https://api.example.com/path',
      'https://api.example.com/?query=1',
      'https://api.example.com/#fragment',
      'https://localhost',
      'https://api.local',
      'https://127.0.0.1',
      'https://10.0.0.1',
      'https://169.254.1.1',
      'https://172.16.0.1',
      'https://192.168.1.1',
      'https://0.1.2.3',
      'https://[::1]',
      'https://[fc00::1]',
      'https://[fd00::1]',
      'https://[fe80::1]',
    ]) {
      const fixture = await egressFixture()
      vi.mocked(fixture.deps.connectors.findById).mockResolvedValue(connectorRecord({ apiBaseUrl }))
      vi.mocked(fixture.deps.agentTokens.findAccessTokenByHash).mockResolvedValue({
        ...fixture.token,
        audience: apiBaseUrl,
      })
      vi.mocked(fixture.deps.agentTokens.findGrant).mockResolvedValue({
        ...fixture.authorityGrant,
        audience: apiBaseUrl,
      })
      await expect(
        proxyAgentEgress(
          fixture.deps,
          await fixture.request('GET', '/v1/repos', crypto.randomUUID()),
          'account-1',
          '/v1/repos',
        ),
      ).rejects.toMatchObject({ status: 403 })
    }

    const redirect = await egressFixture()
    redirect.externalFetch.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://other' } }),
    )
    await expect(
      proxyAgentEgress(redirect.deps, await redirect.request('GET', '/v1/repos', 'redirect'), 'account-1', '/v1/repos'),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('filters request and response headers and forwards non-GET bodies', async () => {
    const fixture = await egressFixture()
    vi.mocked(fixture.deps.connectors.findById).mockResolvedValue(
      connectorRecord({ allowedMethods: ['POST'], allowedPathPrefixes: ['/v1'] }),
    )
    vi.mocked(fixture.deps.externalAccounts.findActiveGrant).mockResolvedValue({
      ...externalGrantRecord(),
      allowedMethods: ['POST'],
    })
    const request = await fixture.request('POST', '/v1/repos', 'post', {
      accept: 'application/json',
      'accept-language': 'en',
      'content-type': 'application/json',
      'if-match': 'etag',
      'if-none-match': 'other',
      'if-modified-since': 'date',
      'if-unmodified-since': 'date',
      'x-request-id': 'request-1',
      connection: 'close',
      'x-not-forwarded': 'secret',
    })
    const withBody = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: '{"name":"repo"}',
    })

    await proxyAgentEgress(fixture.deps, withBody, 'account-1', 'v1/repos')

    const upstream = fixture.externalFetch.mock.calls[0]![0]
    expect(await upstream.text()).toBe('{"name":"repo"}')
    expect(upstream.headers.get('x-request-id')).toBe('request-1')
    expect(upstream.headers.get('x-not-forwarded')).toBeNull()
    expect(upstream.headers.get('connection')).toBeNull()

    const forbiddenHeaders: Array<[string, string, number]> = [
      ['authorization', 'Bearer override', 401],
      ['cookie', 'session=secret', 400],
      ['proxy-authorization', 'Basic secret', 400],
      ['x-api-key', 'override', 400],
    ]
    for (const [name, value, status] of forbiddenHeaders) {
      const denied = await egressFixture()
      await expect(
        proxyAgentEgress(
          denied.deps,
          await denied.request('GET', '/v1/repos', crypto.randomUUID(), { [name]: value }),
          'account-1',
          '/v1/repos',
        ),
      ).rejects.toMatchObject({ status })
    }
  })

  it('injects bearer and unexpired OAuth credentials', async () => {
    const bearer = await egressFixture()
    vi.mocked(bearer.deps.externalAccounts.findCredential).mockResolvedValue(credentialRecord({ kind: 'bearer' }))
    vi.mocked(bearer.deps.secrets.open).mockResolvedValue(JSON.stringify({ token: 'bearer-secret' }))
    await proxyAgentEgress(bearer.deps, await bearer.request('GET', '/v1/repos', 'bearer'), 'account-1', '/v1/repos')
    expect(bearer.externalFetch.mock.calls[0]![0].headers.get('authorization')).toBe('Bearer bearer-secret')

    const oauth = await egressFixture()
    vi.mocked(oauth.deps.externalAccounts.findCredential).mockResolvedValue(
      credentialRecord({ kind: 'oauth', expiresAt: new Date(Date.now() + 60_000) }),
    )
    vi.mocked(oauth.deps.secrets.open).mockResolvedValue(
      JSON.stringify({ accessToken: 'oauth-access', refreshToken: 'refresh' }),
    )
    await proxyAgentEgress(oauth.deps, await oauth.request('GET', '/v1/repos', 'oauth'), 'account-1', '/v1/repos')
    expect(oauth.externalFetch.mock.calls[0]![0].headers.get('authorization')).toBe('Bearer oauth-access')
  })

  it('refreshes expired OAuth credentials and persists rotations', async () => {
    const fixture = await egressFixture()
    vi.mocked(fixture.deps.externalAccounts.findCredential).mockResolvedValue(
      credentialRecord({ kind: 'oauth', expiresAt: new Date(Date.now() - 1) }),
    )
    vi.mocked(fixture.deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerType: 'generic_oauth',
        issuer: null,
        authorizationEndpoint: 'https://oauth.example.com/authorize',
        tokenEndpoint: 'https://oauth.example.com/token',
        clientId: 'client-1',
        clientSecret: 'client-secret',
      }),
    )
    vi.mocked(fixture.deps.secrets.open).mockResolvedValue(
      JSON.stringify({ accessToken: 'expired', refreshToken: 'refresh', scope: 'repo:read' }),
    )
    fixture.externalFetch
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'refreshed',
          refresh_token: 'rotated',
          scope: 'repo:read repo:write',
          expires_in: 60,
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }))

    await proxyAgentEgress(fixture.deps, await fixture.request('GET', '/v1/repos', 'refresh'), 'account-1', '/v1/repos')
    expect(fixture.deps.externalAccounts.updateCredential).toHaveBeenCalledWith(
      'credential-1',
      expect.objectContaining({ expiresAt: expect.any(Date) }),
    )
    expect(fixture.externalFetch.mock.calls[1]![0].headers.get('authorization')).toBe('Bearer refreshed')

    const minimal = await oauthRefreshFixture()
    minimal.externalFetch
      .mockResolvedValueOnce(Response.json({ access_token: 'minimal-refreshed' }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    await proxyAgentEgress(
      minimal.deps,
      await minimal.request('GET', '/v1/repos', 'minimal-refresh'),
      'account-1',
      '/v1/repos',
    )
    expect(minimal.deps.externalAccounts.updateCredential).toHaveBeenCalledWith(
      'credential-1',
      expect.objectContaining({ expiresAt: null }),
    )
    expect(minimal.externalFetch.mock.calls[1]![0].headers.get('authorization')).toBe('Bearer minimal-refreshed')
  })

  it('rejects invalid credential payloads and OAuth refresh failures', async () => {
    for (const value of ['null', '[]']) {
      const fixture = await egressFixture()
      vi.mocked(fixture.deps.secrets.open).mockResolvedValue(value)
      await expect(
        proxyAgentEgress(
          fixture.deps,
          await fixture.request('GET', '/v1/repos', crypto.randomUUID()),
          'account-1',
          '/v1/repos',
        ),
      ).rejects.toMatchObject({ status: 403 })
    }

    for (const [credential, payload] of [
      [credentialRecord({ kind: 'header' }), { headerName: 'Wrong', value: 'secret' }],
      [credentialRecord({ kind: 'header' }), { headerName: 'X-API-Key', value: 1 }],
      [credentialRecord({ kind: 'bearer' }), { token: 1 }],
      [credentialRecord({ kind: 'unsupported' }), {}],
      [credentialRecord({ kind: 'oauth', expiresAt: null }), {}],
    ] as const) {
      const fixture = await egressFixture()
      vi.mocked(fixture.deps.externalAccounts.findCredential).mockResolvedValue(credential)
      vi.mocked(fixture.deps.secrets.open).mockResolvedValue(JSON.stringify(payload))
      await expect(
        proxyAgentEgress(
          fixture.deps,
          await fixture.request('GET', '/v1/repos', crypto.randomUUID()),
          'account-1',
          '/v1/repos',
        ),
      ).rejects.toMatchObject({ status: 403 })
    }

    for (const configure of [
      (fixture: Awaited<ReturnType<typeof oauthRefreshFixture>>) =>
        vi.mocked(fixture.deps.secrets.open).mockResolvedValue(JSON.stringify({ accessToken: 'expired' })),
      (fixture: Awaited<ReturnType<typeof oauthRefreshFixture>>) =>
        fixture.externalFetch.mockResolvedValue(new Response(null, { status: 400 })),
      (fixture: Awaited<ReturnType<typeof oauthRefreshFixture>>) =>
        fixture.externalFetch.mockResolvedValue(new Response('not-json')),
      (fixture: Awaited<ReturnType<typeof oauthRefreshFixture>>) =>
        fixture.externalFetch.mockResolvedValue(Response.json({ access_token: 1 })),
    ]) {
      const fixture = await oauthRefreshFixture()
      configure(fixture)
      await expect(
        proxyAgentEgress(
          fixture.deps,
          await fixture.request('GET', '/v1/repos', crypto.randomUUID()),
          'account-1',
          '/v1/repos',
        ),
      ).rejects.toMatchObject({ status: 401 })
    }
  })

  it('extracts delegated host actors and audits unexpected internal errors', async () => {
    const delegated = await egressFixture()
    vi.mocked(delegated.deps.agentTokens.findAccessTokenByHash).mockResolvedValue({
      ...delegated.token,
      actor: {
        iss: 'https://auth.example.com/api/auth',
        actor_type: 'host',
        sub: 'host-delegated',
        act: {
          iss: 'https://auth.example.com/api/auth',
          actor_type: 'agent',
          sub: 'agent-subject',
        },
      },
    })
    vi.mocked(delegated.deps.agentTokens.findGrant).mockResolvedValue({
      ...delegated.authorityGrant,
      mode: 'delegated',
    })
    vi.mocked(delegated.deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue({
      identity: {
        id: 'identity-1',
        issuer: 'https://auth.example.com/api/auth',
        subject: 'agent-subject',
        name: 'Agent',
        ownerUserId: 'user-1',
        ownerOrganizationId: null,
        status: 'active',
        retiredAt: null,
        createdAt: delegated.token.createdAt,
        updatedAt: delegated.token.createdAt,
      },
      bindings: [
        {
          id: 'binding-1',
          agentIdentityId: 'identity-1',
          protocolAgentId: 'protocol-agent-1',
          hostId: 'host-delegated',
          status: 'active',
          boundAt: delegated.token.createdAt,
          revokedAt: null,
          createdAt: delegated.token.createdAt,
          updatedAt: delegated.token.createdAt,
        },
      ],
    })
    await proxyAgentEgress(
      delegated.deps,
      await delegated.request('GET', '/v1/repos', 'delegated'),
      'account-1',
      '/v1/repos',
    )
    expect(delegated.deps.agentAudit.append).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'host-delegated' }))

    const internal = await egressFixture()
    vi.mocked(internal.deps.secrets.open).mockResolvedValue('{')
    await expect(
      proxyAgentEgress(internal.deps, await internal.request('GET', '/v1/repos', 'internal'), 'account-1', '/v1/repos'),
    ).rejects.toBeInstanceOf(SyntaxError)
    expect(internal.deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'host-1', reasonCode: 'internal_error' }),
    )
  })
})

async function oauthRefreshFixture() {
  const fixture = await egressFixture()
  vi.mocked(fixture.deps.externalAccounts.findCredential).mockResolvedValue(
    credentialRecord({ kind: 'oauth', expiresAt: new Date(Date.now() - 1) }),
  )
  vi.mocked(fixture.deps.connectors.findById).mockResolvedValue(
    connectorRecord({
      providerType: 'generic_oauth',
      issuer: null,
      authorizationEndpoint: 'https://oauth.example.com/authorize',
      tokenEndpoint: 'https://oauth.example.com/token',
      clientId: 'client-1',
      clientSecret: 'client-secret',
    }),
  )
  vi.mocked(fixture.deps.secrets.open).mockResolvedValue(
    JSON.stringify({ accessToken: 'expired', refreshToken: 'refresh', scope: 'repo:read' }),
  )
  return fixture
}

async function egressFixture() {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const publicJwk = await exportJWK(publicKey)
  const thumbprint = await calculateJwkThumbprint(publicJwk)
  const now = new Date()
  const externalFetch = vi.fn(async (_request: Request) =>
    Response.json({ ok: true }, { headers: { 'set-cookie': 'secret=cookie', 'x-ratelimit-remaining': '9' } }),
  )
  const deps = createTestDeps()
  const token = {
    id: 'token-1',
    tokenHash: 'hash',
    agentIdentityId: 'identity-1',
    bindingId: 'binding-1',
    protocolAgentId: 'protocol-agent-1',
    grantId: 'authority-1',
    subjectIssuer: 'https://auth.example.com/api/auth',
    subject: 'agent-subject',
    actor: { iss: 'https://auth.example.com/api/auth', actor_type: 'host', sub: 'host-1' },
    audience: 'https://api.example.com',
    scopes: ['repo:read'],
    confirmationJkt: thumbprint,
    expiresAt: new Date(now.getTime() + 300_000),
    revokedAt: null,
    createdAt: now,
  } satisfies AgentAccessTokenRecord
  const accessToken = compactJwt(accessTokenClaims(token))
  egressVerifiers.set(deps, {
    issuer: token.subjectIssuer,
    verify: vi.fn(async () => {
      const current = await deps.agentTokens.findAccessTokenByHash('ignored-by-test')
      return current ? accessTokenClaims(current) : null
    }),
  })
  vi.mocked(deps.agentTokens.findAccessTokenByHash).mockResolvedValue(token)
  const authorityGrant = {
    id: 'authority-1',
    agentIdentityId: 'identity-1',
    mode: 'autonomous',
    subjectType: 'agent',
    subjectId: 'agent-subject',
    audience: 'https://api.example.com',
    scopes: ['repo:read'],
    constraints: null,
    useCount: 0,
    status: 'active',
    grantedByUserId: 'user-1',
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies AgentAuthorityGrantRecord
  vi.mocked(deps.agentTokens.findGrant).mockResolvedValue(authorityGrant)
  vi.mocked(deps.agentIdentities.findActiveByProtocolAgent).mockResolvedValue({
    identity: {
      id: 'identity-1',
      issuer: 'https://auth.example.com/api/auth',
      subject: 'agent-subject',
      name: 'Agent',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      status: 'active',
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    },
    bindings: [
      {
        id: 'binding-1',
        agentIdentityId: 'identity-1',
        protocolAgentId: 'protocol-agent-1',
        hostId: 'host-1',
        status: 'active',
        boundAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  })
  vi.mocked(deps.externalAccounts.findAccount).mockResolvedValue({
    id: 'account-1',
    connectorId: 'connector-1',
    ownerUserId: 'user-1',
    ownerOrganizationId: null,
    ownerAgentIdentityId: null,
    externalSubject: null,
    displayName: 'API',
    status: 'active',
    metadata: null,
    createdAt: now,
    updatedAt: now,
  })
  vi.mocked(deps.externalAccounts.findCredential).mockResolvedValue({
    id: 'credential-1',
    externalAccountId: 'account-1',
    kind: 'header',
    encryptedPayload: 'sealed',
    status: 'active',
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  })
  vi.mocked(deps.externalAccounts.findActiveGrant).mockResolvedValue({
    id: 'external-grant-1',
    externalAccountId: 'account-1',
    agentIdentityId: 'identity-1',
    scopes: ['repo:read'],
    allowedMethods: ['GET'],
    allowedPathPrefixes: ['/v1/repos'],
    status: 'active',
    grantedByUserId: 'user-1',
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  vi.mocked(deps.connectors.findById).mockResolvedValue({
    id: 'connector-1',
    slug: 'api',
    providerType: 'generic_api',
    providerId: 'api',
    displayName: 'API',
    enabled: true,
    clientId: null,
    clientSecret: null,
    issuer: null,
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    jwksEndpoint: null,
    scopes: null,
    apiBaseUrl: 'https://api.example.com',
    credentialModes: ['header'],
    credentialHeaderName: 'X-API-Key',
    allowedMethods: ['GET'],
    allowedPathPrefixes: ['/v1/repos'],
    attributeMapping: null,
    providerMetadata: null,
    createdAt: now,
    updatedAt: now,
  })
  vi.mocked(deps.secrets.open).mockResolvedValue(JSON.stringify({ headerName: 'X-API-Key', value: 'external-secret' }))
  deps.externalHttp.fetch = externalFetch

  return {
    deps,
    externalFetch,
    token,
    authorityGrant,
    async request(method: string, path: string, jti: string, headers: Record<string, string> = {}) {
      const url = `https://auth.example.com/api/agent/egress/account-1${path}`
      const proof = await new SignJWT({
        jti,
        htm: method,
        htu: new URL(url).origin + new URL(url).pathname,
        iat: Math.floor(Date.now() / 1000),
        ath: await sha256(accessToken),
      })
        .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
        .sign(privateKey)
      return new Request(url, {
        method,
        headers: { authorization: `DPoP ${accessToken}`, dpop: proof, ...headers },
      })
    },
  }
}

function compactJwt(payload: Record<string, unknown>) {
  return `${encodeJwtPart({ typ: 'at+jwt', alg: 'RS256', kid: 'test' })}.${encodeJwtPart(payload)}.signature`
}

function accessTokenClaims(token: AgentAccessTokenRecord) {
  return {
    iss: token.subjectIssuer,
    sub: token.subject,
    aud: token.audience,
    jti: token.id,
    client_id: token.protocolAgentId,
    scope: token.scopes.join(' '),
    cnf: { jkt: token.confirmationJkt },
    iat: Math.floor(token.createdAt.getTime() / 1000),
    exp: Math.floor(token.expiresAt.getTime() / 1000),
    act: token.actor,
    agent_identity: { iss: token.subjectIssuer, sub: 'agent-subject' },
  }
}

function encodeJwtPart(value: Record<string, unknown>) {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function accountRecord(overrides: Partial<ExternalAccountRecord> = {}): ExternalAccountRecord {
  const now = new Date()
  return {
    id: 'account-1',
    connectorId: 'connector-1',
    ownerUserId: 'user-1',
    ownerOrganizationId: null,
    ownerAgentIdentityId: null,
    externalSubject: null,
    displayName: 'API',
    status: 'active',
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function credentialRecord(overrides: Partial<ExternalCredentialRecord> = {}): ExternalCredentialRecord {
  const now = new Date()
  return {
    id: 'credential-1',
    externalAccountId: 'account-1',
    kind: 'header',
    encryptedPayload: 'sealed',
    status: 'active',
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function externalGrantRecord(overrides: Partial<ExternalAccountGrantRecord> = {}): ExternalAccountGrantRecord {
  const now = new Date()
  return {
    id: 'external-grant-1',
    externalAccountId: 'account-1',
    agentIdentityId: 'identity-1',
    scopes: ['repo:read'],
    allowedMethods: ['GET'],
    allowedPathPrefixes: ['/v1/repos'],
    status: 'active',
    grantedByUserId: 'user-1',
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function connectorRecord(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  const now = new Date()
  return {
    id: 'connector-1',
    slug: 'api',
    providerType: 'generic_api',
    providerId: 'api',
    displayName: 'API',
    enabled: true,
    clientId: null,
    clientSecret: null,
    issuer: null,
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    jwksEndpoint: null,
    scopes: null,
    apiBaseUrl: 'https://api.example.com',
    credentialModes: ['header'],
    credentialHeaderName: 'X-API-Key',
    allowedMethods: ['GET'],
    allowedPathPrefixes: ['/v1/repos'],
    attributeMapping: null,
    providerMetadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
