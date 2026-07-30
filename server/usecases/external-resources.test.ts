import { createTestDeps } from '@server/http/test-deps'
import {
  completeResourceConnectionIntent,
  configureExternalResourceAuthorization,
  createAccessRequest,
  createAccountConnection,
  createAgentAccessRequest,
  createExternalApiResource,
  createResourceConnectionIntent,
  decideAccessRequest,
  decideAgentAccessRequest,
  decideAgentAccessRequestByToken,
  discoverAgentResources,
  getAccessRequest,
  getAccountAccessRequest,
  getAccountAccessRequestByToken,
  getAccountConnection,
  getAgentAccessGrant,
  getAgentAccessRequest,
  getApiResource,
  getExternalResourceAuthorization,
  issueTargetAccessToken,
  listAccessRequestConnections,
  listAccountAccessRequests,
  listAccountConnections,
  listAgentAccessGrants,
  listAgentApiResources,
  listApiResources,
  listConnectableExternalResources,
  listControllerAccessRequests,
  listResourceConnections,
  revokeAgentAccessGrant,
  revokeAgentResourceAccess,
  revokeAgentResourceLeasesForBinding,
  revokeResourceConnection,
} from '@server/usecases/external-resources'
import type {
  AgentAccessGrantRecord,
  AgentAccessRequestRecord,
  AgentIdentityAggregate,
  ExternalResourceAuthorizationRecord,
  ResourceAccountConnectionRecord,
  ResourceConnectionIntentRecord,
} from '@server/usecases/ports'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { exportJWK, generateKeyPair, type JWTHeaderParameters, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const now = new Date('2026-07-29T12:00:00.000Z')

describe('external API resource authorization', () => {
  it('discovers and registers a protocol-only target [spec: agent-identity/external-api-resource-registration]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url === new URL(resource().resourceUrl).toString()) {
        return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
      }
      if (request.url === new URL('/openapi.json', resource().resourceUrl).toString()) {
        return Response.json({ openapi: '3.1.0', paths: {} })
      }
      if (request.url.endsWith('/.well-known/oauth-protected-resource/api')) {
        return Response.json({
          resource: 'https://projects.example.com/api',
          authorization_servers: ['https://projects.example.com'],
        })
      }
      if (request.url.endsWith('/.well-known/oauth-authorization-server')) {
        return Response.json(metadata())
      }
      if (request.url.endsWith('/register')) {
        const body = (await request.json()) as Record<string, unknown>
        expect(body).toMatchObject({
          jwks_uri: 'https://auth.example.com/api/auth/jwks',
          grant_types: [
            'authorization_code',
            'refresh_token',
            'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'urn:ietf:params:oauth:grant-type:token-exchange',
          ],
        })
        expect(body).not.toHaveProperty('resource')
        return Response.json(
          {
            client_id: 'realmroot-client',
            client_secret: 'target-secret',
            registration_access_token: 'registration-token',
          },
          { status: 201 },
        )
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      createExternalApiResource(
        deps,
        {
          identifier: 'projects',
          name: 'Projects API',
          resourceUrl: 'https://projects.example.com/api',
          authorizationMode: 'external',
        },
        { registrationMode: 'dynamic' },
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      id: 'resource-1',
      authorization: {
        issuer: 'https://projects.example.com',
        registrationMode: 'dynamic',
        clientId: 'realmroot-client',
        clientSecretConfigured: true,
        status: 'active',
      },
    })
    expect(deps.externalResources.createResourceWithAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^res_/),
        identifier: 'projects',
        resourceUrl: 'https://projects.example.com/api',
        authorizationMode: 'external',
        enabled: true,
      }),
      expect.objectContaining({
        resourceId: expect.stringMatching(/^res_/),
        registrationMode: 'dynamic',
        clientId: 'realmroot-client',
      }),
    )
    expect(deps.externalResources.configureAuthorization).not.toHaveBeenCalled()
    expect(deps.authorization.updateResource).not.toHaveBeenCalled()
    expect(deps.connectors.create).not.toHaveBeenCalled()
  })

  it('does not persist an external resource when dynamic registration fails', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url === 'https://projects.example.com/api') {
        return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
      }
      if (request.url === 'https://projects.example.com/openapi.json') {
        return Response.json({ openapi: '3.1.0', paths: {} })
      }
      if (request.url.endsWith('/.well-known/oauth-protected-resource/api')) {
        return Response.json({
          resource: 'https://projects.example.com/api',
          authorization_servers: ['https://projects.example.com'],
        })
      }
      if (request.url.endsWith('/.well-known/oauth-authorization-server')) {
        return Response.json(metadata())
      }
      if (request.url.endsWith('/register')) {
        return Response.json({ error: 'invalid_client_metadata' }, { status: 400 })
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      createExternalApiResource(
        deps,
        {
          identifier: 'projects',
          name: 'Projects API',
          resourceUrl: 'https://projects.example.com/api',
          authorizationMode: 'external',
        },
        { registrationMode: 'dynamic' },
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Dynamic client registration failed.')
    expect(deps.externalResources.createResourceWithAuthorization).not.toHaveBeenCalled()
  })

  it('connects the user account with authorization code and PKCE [spec: agent-identity/resource-account-connection]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    let intent: ResourceConnectionIntentRecord | null = null
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => {
      intent = record
      return record
    })
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockImplementation(async () => intent)
    vi.mocked(deps.externalResources.createConnection).mockImplementation(async (record) => record)

    const started = await createResourceConnectionIntent(
      deps,
      'resource-1',
      { owner: { type: 'user' }, scopes: ['projects:read'] },
      'user-1',
      'https://auth.example.com',
    )
    const authorizationUrl = new URL(started.authorizationUrl)
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('resource')).toBe('https://projects.example.com/api')
    vi.mocked(deps.secrets.seal).mockResolvedValueOnce('v1.encrypted-resource-credential')

    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url.endsWith('/token')) {
        const form = new URLSearchParams(await request.text())
        expect(form.get('code_verifier')).toBeTruthy()
        return Response.json({
          access_token: 'subject-access',
          refresh_token: 'subject-refresh',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'openid offline_access projects:read',
        })
      }
      if (request.url.endsWith('/userinfo')) {
        expect(request.headers.get('authorization')).toBe('Bearer subject-access')
        return Response.json({ sub: 'target-user-1', name: 'Project Owner' })
      }
      return new Response(null, { status: 404 })
    })

    const connection = await completeResourceConnectionIntent(
      deps,
      { state: authorizationUrl.searchParams.get('state')!, code: 'authorization-code' },
      'https://auth.example.com',
    )
    expect(connection).toMatchObject({
      resourceId: 'resource-1',
      owner: { type: 'user', userId: 'user-1' },
      externalSubject: 'target-user-1',
      displayName: 'Project Owner',
      status: 'active',
    })
    const stored = vi.mocked(deps.externalResources.createConnection).mock.calls[0]![0]
    expect(stored.encryptedTokens).not.toContain('subject-refresh')

    intent = {
      ...intent!,
      id: 'organization-connection',
      ownerOrganizationId: 'org-1',
    }
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url.endsWith('/token')) {
        return Response.json({
          access_token: 'organization-access',
          refresh_token: 'organization-refresh',
          token_type: 'Bearer',
        })
      }
      if (request.url.endsWith('/userinfo')) {
        return Response.json({ sub: 'org-subject', preferred_username: 'Organization Owner' })
      }
      return new Response(null, { status: 404 })
    })
    await expect(
      completeResourceConnectionIntent(
        deps,
        { state: 'organization-state', code: 'organization-code' },
        'https://auth.example.com/',
      ),
    ).resolves.toMatchObject({
      owner: { type: 'organization', organizationId: 'org-1' },
      displayName: 'Organization Owner',
      grantedScopes: intent.scopes,
      credentialExpiresAt: null,
    })
  })

  it('reauthorizes the same external account without replacing its connection identity [spec: agent-identity/resource-account-reauthorization]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const intent: ResourceConnectionIntentRecord = {
      id: 'replacement-intent',
      stateHash: 'state-hash',
      resourceId: 'resource-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      scopes: ['offline_access', 'openid', 'projects:read', 'projects:write'],
      encryptedPkceVerifier: 'sealed:pkce-verifier',
      returnTo: 'access-approval',
      status: 'completed',
      expiresAt: new Date(Date.now() + 300_000),
      completedAt: new Date(),
      createdAt: now,
      updatedAt: now,
    }
    const existing = {
      ...connectionRecord(),
      status: 'revoked',
      revokedAt: now,
    }
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(intent)
    vi.mocked(deps.externalResources.findConnectionByOwnerSubject).mockResolvedValue(existing)
    vi.mocked(deps.externalResources.replaceConnectionAuthorization).mockImplementation(
      async (id, _resourceId, input) => ({
        ...existing,
        ...input,
        id,
      }),
    )
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url.endsWith('/token')) {
        return Response.json({
          access_token: 'replacement-access',
          refresh_token: 'replacement-refresh',
          token_type: 'Bearer',
          expires_in: 600,
          scope: 'openid offline_access projects:read projects:write',
        })
      }
      if (request.url.endsWith('/userinfo')) {
        return Response.json({ sub: 'target-user-1', name: 'Renamed Project Owner' })
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      completeResourceConnectionIntent(
        deps,
        { state: 'replacement-state', code: 'replacement-code' },
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      id: 'connection-1',
      displayName: 'Renamed Project Owner',
      grantedScopes: ['offline_access', 'openid', 'projects:read', 'projects:write'],
      status: 'active',
      returnTo: 'access-approval',
    })
    expect(deps.externalResources.findConnectionByOwnerSubject).toHaveBeenCalledWith({
      resourceId: 'resource-1',
      externalSubject: 'target-user-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
    })
    expect(deps.externalResources.replaceConnectionAuthorization).toHaveBeenCalledWith(
      'connection-1',
      'resource-1',
      expect.objectContaining({
        displayName: 'Renamed Project Owner',
        encryptedTokens: expect.stringContaining('replacement-refresh'),
        grantedScopes: ['offline_access', 'openid', 'projects:read', 'projects:write'],
        status: 'active',
        revokedAt: null,
      }),
    )
    expect(deps.secrets.seal).toHaveBeenCalledWith(
      expect.stringContaining('replacement-refresh'),
      'resource-connection:connection-1:tokens',
    )
    expect(deps.externalResources.createConnection).not.toHaveBeenCalled()
  })

  it(`discovers an external resource and creates an exact request before any connection
      [spec: agent-identity/agent-resource-discovery]
      [spec: agent-identity/external-resource-first-access]`, async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const identity = identityAggregate()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identity)
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([])
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
    let pending: AgentAccessRequestRecord[] = []
    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockImplementation(async () => pending)
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => {
      pending = [record]
      return record
    })

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      resources: [
        {
          id: 'resource-1',
          description: 'Manage private projects',
          scopes: [{ value: 'projects:read', description: 'Read projects' }],
          connections: [],
        },
      ],
    })
    const first = await createAgentAccessRequest(
      deps,
      { resourceId: 'resource-1', connectionId: null, scopes: ['projects:read'], reason: 'Read projects' },
      principal(),
      'https://auth.example.com',
    )
    const repeated = await createAgentAccessRequest(
      deps,
      { resourceId: 'resource-1', connectionId: null, scopes: ['projects:read'], reason: 'Repeated' },
      principal(),
      'https://auth.example.com',
    )
    expect(first.status).toBe('pending')
    expect(first.approvalUrl).toContain('/agent/resource-access/approve#token=')
    expect(repeated.id).toBe(first.id)
    expect(deps.externalResources.createAccessRequest).toHaveBeenCalledOnce()
  })

  it('lets the account controller approve an exact request once [spec: agent-identity/agent-resource-approval]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const request = { ...requestRecord(), connectionId: null }
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.createGrant).mockImplementation(async (record) => record)
    vi.mocked(deps.externalResources.decideAccessRequest).mockImplementation(async (_id, decision) => ({
      ...request,
      ...decision,
    }))
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())

    const decided = await decideAgentAccessRequestByToken(
      deps,
      'approval-token',
      { decision: 'approve', mode: 'once', accountConnectionId: 'connection-1' },
      'user-1',
    )
    expect(decided).toMatchObject({ status: 'approved', hostId: 'host-1', scopes: ['projects:read'] })
    expect(deps.externalResources.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'connection-1',
        mode: 'once',
        scopes: ['projects:read'],
        grantedByUserId: 'user-1',
      }),
    )
    expect(deps.externalResources.decideAccessRequest).toHaveBeenCalledWith(
      'request-1',
      expect.objectContaining({ connectionId: 'connection-1' }),
    )
  })

  it(`exchanges user and Agent authority for a target-issued DPoP token
      [spec: agent-identity/agent-direct-resource-access]
      [spec: agent-identity/agent-audit-chain]`, async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const openApiFetch = vi.mocked(deps.externalHttp.fetch).getMockImplementation()!
    const request = { ...requestRecord(), status: 'approved', grantId: 'grant-1' }
    const grant = grantRecord()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grant)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      credentialExpiresAt: new Date(Date.now() - 1),
    })
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    vi.mocked(deps.externalResources.createTokenLease).mockImplementation(async (record) => record)
    vi.mocked(deps.externalResources.consumeAccessRequest).mockResolvedValue(true)
    vi.mocked(deps.externalResources.consumeGrant).mockResolvedValue(true)
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    const proof = await new SignJWT({
      htm: 'POST',
      htu: 'https://projects.example.com/token',
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
      .sign(privateKey)
    const tokenRequests: URLSearchParams[] = []
    let exchangeResponse: Record<string, unknown> = {
      access_token: 'target-dpop-access',
      token_type: 'DPoP',
      expires_in: 5_000,
    }
    let exchangeStatus = 200
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (outbound) => {
      if (outbound.url === resource().resourceUrl || outbound.url === 'https://projects.example.com/openapi.json') {
        return openApiFetch(outbound)
      }
      expect(outbound.url).toBe('https://projects.example.com/token')
      const form = new URLSearchParams(await outbound.text())
      tokenRequests.push(form)
      if (form.get('grant_type') === 'refresh_token') {
        return Response.json({
          access_token: 'refreshed-subject',
          token_type: 'Bearer',
          expires_in: 0,
        })
      }
      if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        expect(outbound.headers.get('dpop')).toBeNull()
        expect(form.get('assertion')).toBe('signed-agent-assertion')
        return Response.json({
          access_token: 'target-agent-access',
          token_type: 'Bearer',
          expires_in: 300,
        })
      }
      expect(outbound.headers.get('dpop')).toBe(proof)
      expect(form.get('subject_token')).toBe('refreshed-subject')
      expect(form.get('actor_token')).toBe('target-agent-access')
      expect(form.get('actor_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token')
      expect(form.get('scope')).toBe('projects:read')
      return Response.json(exchangeResponse, { status: exchangeStatus })
    })

    const sign = vi.fn().mockResolvedValue('signed-agent-assertion')
    const lease = await issueTargetAccessToken(
      deps,
      grant.id,
      proof,
      'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
      principal(),
      { issuer: 'https://auth.example.com/api/auth', sign },
    )
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        iss: 'https://auth.example.com/api/auth',
        sub: 'agt_stable',
        aud: 'https://projects.example.com/token',
      }),
      'JWT',
    )
    expect(sign.mock.calls[0]![0]).not.toHaveProperty('act')
    expect(tokenRequests.map((form) => form.get('grant_type'))).toEqual([
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ])
    expect(lease).toEqual({
      accessToken: 'target-dpop-access',
      tokenType: 'DPoP',
      expiresIn: 3_600,
      expiresAt: expect.any(String),
      scopes: ['projects:read'],
      resourceUrl: 'https://projects.example.com/api',
    })
    expect(deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_resource.token_issued',
        agentIdentityId: 'identity-1',
        hostId: 'host-1',
        resourceConnectionId: 'connection-1',
        accessGrantId: 'grant-1',
        scopes: ['projects:read'],
      }),
    )

    exchangeResponse = { access_token: 'wrong-type', token_type: 'Bearer', expires_in: 60 }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('did not issue a DPoP-bound access token')
    exchangeResponse = {
      access_token: 'wrong-scope',
      token_type: 'DPoP',
      expires_in: 60,
      scope: 'projects:write',
    }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('issued a different scope set')
    exchangeResponse = { access_token: 'invalid-expiry', token_type: 'DPoP', expires_in: 0 }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('invalid expires_in')
    exchangeStatus = 400
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('rejected the token request')
  })

  it('revokes active target token leases [spec: agent-identity/agent-resource-revocation]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      grantId: 'grant-1',
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    vi.mocked(deps.externalResources.listActiveTokenLeasesByGrant).mockResolvedValue([
      {
        id: 'lease-1',
        grantId: 'grant-1',
        requestId: 'request-1',
        bindingId: 'binding-1',
        encryptedAccessToken: 'sealed:target-dpop-access',
        tokenHash: 'hash',
        confirmationJkt: 'jkt',
        scopes: ['projects:read'],
        expiresAt: new Date(Date.now() + 300_000),
        revokedAt: null,
        createdAt: now,
      },
    ])
    vi.mocked(deps.externalResources.revokeTokenLease).mockResolvedValue(true)
    vi.mocked(deps.externalResources.revokeGrant).mockResolvedValue(true)
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (outbound) => {
      expect(outbound.url).toBe('https://projects.example.com/revoke')
      expect(new URLSearchParams(await outbound.text()).get('token')).toBe('target-dpop-access')
      return new Response(null, { status: 200 })
    })

    await revokeAgentAccessGrant(deps, 'grant-1', 'user-1')
    expect(deps.externalResources.revokeTokenLease).toHaveBeenCalledWith('lease-1', expect.any(Date))
    expect(deps.externalResources.revokeGrant).toHaveBeenCalledWith('grant-1', expect.any(Date))
  })

  it('maps management and account resource views', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([
      connectionRecord(),
      {
        ...connectionRecord(),
        id: 'connection-2',
        ownerUserId: null,
        ownerOrganizationId: 'organization-1',
        externalSubject: 'tiny',
        credentialExpiresAt: null,
      },
    ])

    await expect(getExternalResourceAuthorization(deps, 'resource-1')).resolves.toMatchObject({
      resourceId: 'resource-1',
      clientSecretConfigured: true,
    })
    await expect(getApiResource(deps, 'resource-1')).resolves.toMatchObject({
      id: 'resource-1',
      authorization: { issuer: 'https://projects.example.com' },
    })
    await expect(listApiResources(deps, { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'resource-1' }],
    })
    await expect(listResourceConnections(deps, 'user-1')).resolves.toMatchObject({
      connections: [{ owner: { type: 'user' } }, { owner: { type: 'organization' }, credentialExpiresAt: null }],
    })
    await expect(listAccountConnections(deps, 'user-1', { limit: 1, offset: 1 })).resolves.toMatchObject({
      items: [{ id: 'connection-2', subjectHint: '••••' }],
      pagination: { total: 2 },
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    await expect(getAccountConnection(deps, 'connection-1', 'user-1')).resolves.toMatchObject({
      apiResourceId: 'resource-1',
      subjectHint: '••••er-1',
    })
    await expect(listConnectableExternalResources(deps)).resolves.toMatchObject({
      resources: [{ id: 'resource-1' }],
    })
  })

  it('creates and revokes account connections, including organization control', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    Object.assign(deps.authorization, {
      findMemberByOrganizationUser: vi.fn().mockResolvedValue({ role: 'credential_manager' }),
    })
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => record)

    await expect(
      createAccountConnection(
        deps,
        {
          context: 'resource',
          apiResourceId: 'resource-1',
          owner: { type: 'organization', organizationId: 'organization-1' },
          scopes: ['projects:read'],
        },
        'user-1',
        'https://auth.example.com/',
      ),
    ).resolves.toMatchObject({
      owner: { type: 'organization', organizationId: 'organization-1' },
      status: 'pending_authorization',
      scopes: ['projects:read'],
      authorizationUrl: expect.stringContaining('/authorize?'),
    })

    const organizationConnection = {
      ...connectionRecord(),
      ownerUserId: null,
      ownerOrganizationId: 'organization-1',
    }
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(organizationConnection)
    vi.mocked(deps.externalResources.listActiveGrantsByConnection).mockResolvedValue([])
    vi.mocked(deps.externalResources.revokeConnection).mockResolvedValue(true)
    await expect(revokeResourceConnection(deps, 'connection-1', 'user-1')).resolves.toBeUndefined()
    expect(deps.externalResources.revokeConnection).toHaveBeenCalledOnce()

    vi.mocked(deps.externalResources.revokeConnection).mockResolvedValue(false)
    await expect(revokeResourceConnection(deps, 'connection-1', 'user-1')).rejects.toThrow(
      'Resource account connection is already revoked.',
    )
  })

  it('[spec: agent-identity/external-resource-first-access] derives approval connection scopes and owner from the pending request', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const request = { ...requestRecord(), connectionId: null }
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => record)

    await expect(
      createAccountConnection(
        deps,
        {
          context: 'access-request',
          accessRequestId: request.id,
          approvalToken: 'approval-token',
        },
        'user-1',
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      apiResourceId: 'resource-1',
      owner: { type: 'user', userId: 'user-1' },
      scopes: ['projects:read'],
      status: 'pending_authorization',
    })
    expect(deps.externalResources.createConnectionIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'resource-1',
        ownerUserId: 'user-1',
        scopes: ['offline_access', 'openid', 'projects:read'],
        returnTo: 'access-approval',
      }),
    )

    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([
      connectionRecord(),
      { ...connectionRecord(), id: 'wrong-scopes', grantedScopes: ['projects:write'] },
    ])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({
      items: [{ id: 'connection-1' }],
      pagination: { total: 1 },
    })
  })

  it('enforces first-access connection context boundaries', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const request = { ...requestRecord(), connectionId: null }
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => record)

    await expect(
      createAccountConnection(
        deps,
        { context: 'access-request', accessRequestId: 'another-request', approvalToken: 'approval-token' },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Agent access request was not found')

    const native = nativeResource()
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    mockResourceOpenApi(deps, native.resourceUrl)
    await expect(
      createAccountConnection(
        deps,
        { context: 'access-request', accessRequestId: request.id, approvalToken: 'approval-token' },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Native API resources do not use account connections')

    vi.mocked(deps.authorization.findResource).mockResolvedValue(resource())
    mockResourceOpenApi(deps, resource().resourceUrl)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValueOnce(identityAggregate()).mockResolvedValueOnce(null)
    await expect(
      createAccountConnection(
        deps,
        { context: 'access-request', accessRequestId: request.id, approvalToken: 'approval-token' },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Active Agent identity was not found')

    const organizationIdentity = {
      ...identityAggregate(),
      identity: {
        ...identityAggregate().identity,
        ownerUserId: null,
        ownerOrganizationId: 'org-1',
      },
    }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(organizationIdentity)
    Object.assign(deps.authorization, {
      findMemberByOrganizationUser: vi.fn().mockResolvedValue({ role: 'owner' }),
    })
    await expect(
      createAccountConnection(
        deps,
        { context: 'access-request', accessRequestId: request.id, approvalToken: 'approval-token' },
        'user-1',
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ owner: { type: 'organization', organizationId: 'org-1' } })

    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([
      { ...connectionRecord(), ownerUserId: null, ownerOrganizationId: 'org-1' },
      { ...connectionRecord(), id: 'wrong-resource', resourceId: 'resource-2' },
      { ...connectionRecord(), id: 'revoked', status: 'revoked' },
      { ...connectionRecord(), id: 'wrong-scope', grantedScopes: ['projects:write'] },
    ])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ items: [{ id: 'connection-1' }], pagination: { total: 1 } })
  })

  it('rejects invalid connection selections when approving first access', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const request = { ...requestRecord(), connectionId: null }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())

    await expect(
      decideAgentAccessRequest(deps, request.id, { decision: 'approve', mode: 'once' }, 'user-1'),
    ).rejects.toThrow('An account connection is required')

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      resourceId: 'resource-2',
    })
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        { decision: 'approve', mode: 'once', accountConnectionId: 'connection-1' },
        'user-1',
      ),
    ).rejects.toThrow('does not belong to this API resource')

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      grantedScopes: ['projects:write'],
    })
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        { decision: 'approve', mode: 'once', accountConnectionId: 'connection-1' },
        'user-1',
      ),
    ).rejects.toThrow('connected account boundary')

    const native = nativeResource()
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    mockResourceOpenApi(deps, native.resourceUrl)
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        { decision: 'approve', mode: 'once', accountConnectionId: 'connection-1' },
        'user-1',
      ),
    ).rejects.toThrow('Native API resources do not use account connections')
  })

  it('supports native resource discovery and access request wrappers', async () => {
    const deps = createTestDeps()
    const native = nativeResource()
    Object.assign(deps.authorization, {
      findResource: vi.fn().mockResolvedValue(native),
      listResources: vi.fn().mockResolvedValue({
        items: [native],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false, nextOffset: null },
      }),
      listEnabledResources: vi.fn().mockResolvedValue([native]),
      listAgentRoleAssignments: vi
        .fn()
        .mockResolvedValue([{ role: { id: 'role-1', key: 'projects-reader' }, scopes: ['projects:read'] }]),
    })
    mockResourceOpenApi(deps, native.resourceUrl)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([
      { ...grantRecord(), connectionId: null },
    ])
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      resources: [{ authorizationMode: 'native', connections: [], grants: [{ id: 'grant-1' }] }],
    })
    await expect(listAgentApiResources(deps, principal(), { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [
        {
          id: 'resource-1',
          scopes: [{ value: 'projects:read', description: 'Read projects' }],
          accountConnections: [],
          accessGrants: [{ id: 'grant-1' }],
        },
      ],
      pagination: { total: 1 },
    })
    const created = await createAccessRequest(
      deps,
      {
        target: { type: 'api-resource', apiResourceId: 'resource-1' },
        scopes: ['projects:read'],
        reason: 'Read projects',
      },
      principal(),
      'https://auth.example.com/',
    )
    expect(created).toMatchObject({
      target: { type: 'api-resource', apiResourceId: 'resource-1' },
      status: 'approved',
      approval: null,
      grantId: 'grant-1',
    })
    await expect(
      createAccessRequest(
        deps,
        {
          target: { type: 'api-resource', apiResourceId: 'resource-1' },
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com/',
      ),
    ).resolves.toMatchObject({ reason: null })
    const stored = vi.mocked(deps.externalResources.createAccessRequest).mock.calls[0]![0]
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(stored)
    await expect(getAgentAccessRequest(deps, stored.id, principal())).resolves.toMatchObject({ id: stored.id })
    await expect(getAccessRequest(deps, stored.id, principal())).resolves.toMatchObject({
      target: { type: 'api-resource', apiResourceId: 'resource-1' },
    })
  })

  it('discovers enabled resources independently of archived management pagination', async () => {
    const deps = createTestDeps()
    const active = nativeResource()
    const managementPage = vi.fn().mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) => ({
        ...nativeResource(),
        id: `archived-${index}`,
        archivedAt: now.toISOString(),
        enabled: false,
      })),
      pagination: { limit: 100, offset: 0, total: 101, hasMore: true, nextOffset: 100 },
    })
    Object.assign(deps.authorization, {
      findResource: vi.fn().mockResolvedValue(active),
      listResources: managementPage,
      listEnabledResources: vi.fn().mockResolvedValue([active]),
      listAgentRoleAssignments: vi.fn().mockResolvedValue([]),
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    mockResourceOpenApi(deps, active.resourceUrl)

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      resources: [{ id: active.id }],
    })
    expect(managementPage).not.toHaveBeenCalled()
  })

  it('[spec: agent-identity/agent-resource-discovery-isolation] marks one unavailable OpenAPI contract without hiding healthy resources', async () => {
    const deps = createTestDeps()
    const healthy = nativeResource()
    const unavailable = {
      ...nativeResource(),
      id: 'resource-unavailable',
      identifier: 'unavailable',
      resourceUrl: 'https://unavailable.example.com/api',
    }
    Object.assign(deps.authorization, {
      listResources: vi.fn().mockResolvedValue({
        items: [unavailable, healthy],
        pagination: { total: 2, limit: 100, offset: 0, hasMore: false, nextOffset: null },
      }),
      listEnabledResources: vi.fn().mockResolvedValue([unavailable, healthy]),
      findResource: vi.fn().mockImplementation(async (id) => {
        if (id === healthy.id) return healthy
        if (id === unavailable.id) return unavailable
        return null
      }),
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(null)
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
    mockResourceOpenApi(deps, healthy.resourceUrl)

    await expect(listAgentApiResources(deps, principal(), { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [
        { id: unavailable.id, status: 'unavailable', scopes: [] },
        { id: healthy.id, status: 'available', scopes: [{ value: 'projects:read' }] },
      ],
      pagination: { total: 2 },
    })
  })

  it('lists, reads, denies, and approves controlled access requests', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    const pendingExternal = requestRecord()
    const pendingNative = { ...requestRecord(), id: 'request-2', connectionId: null }
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([connectionRecord()])
    vi.mocked(deps.externalResources.listPendingAccessRequests).mockResolvedValue([pendingExternal, pendingNative])
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(pendingExternal)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(pendingExternal)

    await expect(listControllerAccessRequests(deps, 'user-1')).resolves.toMatchObject({
      requests: [{ id: 'request-1' }, { id: 'request-2' }],
    })
    await expect(listAccountAccessRequests(deps, 'user-1', { limit: 1, offset: 1 })).resolves.toMatchObject({
      items: [{ id: 'request-2' }],
      pagination: { total: 2 },
    })
    await expect(getAccountAccessRequest(deps, 'request-1', 'user-1')).resolves.toMatchObject({ id: 'request-1' })
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      id: 'request-1',
    })

    vi.mocked(deps.externalResources.decideAccessRequest).mockImplementation(async (_id, decision) => ({
      ...pendingExternal,
      ...decision,
    }))
    await expect(decideAgentAccessRequest(deps, 'request-1', { decision: 'deny' }, 'user-1')).resolves.toMatchObject({
      status: 'denied',
    })
    vi.mocked(deps.externalResources.createGrant).mockImplementation(async (record) => record)
    await expect(
      decideAccessRequest(
        deps,
        'request-1',
        {
          decision: 'approve',
          mode: 'until',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          approvalToken: 'approval-token',
        },
        'user-1',
      ),
    ).resolves.toMatchObject({ status: 'approved', grantId: expect.any(String) })
  })

  it('lists grants and revokes grants, identities, and binding leases', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([grantRecord()])
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      grantId: 'grant-1',
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.revokeGrant).mockResolvedValue(true)

    await expect(listAgentAccessGrants(deps, principal(), { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'grant-1', target: { accountConnectionId: 'connection-1' } }],
    })
    await expect(getAgentAccessGrant(deps, 'grant-1', principal())).resolves.toMatchObject({ id: 'grant-1' })
    await revokeAgentResourceAccess(deps, 'identity-1')
    expect(deps.externalResources.revokeGrant).toHaveBeenCalledWith('grant-1', expect.any(Date))

    const lease = {
      id: 'lease-1',
      grantId: 'grant-1',
      requestId: 'request-1',
      bindingId: 'binding-1',
      encryptedAccessToken: 'sealed:target-token',
      tokenHash: 'hash',
      confirmationJkt: 'jkt',
      scopes: ['projects:read'],
      expiresAt: new Date(Date.now() + 300_000),
      revokedAt: null,
      createdAt: now,
    }
    vi.mocked(deps.externalResources.listActiveTokenLeasesByBinding).mockResolvedValue([
      { ...lease, grantId: 'missing' },
      lease,
    ])
    vi.mocked(deps.externalResources.findGrant).mockResolvedValueOnce(null).mockResolvedValueOnce(grantRecord())
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    vi.mocked(deps.externalResources.revokeTokenLease).mockResolvedValue(true)
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response(null, { status: 200 }))
    await revokeAgentResourceLeasesForBinding(deps, 'binding-1')
    expect(deps.externalResources.revokeTokenLease).toHaveBeenCalledWith('lease-1', expect.any(Date))
  })

  it('issues Realmroot-native DPoP access tokens without a role [spec: agent-identity/agent-resource-access-without-role]', async () => {
    const deps = createTestDeps()
    const native = nativeResource()
    Object.assign(deps.authorization, {
      findResource: vi.fn().mockResolvedValue(native),
      listAgentRoleAssignments: vi.fn().mockResolvedValue([]),
    })
    mockResourceOpenApi(deps, native.resourceUrl)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
      ...identityAggregate(),
      identity: {
        ...identityAggregate().identity,
        ownerUserId: null,
        ownerOrganizationId: 'org-1',
      },
    })
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue({
      ...grantRecord(),
      connectionId: null,
      mode: 'once',
      expiresAt: new Date(Date.now() + 120_000),
    })
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      connectionId: null,
      status: 'approved',
      grantId: 'grant-1',
    })
    vi.mocked(deps.externalResources.createTokenLease).mockImplementation(async (record) => record)
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    const proof = await new SignJWT({
      htm: 'POST',
      htu: 'https://auth.example.com/api/access-grants/grant-1/tokens',
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
      .sign(privateKey)
    const sign = vi.fn().mockResolvedValue('native-access-token')

    await expect(
      issueTargetAccessToken(
        deps,
        'grant-1',
        proof,
        'https://auth.example.com/api/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).resolves.toMatchObject({
      accessToken: 'native-access-token',
      tokenType: 'DPoP',
      resourceUrl: native.resourceUrl,
    })
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'org-1',
        groups: ['org-1'],
        roles: [],
        act: expect.objectContaining({
          sub: 'host-1',
          act: expect.objectContaining({ sub: 'agt_stable' }),
        }),
      }),
      'at+jwt',
    )
  })

  it('rejects invalid external authorization discovery and client configuration', async () => {
    const configure = async ({
      protectedBody = {
        resource: resource().resourceUrl,
        authorization_servers: ['https://projects.example.com'],
      },
      serverBody = metadata(),
      protectedResponse,
      serverResponse,
      registrationResponse,
      input = { registrationMode: 'manual' as const, clientId: 'client', clientSecret: 'secret' },
      configuredResource = resource(),
    }: {
      protectedBody?: unknown
      serverBody?: unknown
      protectedResponse?: Response
      serverResponse?: Response
      registrationResponse?: Response
      input?: Parameters<typeof configureExternalResourceAuthorization>[2]
      configuredResource?: ApiResourceResponse | null
    }) => {
      const deps = createTestDeps()
      authorizationDeps(deps)
      vi.mocked(deps.authorization.findResource).mockResolvedValue(configuredResource)
      vi.mocked(deps.externalResources.configureAuthorization).mockImplementation(async (record) => record)
      const protocolResponses = [
        protectedResponse ?? Response.json(protectedBody),
        serverResponse ?? Response.json(serverBody),
        ...(registrationResponse ? [registrationResponse] : []),
      ]
      vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
        const resourceUrl = configuredResource?.resourceUrl ?? resource().resourceUrl
        if (request.url === new URL(resourceUrl).toString()) {
          return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
        }
        if (request.url === new URL('/openapi.json', resourceUrl).toString()) {
          return Response.json({ openapi: '3.1.0', paths: {} })
        }
        return protocolResponses.shift() ?? new Response(null, { status: 404 })
      })
      return configureExternalResourceAuthorization(deps, 'resource-1', input, 'https://auth.example.com/')
    }

    await expect(configure({ configuredResource: null })).rejects.toThrow('External API resource was not found.')
    await expect(configure({ configuredResource: { ...resource(), authorizationMode: 'native' } })).rejects.toThrow(
      'External API resource was not found.',
    )
    await expect(configure({ configuredResource: { ...resource(), archivedAt: now.toISOString() } })).rejects.toThrow(
      'Archived API resources must be restored before reconfiguration.',
    )
    await expect(
      configure({ configuredResource: { ...resource(), resourceUrl: 'http://projects.example.com/api' } }),
    ).rejects.toThrow('resource URL must use HTTPS')
    await expect(configure({ protectedResponse: new Response(null, { status: 503 }) })).rejects.toThrow(
      'Protected resource metadata discovery failed.',
    )
    await expect(configure({ protectedBody: [] })).rejects.toThrow('Protected resource metadata discovery failed.')
    await expect(
      configure({
        protectedBody: {
          resource: 'https://other.example.com/api',
          authorization_servers: ['https://projects.example.com'],
        },
      }),
    ).rejects.toThrow('does not match the configured resource URL')
    await expect(
      configure({ protectedBody: { resource: resource().resourceUrl, authorization_servers: [] } }),
    ).rejects.toThrow('exactly one authorization server')
    await expect(
      configure({ protectedBody: { resource: resource().resourceUrl, authorization_servers: [42] } }),
    ).rejects.toThrow('exactly one authorization server')
    await expect(
      configure({
        protectedBody: {
          resource: resource().resourceUrl,
          authorization_servers: ['https://one.example.com', 'https://two.example.com'],
        },
      }),
    ).rejects.toThrow('exactly one authorization server')
    await expect(
      configure({
        protectedBody: {
          resource: resource().resourceUrl,
          authorization_servers: ['http://projects.example.com'],
        },
      }),
    ).rejects.toThrow('authorization server issuer must use HTTPS')
    await expect(configure({ serverResponse: new Response(null, { status: 503 }) })).rejects.toThrow(
      'Authorization server metadata discovery failed.',
    )
    await expect(configure({ serverBody: { ...metadata(), issuer: 'https://wrong.example.com' } })).rejects.toThrow(
      'issuer does not match',
    )
    await expect(configure({ serverBody: { ...metadata(), token_endpoint: undefined } })).rejects.toThrow(
      'missing token_endpoint',
    )
    await expect(
      configure({ serverBody: { ...metadata(), authorization_endpoint: 'https://user:secret@example.com' } }),
    ).rejects.toThrow('authorization_endpoint must use HTTPS')
    await expect(configure({ serverBody: { ...metadata(), grant_types_supported: [] } })).rejects.toThrow(
      'Authorization server must support',
    )
    await expect(configure({ serverBody: { ...metadata(), dpop_signing_alg_values_supported: [] } })).rejects.toThrow(
      'must advertise RFC 9449 DPoP support',
    )
    await expect(
      configure({
        serverBody: { ...metadata(), registration_endpoint: undefined },
        input: { registrationMode: 'dynamic' },
      }),
    ).rejects.toThrow('does not support dynamic client registration')
    await expect(
      configure({
        input: { registrationMode: 'dynamic' },
        registrationResponse: new Response(null, { status: 400 }),
      }),
    ).rejects.toThrow('Dynamic client registration failed.')
    await expect(
      configure({
        input: { registrationMode: 'dynamic' },
        registrationResponse: new Response('not-json', { status: 201 }),
      }),
    ).rejects.toThrow('Dynamic client registration response is invalid.')
    await expect(
      configure({
        input: { registrationMode: 'dynamic' },
        registrationResponse: Response.json({ client_id: 'client' }, { status: 201 }),
      }),
    ).rejects.toThrow('missing client_secret')
    await expect(
      configure({ input: { registrationMode: 'manual', clientId: 'client', clientSecret: '' } }),
    ).rejects.toThrow('OAuth client is incomplete')
    await expect(configure({})).resolves.toMatchObject({
      registrationMode: 'manual',
      clientId: 'client',
      status: 'active',
    })
    await expect(
      configure({
        configuredResource: {
          ...resource(),
          resourceUrl: 'https://projects.example.com/',
        },
        protectedBody: {
          resource: 'https://projects.example.com/',
          authorization_servers: ['https://projects.example.com/tenant'],
        },
        serverBody: {
          ...metadata(),
          issuer: 'https://projects.example.com/tenant',
        },
      }),
    ).resolves.toMatchObject({ issuer: 'https://projects.example.com/tenant' })
  })

  it('enforces identity, resource, connection, and role scope boundaries on requests', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          connectionId: 'connection-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('active Agent identity')

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce(null)
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          connectionId: 'connection-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Enabled API resource')

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(null)
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          connectionId: 'connection-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Active resource account connection')

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      ownerUserId: 'another-user',
    })
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          connectionId: 'connection-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('outside the Agent home space')

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.authorization.listAgentRoleAssignments).mockResolvedValue([
      {
        role: {
          id: 'role-1',
          key: 'writer',
          name: 'Writer',
          description: null,
          resourceId: 'resource-1',
          organizationId: null,
          applicationId: null,
          system: false,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        scopes: ['projects:write'],
      },
    ])
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          connectionId: 'connection-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Agent roles do not permit')

    vi.mocked(deps.authorization.listAgentRoleAssignments).mockResolvedValue([
      {
        role: {
          id: 'role-1',
          key: 'reader',
          name: 'Reader',
          description: null,
          resourceId: 'resource-1',
          organizationId: null,
          applicationId: null,
          system: false,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        scopes: ['projects:read'],
      },
    ])
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      grantedScopes: ['openid'],
    })
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          connectionId: 'connection-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('connected account boundary')

    vi.mocked(deps.authorization.findResource).mockResolvedValue(nativeResource())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          connectionId: 'connection-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Native API resources do not use account connections')
  })

  it('[spec: agent-identity/agent-resource-access-without-role] allows an Agent without roles to request OpenAPI scopes', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.authorization.listAgentRoleAssignments).mockResolvedValue([])
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          connectionId: 'connection-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      status: 'pending',
      scopes: ['projects:read'],
    })
  })

  it('enforces controller ownership and request state boundaries', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(null)
    await expect(getAccountConnection(deps, 'missing', 'user-1')).rejects.toThrow(
      'Resource account connection was not found.',
    )
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      ownerUserId: 'another-user',
    })
    await expect(getAccountConnection(deps, 'connection-1', 'user-1')).rejects.toThrow(
      'Resource account controller access is required.',
    )
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(null)
    await expect(getAccountAccessRequest(deps, 'missing', 'user-1')).rejects.toThrow(
      'Agent access request was not found.',
    )
    await expect(getAgentAccessRequest(deps, 'missing', principal())).rejects.toThrow(
      'Agent access request was not found.',
    )

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      agentIdentityId: 'another-agent',
    })
    await expect(getAgentAccessRequest(deps, 'request-1', principal())).rejects.toThrow(
      'Agent access request was not found.',
    )
    await expect(
      createAccessRequest(
        deps,
        { target: { type: 'realmroot-management' }, scopes: [] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Unsupported access request target.')

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
    })
    await expect(decideAgentAccessRequest(deps, 'request-1', { decision: 'deny' }, 'user-1')).rejects.toThrow(
      'Pending Agent access request was not found.',
    )

    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(null)
    await expect(decideAgentAccessRequestByToken(deps, 'bad-token', { decision: 'deny' }, 'user-1')).rejects.toThrow(
      'Pending Agent access request was not found.',
    )
  })

  it('covers missing resource records and inactive discovery entries', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)

    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValueOnce(null)
    await expect(getExternalResourceAuthorization(deps, 'resource-1')).rejects.toThrow(
      'External API resource authorization was not found.',
    )
    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce(null)
    await expect(getApiResource(deps, 'missing')).rejects.toThrow('API resource was not found.')
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValueOnce(null)
    await expect(getApiResource(deps, 'resource-1')).resolves.toMatchObject({ authorization: null })
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(null)
    await expect(
      completeResourceConnectionIntent(deps, { state: 'invalid', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('Resource connection state is invalid')

    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([
      resource(),
      { ...nativeResource(), id: 'native' },
    ])
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(null)
    await expect(listConnectableExternalResources(deps)).resolves.toEqual({ resources: [] })
  })

  it('discovers organization resources while filtering invalid resources and expired grants', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const organizationIdentity = {
      ...identityAggregate(),
      identity: {
        ...identityAggregate().identity,
        ownerUserId: null,
        ownerOrganizationId: 'org-1',
      },
    }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(organizationIdentity)
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([
      {
        ...connectionRecord(),
        ownerUserId: null,
        ownerOrganizationId: 'org-1',
        externalSubject: 'abc',
      },
      { ...connectionRecord(), id: 'revoked', status: 'revoked' },
    ])
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([
      { ...grantRecord(), expiresAt: new Date(Date.now() - 1) },
      {
        ...grantRecord(),
        id: 'grant-live',
        expiresAt: new Date(Date.now() + 30_000),
        revokedAt: now,
      },
    ])
    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([
      resource(),
      { ...nativeResource(), id: 'missing' },
    ])
    vi.mocked(deps.authorization.findResource).mockImplementation(async (id) =>
      id === 'resource-1' ? resource() : null,
    )
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      resources: [
        {
          connections: [{ subjectHint: '••••' }],
          grants: [{ id: 'grant-live' }],
        },
      ],
    })
    await expect(listAgentApiResources(deps, principal(), { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [
        {
          accessGrants: [
            {
              id: 'grant-live',
              expiresAt: expect.any(String),
              revokedAt: expect.any(String),
            },
          ],
        },
      ],
    })
  })

  it('returns an approved request immediately for an exact active grant', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([
      { ...grantRecord(), connectionId: 'other-connection' },
      { ...grantRecord(), resourceId: 'other-resource' },
      { ...grantRecord(), scopes: ['projects:write'] },
      { ...grantRecord(), expiresAt: new Date(Date.now() - 1) },
      grantRecord(),
    ])
    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          connectionId: 'connection-1',
          scopes: ['projects:read'],
          reason: 'Scheduled synchronization',
        },
        principal(),
        'https://auth.example.com/',
      ),
    ).resolves.toMatchObject({
      status: 'approved',
      grantId: 'grant-1',
      reason: 'Scheduled synchronization',
      approvalUrl: null,
    })
  })

  it('rejects races, missing identities, invalid expiry, and mismatched approval tokens during decisions', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(requestRecord())
    vi.mocked(deps.externalResources.decideAccessRequest).mockResolvedValueOnce(null)
    await expect(decideAgentAccessRequest(deps, 'request-1', { decision: 'deny' }, 'user-1')).rejects.toThrow(
      'already decided',
    )

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValueOnce(null)
    await expect(
      decideAgentAccessRequest(deps, 'request-1', { decision: 'approve', mode: 'persistent' }, 'user-1'),
    ).rejects.toThrow('Active Agent identity was not found.')

    await expect(
      decideAgentAccessRequest(
        deps,
        'request-1',
        { decision: 'approve', mode: 'until', expiresAt: new Date(Date.now() - 1).toISOString() },
        'user-1',
      ),
    ).rejects.toThrow('Grant expiry must be in the future.')

    vi.mocked(deps.externalResources.createGrant).mockImplementation(async (record) => record)
    vi.mocked(deps.externalResources.decideAccessRequest).mockResolvedValue(null)
    await expect(
      decideAgentAccessRequest(deps, 'request-1', { decision: 'approve', mode: 'persistent' }, 'user-1'),
    ).rejects.toThrow('already decided')

    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(requestRecord())
    await expect(
      decideAccessRequest(deps, 'different-request', { decision: 'deny', approvalToken: 'approval-token' }, 'user-1'),
    ).rejects.toThrow('Agent access request was not found.')
    await expect(getAccountAccessRequest(deps, 'different-request', 'user-1', 'approval-token')).rejects.toThrow(
      'Agent access request was not found.',
    )
  })

  it('rejects invalid grants before issuing a target token', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    const signer = { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('token') }

    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(null)
    await expect(
      issueTargetAccessToken(deps, 'missing', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Active Agent access grant is required.')

    vi.mocked(deps.externalResources.findGrant).mockResolvedValue({
      ...grantRecord(),
      agentIdentityId: 'another-agent',
    })
    await expect(
      issueTargetAccessToken(deps, 'grant-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Active Agent access grant is required.')

    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue(null)
    await expect(
      issueTargetAccessToken(deps, 'grant-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Approved Agent access request is required.')

    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
    })
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue({
      ...grantRecord(),
      expiresAt: new Date(Date.now() - 1),
    })
    await expect(
      issueTargetAccessToken(deps, 'grant-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Active Agent access grant is required.')

    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(null)
    await expect(
      issueTargetAccessToken(deps, 'grant-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Active external API resource grant is required.')
  })

  it('rejects malformed, misbound, stale, and replayed native DPoP proofs', async () => {
    const deps = createTestDeps()
    const native = nativeResource()
    authorizationDeps(deps)
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    mockResourceOpenApi(deps, native.resourceUrl)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue({
      ...grantRecord(),
      connectionId: null,
      mode: 'persistent',
    })
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      connectionId: null,
      status: 'approved',
    })
    const signer = { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('native-token') }
    const tokenUrl = 'https://auth.example.com/api/access-grants/grant-1/tokens'

    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValueOnce({
      ...requestRecord(),
      connectionId: 'connection-1',
      status: 'approved',
    })
    await expect(issueTargetAccessToken(deps, 'grant-1', 'proof', tokenUrl, principal(), signer)).rejects.toThrow(
      'Native API resource grants cannot use account connections.',
    )
    await expect(
      issueTargetAccessToken(deps, 'grant-1', 'proof', tokenUrl, principal(), {
        ...signer,
        issuer: 'https://other.example.com',
      }),
    ).rejects.toThrow('does not belong to the active OAuth issuer')
    await expect(issueTargetAccessToken(deps, 'grant-1', 'not-a-jwt', tokenUrl, principal(), signer)).rejects.toThrow()

    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    const proof = async (
      payload: Record<string, unknown>,
      header: JWTHeaderParameters = { typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk },
    ) => new SignJWT(payload).setProtectedHeader(header).sign(privateKey)

    await expect(
      issueTargetAccessToken(
        deps,
        'grant-1',
        await proof({ htm: 'POST', htu: tokenUrl, jti: 'no-iat' }, { alg: 'ES256', jwk: publicJwk }),
        tokenUrl,
        principal(),
        signer,
      ),
    ).rejects.toThrow('public-key DPoP proof')
    await expect(
      issueTargetAccessToken(
        deps,
        'grant-1',
        await proof({ htm: 'GET', htu: tokenUrl, jti: 'wrong-method', iat: Math.floor(Date.now() / 1000) }),
        tokenUrl,
        principal(),
        signer,
      ),
    ).rejects.toThrow('not bound to the target token endpoint')
    await expect(
      issueTargetAccessToken(
        deps,
        'grant-1',
        await proof({ htm: 'POST', htu: tokenUrl, jti: 'stale', iat: 1 }),
        tokenUrl,
        principal(),
        signer,
      ),
    ).rejects.toThrow('outside the accepted time window')
    const signed = await proof({
      htm: 'POST',
      htu: tokenUrl,
      jti: 'tampered',
      iat: Math.floor(Date.now() / 1000),
    })
    const signedParts = signed.split('.')
    signedParts[2] = `${signedParts[2]!.startsWith('a') ? 'b' : 'a'}${signedParts[2]!.slice(1)}`
    await expect(
      issueTargetAccessToken(deps, 'grant-1', signedParts.join('.'), tokenUrl, principal(), signer),
    ).rejects.toThrow('DPoP proof signature is invalid.')

    vi.mocked(deps.agentTokens.consumeDpopJti).mockResolvedValue(false)
    await expect(
      issueTargetAccessToken(
        deps,
        'grant-1',
        await proof({
          htm: 'POST',
          htu: tokenUrl,
          jti: 'replayed',
          iat: Math.floor(Date.now() / 1000),
        }),
        tokenUrl,
        principal(),
        signer,
      ),
    ).rejects.toThrow('already used')

    vi.mocked(deps.agentTokens.consumeDpopJti).mockResolvedValue(true)
    await expect(
      issueTargetAccessToken(
        deps,
        'grant-1',
        await proof({
          htm: 'POST',
          htu: tokenUrl,
          jti: 'valid-user-proof',
          iat: Math.floor(Date.now() / 1000),
        }),
        tokenUrl,
        principal(),
        signer,
      ),
    ).resolves.toMatchObject({ accessToken: 'native-token' })
  })

  it('enforces organization controllers and handles revocation error paths', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    Object.assign(deps.authorization, {
      findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
    })
    await expect(
      createResourceConnectionIntent(
        deps,
        'resource-1',
        { owner: { type: 'organization', organizationId: 'org-1' }, scopes: [] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Organization credential manager access is required.')

    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue({
      ...authorizationRecord(),
      status: 'invalid',
    })
    await expect(
      createResourceConnectionIntent(
        deps,
        'resource-1',
        { owner: { type: 'user' }, scopes: [] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Active external API resource authorization was not found.')

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(null)
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      connectionId: null,
    })
    await expect(getAccountAccessRequest(deps, 'request-1', 'user-1')).rejects.toThrow(
      'Agent controller access is required.',
    )

    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(null)
    await expect(revokeAgentAccessGrant(deps, 'missing', 'user-1')).rejects.toThrow('Agent access grant was not found.')
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue(null)
    await expect(revokeAgentAccessGrant(deps, 'grant-1', 'user-1')).rejects.toThrow(
      'Approved Agent access request was not found.',
    )

    vi.mocked(deps.authorization.findResource).mockResolvedValue(nativeResource())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([
      { ...grantRecord(), connectionId: null },
    ])
    vi.mocked(deps.externalResources.listActiveTokenLeasesByGrant).mockResolvedValue([
      {
        id: 'lease-native',
        grantId: 'grant-1',
        requestId: 'request-1',
        bindingId: 'binding-1',
        encryptedAccessToken: 'sealed:native',
        tokenHash: 'hash',
        confirmationJkt: 'jkt',
        scopes: ['projects:read'],
        expiresAt: new Date(Date.now() + 30_000),
        revokedAt: null,
        createdAt: now,
      },
    ])
    await revokeAgentResourceAccess(deps, 'identity-1')
    expect(deps.externalResources.revokeTokenLease).toHaveBeenCalledWith('lease-native', expect.any(Date))
  })

  it('rejects unknown grants and missing host bindings in account views', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue({
      ...grantRecord(),
      agentIdentityId: 'another-agent',
    })
    await expect(getAgentAccessGrant(deps, 'grant-1', principal())).rejects.toThrow('Agent access grant was not found.')

    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(requestRecord())
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
      ...identityAggregate(),
      bindings: [],
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).rejects.toThrow(
      'Agent host binding was not found.',
    )
  })
})

