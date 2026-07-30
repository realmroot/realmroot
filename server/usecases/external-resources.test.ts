import { createTestDeps } from '@server/http/test-deps'
import {
  completeResourceConnectionIntent,
  configureExternalResourceAuthorization,
  createAccessRequest,
  createAccountConnection,
  createAgentAccessRequest,
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
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const now = new Date('2026-07-29T12:00:00.000Z')

describe('external API resource authorization', () => {
  it('discovers and registers a protocol-only target [spec: agent-identity/external-api-resource-registration]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
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
        return Response.json({ client_id: 'realmroot-client', client_secret: 'target-secret' }, { status: 201 })
      }
      return new Response(null, { status: 404 })
    })
    vi.mocked(deps.externalResources.upsertAuthorization).mockImplementation(async (record) => record)

    await expect(
      configureExternalResourceAuthorization(
        deps,
        'resource-1',
        { registrationMode: 'dynamic' },
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      resourceId: 'resource-1',
      issuer: 'https://projects.example.com',
      registrationMode: 'dynamic',
      clientId: 'realmroot-client',
      clientSecretConfigured: true,
      status: 'active',
    })
    expect(deps.connectors.create).not.toHaveBeenCalled()
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
  })

  it('discovers accounts and deduplicates an exact JIT request [spec: agent-identity/agent-resource-discovery]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const connection = connectionRecord()
    const identity = identityAggregate()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identity)
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([connection])
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection)
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
          connections: [{ id: 'connection-1', subjectHint: '••••er-1', grantedScopes: ['projects:read'] }],
        },
      ],
    })
    const first = await createAgentAccessRequest(
      deps,
      { resourceId: 'resource-1', connectionId: 'connection-1', scopes: ['projects:read'], reason: 'Read projects' },
      principal(),
      'https://auth.example.com',
    )
    const repeated = await createAgentAccessRequest(
      deps,
      { resourceId: 'resource-1', connectionId: 'connection-1', scopes: ['projects:read'], reason: 'Repeated' },
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
    const request = requestRecord()
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
      { decision: 'approve', mode: 'once' },
      'user-1',
    )
    expect(decided).toMatchObject({ status: 'approved', hostId: 'host-1', scopes: ['projects:read'] })
    expect(deps.externalResources.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'once', scopes: ['projects:read'], grantedByUserId: 'user-1' }),
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
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
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
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (outbound) => {
      if (outbound.url === resource().resourceUrl || outbound.url === 'https://projects.example.com/openapi.json') {
        return openApiFetch(outbound)
      }
      expect(outbound.url).toBe('https://projects.example.com/token')
      const form = new URLSearchParams(await outbound.text())
      tokenRequests.push(form)
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
      expect(form.get('subject_token')).toBe('subject')
      expect(form.get('actor_token')).toBe('target-agent-access')
      expect(form.get('actor_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token')
      expect(form.get('scope')).toBe('projects:read')
      return Response.json({
        access_token: 'target-dpop-access',
        token_type: 'DPoP',
        expires_in: 300,
        scope: 'projects:read',
      })
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
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ])
    expect(lease).toEqual({
      accessToken: 'target-dpop-access',
      tokenType: 'DPoP',
      expiresIn: 300,
      expiresAt: expect.any(String),
      scopes: ['projects:read'],
      apiResource: 'https://projects.example.com/api',
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

  it('supports native resource discovery and access request wrappers', async () => {
    const deps = createTestDeps()
    const native = nativeResource()
    Object.assign(deps.authorization, {
      findResource: vi.fn().mockResolvedValue(native),
      listResources: vi.fn().mockResolvedValue({
        items: [native],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false, nextOffset: null },
      }),
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
      items: [{ id: 'resource-1', accountConnections: [], accessGrants: [{ id: 'grant-1' }] }],
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
      status: 'pending',
      approval: { url: expect.stringContaining('/agent/resource-access/approve#token=') },
      grantId: null,
    })
    const stored = vi.mocked(deps.externalResources.createAccessRequest).mock.calls[0]![0]
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(stored)
    await expect(getAgentAccessRequest(deps, stored.id, principal())).resolves.toMatchObject({ id: stored.id })
    await expect(getAccessRequest(deps, stored.id, principal())).resolves.toMatchObject({
      target: { type: 'api-resource', apiResourceId: 'resource-1' },
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

  it('issues Realmroot-native DPoP access tokens', async () => {
    const deps = createTestDeps()
    const native = nativeResource()
    Object.assign(deps.authorization, {
      findResource: vi.fn().mockResolvedValue(native),
      listAgentRoleAssignments: vi
        .fn()
        .mockResolvedValue([{ role: { id: 'role-1', key: 'projects-reader' }, scopes: ['projects:read'] }]),
    })
    mockResourceOpenApi(deps, native.resourceUrl)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue({
      ...grantRecord(),
      connectionId: null,
      mode: 'persistent',
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
      apiResource: native.audience,
    })
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-1',
        act: expect.objectContaining({
          sub: 'host-1',
          act: expect.objectContaining({ sub: 'agt_stable' }),
        }),
      }),
      'at+jwt',
    )
  })
})

function authorizationDeps(deps: ReturnType<typeof createTestDeps>) {
  Object.assign(deps.authorization, {
    findResource: vi.fn().mockResolvedValue(resource()),
    listResources: vi.fn().mockResolvedValue({ items: [resource()], total: 1, limit: 100, offset: 0 }),
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
    updateResource: vi.fn().mockResolvedValue(undefined),
  })
  vi.mocked(deps.externalResources.findAuthorization).mockResolvedValue(authorizationRecord())
  mockResourceOpenApi(deps, resource().resourceUrl)
}

function resource(): ApiResourceResponse {
  return {
    id: 'resource-1',
    identifier: 'projects',
    name: 'Projects API',
    audience: 'https://projects.example.com/api',
    resourceUrl: 'https://projects.example.com/api',
    authorizationMode: 'external',
    description: null,
    enabled: true,
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