function authorizationDeps(deps: ReturnType<typeof createTestDeps>) {
  Object.assign(deps.authorization, {
    findResource: vi.fn().mockResolvedValue(resource()),
    listResources: vi.fn().mockResolvedValue({ items: [resource()], total: 1, limit: 100, offset: 0 }),
    listEnabledResources: vi.fn().mockResolvedValue([resource()]),
    listAgentRoleAssignments: vi.fn().mockResolvedValue([
      {
        role: {
          id: 'role-1',
          key: 'projects-reader',
          name: 'Projects reader',
          description: null,
          resourceId: 'resource-1',
          organizationId: null,
          applicationId: null,
          system: false,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        scopes: ['projects:read'],
      },
    ]),
    updateResource: vi.fn().mockResolvedValue(true),
  })
  vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
  mockResourceOpenApi(deps, resource().resourceUrl)
}

function resource(): ApiResourceResponse {
  return {
    id: 'resource-1',
    identifier: 'projects',
    name: 'Projects API',
    resourceUrl: 'https://projects.example.com/api',
    authorizationMode: 'external',
    description: 'Manage private projects',
    enabled: true,
    archivedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

function nativeResource(): ApiResourceResponse {
  return {
    ...resource(),
    authorizationMode: 'native',
    resourceUrl: 'https://auth.example.com/api/projects',
  }
}

function metadata() {
  return {
    issuer: 'https://projects.example.com',
    authorization_endpoint: 'https://projects.example.com/authorize',
    token_endpoint: 'https://projects.example.com/token',
    registration_endpoint: 'https://projects.example.com/register',
    revocation_endpoint: 'https://projects.example.com/revoke',
    jwks_uri: 'https://projects.example.com/jwks',
    userinfo_endpoint: 'https://projects.example.com/userinfo',
    scopes_supported: ['openid', 'offline_access', 'projects:read'],
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ],
    dpop_signing_alg_values_supported: ['ES256'],
  }
}

function authorizationRecord(): ExternalResourceAuthorizationRecord {
  return {
    resourceId: 'resource-1',
    resourceUrl: 'https://projects.example.com/api',
    issuer: 'https://projects.example.com',
    authorizationEndpoint: 'https://projects.example.com/authorize',
    tokenEndpoint: 'https://projects.example.com/token',
    registrationEndpoint: 'https://projects.example.com/register',
    revocationEndpoint: 'https://projects.example.com/revoke',
    jwksUri: 'https://projects.example.com/jwks',
    userInfoEndpoint: 'https://projects.example.com/userinfo',
    registrationMode: 'dynamic',
    clientId: 'realmroot-client',
    encryptedClientSecret: 'sealed:target-secret',
    encryptedRegistrationAccessToken: null,
    metadata: metadata(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

function mockResourceOpenApi(deps: ReturnType<typeof createTestDeps>, resourceUrl: string) {
  vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
    if (request.url === resourceUrl) {
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    if (request.url === new URL('/openapi.json', resourceUrl).toString()) {
      return Response.json({
        openapi: '3.1.0',
        components: {
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: {
                authorizationCode: {
                  authorizationUrl: 'https://projects.example.com/authorize',
                  tokenUrl: 'https://projects.example.com/token',
                  scopes: { 'projects:read': 'Read projects' },
                },
              },
            },
          },
        },
        paths: {
          '/projects': {
            get: { security: [{ oauth: ['projects:read'] }], responses: {} },
          },
        },
      })
    }
    return new Response(null, { status: 404 })
  })
}

function connectionRecord(): ResourceAccountConnectionRecord {
  return {
    id: 'connection-1',
    resourceId: 'resource-1',
    ownerUserId: 'user-1',
    ownerOrganizationId: null,
    externalSubject: 'target-user-1',
    displayName: 'Project Owner',
    encryptedTokens: 'sealed:{"accessToken":"subject","refreshToken":"refresh"}',
    grantedScopes: ['openid', 'offline_access', 'projects:read'],
    status: 'active',
    credentialExpiresAt: new Date(Date.now() + 300_000),
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function identityAggregate(): AgentIdentityAggregate {
  return {
    identity: {
      id: 'identity-1',
      issuer: 'https://auth.example.com/api/auth',
      subject: 'agt_stable',
      name: 'Project Agent',
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
  }
}

function principal() {
  return {
    issuer: 'https://auth.example.com/api/auth',
    subject: 'agt_stable',
    identityId: 'identity-1',
    protocolAgentId: 'protocol-agent-1',
    hostId: 'host-1',
  }
}

function requestRecord(): AgentAccessRequestRecord {
  return {
    id: 'request-1',
    resourceId: 'resource-1',
    connectionId: 'connection-1',
    agentIdentityId: 'identity-1',
    bindingId: 'binding-1',
    scopes: ['projects:read'],
    reason: null,
    status: 'pending',
    approvalTokenHash: 'hash',
    encryptedApprovalToken: 'sealed:approval-token',
    grantId: null,
    expiresAt: new Date(Date.now() + 300_000),
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function grantRecord(): AgentAccessGrantRecord {
  return {
    id: 'grant-1',
    resourceId: 'resource-1',
    connectionId: 'connection-1',
    agentIdentityId: 'identity-1',
    scopes: ['projects:read'],
    mode: 'once',
    status: 'active',
    grantedByUserId: 'user-1',
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}
