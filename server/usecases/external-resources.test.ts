import { createTestDeps } from '@server/http/test-deps'
import {
  completeResourceConnectionIntent,
  createAccessRequest,
  createAccessRequestCredential,
  createAccountConnection,
  createAgentAccessRequest,
  createAgentConnectionRequest as createAgentResourceConnectionRequest,
  createResourceConnectionIntent,
  decideAccessRequest,
  decideAgentAccessRequest,
  decideAgentAccessRequestByToken,
  discoverAgentResources,
  failResourceConnectionIntent,
  getAccessRequest,
  getAccountAccessRequest,
  getAccountAccessRequestByToken,
  getAccountConnection,
  getAccountResourceConnectionApproval,
  getAgentAccessGrant,
  getAgentAccessRequest,
  getAgentConnectionRequest as getAgentResourceConnectionActivation,
  getAgentResourceServer,
  getAgentResourceServerResource,
  getApiResource,
  getControllerAccessRequestByToken,
  getExternalResourceAuthorization,
  issueTargetAccessToken,
  listAccessRequestConnections,
  listAccountAccessRequestAuthorizationDetailCatalog,
  listAccountAccessRequests,
  listAccountConnections,
  listAgentAccessGrants,
  listAgentResourceServers as listAgentApiResources,
  listAgentResourceServerResources as listAgentAuthorizationDetailCatalog,
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
  ConnectorRecord,
  ResourceAccountConnectionRecord,
  ResourceConnectionIntentRecord,
} from '@server/usecases/ports'
import { validateExternalResourceConnector } from '@server/usecases/resource-connectors'
import { protectedResourceMetadataUrl } from '@server/usecases/resource-metadata'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { exportJWK, generateKeyPair, type JWTHeaderParameters, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const now = new Date('2026-07-29T12:00:00.000Z')

describe('external API resource authorization', () => {
  it('rejects an archived external resource connection intent', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...resource(),
      archivedAt: now.toISOString(),
    })

    await expect(
      createResourceConnectionIntent(
        deps,
        'resource-1',
        { owner: { type: 'user' }, scopes: [] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Enabled external API resource was not found.')
  })

  it('validates a reusable OIDC connector when creating an external resource [spec: agent-identity/external-api-resource-registration]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
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
          scopes_supported: ['projects:read'],
        })
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      validateExternalResourceConnector(deps, 'https://projects.example.com/api', 'connector-1'),
    ).resolves.toMatchObject({ scopesSupported: ['projects:read'] })
  })

  it('rejects a connector whose issuer does not authorize the resource', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
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
          authorization_servers: ['https://different.example.com'],
          scopes_supported: ['projects:read'],
        })
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      validateExternalResourceConnector(deps, 'https://projects.example.com/api', 'connector-1'),
    ).rejects.toThrow('authorization server does not match')
  })

  it('connects the user account with authorization code and PKCE [spec: agent-identity/resource-account-connection]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
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
    expect(vi.mocked(deps.externalResources.createConnectionIntent).mock.calls[0]![0].clientGeneration).toBe(1)
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('prompt')).toBe('consent')
    expect(authorizationUrl.searchParams.get('resource')).toBe('https://projects.example.com/api')
    vi.mocked(deps.externalResources.createConnectionIntent).mockResolvedValueOnce(null)
    await expect(
      createResourceConnectionIntent(
        deps,
        'resource-1',
        { owner: { type: 'user' }, scopes: ['projects:read'] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Enabled external API resource was not found.')
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
    expect(stored.clientGeneration).toBe(1)
    expect(stored.encryptedTokens).not.toContain('subject-refresh')

    intent = {
      ...intent!,
      id: 'organization-connection',
      ownerUserId: null,
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

    intent = { ...intent!, id: 'subject-fallback-connection', ownerUserId: 'user-1', ownerOrganizationId: null }
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url.endsWith('/token')) {
        return Response.json({
          access_token: 'fallback-access',
          refresh_token: 'fallback-refresh',
          token_type: 'Bearer',
        })
      }
      if (request.url.endsWith('/userinfo')) return Response.json({ sub: 'subject-only' })
      return new Response(null, { status: 404 })
    })
    await expect(
      completeResourceConnectionIntent(
        deps,
        { state: 'subject-fallback-state', code: 'subject-fallback-code' },
        'https://auth.example.com/',
      ),
    ).resolves.toMatchObject({ displayName: 'subject-only' })

    vi.mocked(deps.externalResources.createConnection).mockResolvedValueOnce(null)
    await expect(
      completeResourceConnectionIntent(
        deps,
        { state: 'archived-state', code: 'archived-code' },
        'https://auth.example.com/',
      ),
    ).rejects.toThrow('archived while completing the connection')
  })

  it('preserves a same-subject connection identity while switching only it to a new client generation', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const existing = { ...connectionRecord(), clientGeneration: 1 }
    const intent: ResourceConnectionIntentRecord = {
      id: 'intent-generation-2',
      stateHash: 'state-hash',
      resourceId: 'resource-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      initiatedByUserId: 'user-1',
      scopes: ['openid', 'offline_access', 'projects:read'],
      authorizationDetails: [],
      encryptedPkceVerifier: 'sealed:verifier',
      clientGeneration: 2,
      returnTo: 'account-center',
      status: 'completed',
      expiresAt: new Date(Date.now() + 60_000),
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord({ clientGeneration: 2 }))
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(intent)
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(existing)
    const coveredGrant = grantRecord()
    const uncoveredGrant = { ...grantRecord(), id: 'grant-write', scopes: ['projects:write'] }
    vi.mocked(deps.externalResources.listActiveGrantsByConnection).mockResolvedValue([coveredGrant, uncoveredGrant])
    vi.mocked(deps.externalResources.revokeGrant).mockResolvedValue(true)
    vi.mocked(deps.externalResources.replaceConnectionAuthorization).mockImplementation(
      async (id, resourceId, input) => ({
        ...existing,
        ...input,
        id,
        resourceId,
      }),
    )
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url.endsWith('/token')) {
        return Response.json({
          access_token: 'generation-2-access',
          refresh_token: 'generation-2-refresh',
          token_type: 'Bearer',
          scope: 'openid offline_access projects:read',
        })
      }
      if (request.url.endsWith('/userinfo')) {
        return Response.json({ sub: existing.externalSubject, name: existing.displayName })
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).resolves.toMatchObject({ id: existing.id, externalSubject: existing.externalSubject })
    expect(deps.externalResources.replaceConnectionAuthorization).toHaveBeenCalledWith(
      existing.id,
      existing.resourceId,
      expect.objectContaining({ clientGeneration: 2 }),
    )
    expect(deps.externalResources.revokeGrant).not.toHaveBeenCalledWith(coveredGrant.id, expect.any(Date))
    expect(deps.externalResources.revokeGrant).toHaveBeenCalledWith(uncoveredGrant.id, expect.any(Date))
    expect(deps.externalResources.revokeConnection).not.toHaveBeenCalled()
  })

  it('[spec: agent-identity/external-resource-rich-authorization-connection] uses PAR and stores enriched authorization details', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const templates = [{ type: 'project_access', actions: ['read'] }]
    const granted = [
      { type: 'project_access', actions: ['read'], identifier: 'project-1' },
      { identifier: 'project-2', actions: ['read'], type: 'project_access' },
    ]
    vi.mocked(deps.authorization.findResource).mockResolvedValue({ ...resource(), authorizationDetails: templates })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerMetadata: {
          ...metadata(),
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://projects.example.com/par',
          authorization_details_catalog_endpoint: 'https://projects.example.com/authorization-details',
          authorization_details_catalog_scope: 'authorization-details:read',
          authorization_details_catalog_version: 1,
        },
      }),
    )
    const openApiFetch = vi.mocked(deps.externalHttp.fetch).getMockImplementation()!
    let intent: ResourceConnectionIntentRecord | null = null
    let tokenAuthorizationDetails: unknown = granted
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => {
      intent = record
      return record
    })
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockImplementation(async () => intent)
    vi.mocked(deps.externalResources.createConnection).mockImplementation(async (record) => record)
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url === resource().resourceUrl || request.url === 'https://projects.example.com/openapi.json') {
        return openApiFetch(request)
      }
      if (request.url === 'https://projects.example.com/par') {
        const form = new URLSearchParams(await request.text())
        expect(request.method).toBe('POST')
        expect(request.headers.get('authorization')).toMatch(/^Basic /)
        expect(JSON.parse(form.get('authorization_details')!)).toEqual(templates)
        expect(form.get('prompt')).toBe('consent')
        expect(form.get('state')).toBeTruthy()
        return Response.json(
          { request_uri: 'urn:ietf:params:oauth:request_uri:rar-1', expires_in: 90 },
          { status: 201 },
        )
      }
      if (request.url.endsWith('/token')) {
        return Response.json({
          access_token: 'subject-access',
          refresh_token: 'subject-refresh',
          token_type: 'Bearer',
          scope: 'openid offline_access projects:read',
          authorization_details: tokenAuthorizationDetails,
        })
      }
      if (request.url.endsWith('/userinfo')) return Response.json({ sub: 'target-user-1', name: 'Project Owner' })
      return new Response(null, { status: 404 })
    })

    const started = await createResourceConnectionIntent(
      deps,
      'resource-1',
      { owner: { type: 'user' }, scopes: ['projects:read'] },
      'user-1',
      'https://auth.example.com',
    )
    const authorizationUrl = new URL(started.authorizationUrl)
    expect([...authorizationUrl.searchParams.keys()].sort()).toEqual(['client_id', 'request_uri'])
    expect(authorizationUrl.searchParams.get('request_uri')).toBe('urn:ietf:params:oauth:request_uri:rar-1')
    expect(new Date(started.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000)
    expect(deps.externalResources.createConnectionIntent).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationDetails: templates }),
    )

    await expect(
      completeResourceConnectionIntent(
        deps,
        { state: 'rar-state', code: 'authorization-code' },
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ authorizationDetails: granted })
    expect(deps.externalResources.createConnection).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationDetails: granted }),
    )

    tokenAuthorizationDetails = [{ type: 'unknown_context', identifier: 'project-1' }]
    await expect(
      completeResourceConnectionIntent(deps, { state: 'unknown-state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })
    tokenAuthorizationDetails = [{ identifier: 'missing-type' }]
    await expect(
      completeResourceConnectionIntent(deps, { state: 'malformed-state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })
  })

  it('rejects unsupported RAR connection metadata and preserves PAR OAuth errors', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const templates = [{ type: 'project_access', actions: ['read'] }]
    vi.mocked(deps.authorization.findResource).mockResolvedValue({ ...resource(), authorizationDetails: templates })

    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerMetadata: { ...metadata(), authorization_details_types_supported: ['project_access'] },
      }),
    )
    await expect(
      createResourceConnectionIntent(
        deps,
        'resource-1',
        { owner: { type: 'user' }, scopes: ['projects:read'] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerMetadata: {
          ...metadata(),
          authorization_details_types_supported: [],
          pushed_authorization_request_endpoint: 'https://projects.example.com/par',
        },
      }),
    )
    await expect(
      createResourceConnectionIntent(
        deps,
        'resource-1',
        { owner: { type: 'user' }, scopes: ['projects:read'] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerMetadata: {
          ...metadata(),
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://projects.example.com/par',
          authorization_details_catalog_endpoint: 'https://projects.example.com/authorization-details',
          authorization_details_catalog_scope: 'authorization-details:read',
          authorization_details_catalog_version: 1,
        },
      }),
    )
    const openApiFetch = vi.mocked(deps.externalHttp.fetch).getMockImplementation()!
    let parFailure = () =>
      Response.json(
        { error: 'invalid_authorization_details', error_description: 'Unknown project context.' },
        { status: 400 },
      )
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url === resource().resourceUrl || request.url === 'https://projects.example.com/openapi.json') {
        return openApiFetch(request)
      }
      return parFailure()
    })
    await expect(
      createResourceConnectionIntent(
        deps,
        'resource-1',
        { owner: { type: 'user' }, scopes: ['projects:read'] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({
      error: 'invalid_authorization_details',
      errorDescription: 'Unknown project context.',
    })
    parFailure = () => new Response('not json', { status: 302 })
    await expect(
      createResourceConnectionIntent(
        deps,
        'resource-1',
        { owner: { type: 'user' }, scopes: ['projects:read'] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({
      status: 400,
      error: 'invalid_request',
      errorDescription: 'External authorization server rejected the pushed authorization request.',
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
      initiatedByUserId: 'user-1',
      scopes: ['offline_access', 'openid', 'projects:read', 'projects:write'],
      authorizationDetails: [],
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
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(existing)
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
    expect(deps.externalResources.findConnectionByOwnerResource).toHaveBeenCalledWith({
      resourceId: 'resource-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
    })
    expect(deps.externalResources.replaceConnectionAuthorization).toHaveBeenCalledWith(
      'connection-1',
      'resource-1',
      expect.objectContaining({
        externalSubject: 'target-user-1',
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

  it('[spec: agent-identity/external-resource-rich-authorization-reauthorization] revokes grants no longer covered after reauthorization', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const template = [{ type: 'project_access', actions: ['read'] }]
    const retained = [{ type: 'project_access', identifier: 'project-1', actions: ['read'] }]
    const removed = [{ type: 'project_access', identifier: 'project-2', actions: ['read'] }]
    vi.mocked(deps.authorization.findResource).mockResolvedValue({ ...resource(), authorizationDetails: template })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerMetadata: {
          ...metadata(),
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://projects.example.com/par',
        },
      }),
    )
    const intent: ResourceConnectionIntentRecord = {
      id: 'reauthorization-intent',
      stateHash: 'state-hash',
      resourceId: 'resource-1',
      ownerUserId: null,
      ownerOrganizationId: 'org-1',
      initiatedByUserId: 'user-1',
      scopes: ['offline_access', 'openid', 'projects:read'],
      authorizationDetails: template,
      encryptedPkceVerifier: 'sealed:pkce-verifier',
      returnTo: 'account-center',
      status: 'completed',
      expiresAt: new Date(Date.now() + 300_000),
      completedAt: new Date(),
      createdAt: now,
      updatedAt: now,
    }
    const existing = {
      ...connectionRecord(),
      ownerUserId: null,
      ownerOrganizationId: 'org-1',
      authorizationDetails: [...retained, ...removed],
    }
    const staleGrant = { ...grantRecord(), authorizationDetails: removed }
    const staleScopeGrant = { ...grantRecord(), id: 'stale-scope-grant', scopes: ['projects:write'] }
    const missingContextGrant = { ...grantRecord(), id: 'missing-context-grant', authorizationDetails: [] }
    const retainedGrant = { ...grantRecord(), id: 'retained-grant', authorizationDetails: retained }
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(intent)
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(existing)
    vi.mocked(deps.externalResources.replaceConnectionAuthorization).mockImplementation(
      async (id, _resourceId, input) => ({ ...existing, ...input, id }),
    )
    vi.mocked(deps.externalResources.listActiveGrantsByConnection).mockResolvedValue([
      retainedGrant,
      staleGrant,
      staleScopeGrant,
      missingContextGrant,
    ])
    vi.mocked(deps.externalResources.listActiveTokenLeasesByGrant).mockResolvedValue([])
    vi.mocked(deps.externalResources.revokeGrant).mockResolvedValue(true)
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url.endsWith('/token')) {
        return Response.json({
          access_token: 'replacement-access',
          refresh_token: 'replacement-refresh',
          token_type: 'Bearer',
          scope: 'openid offline_access projects:read',
          authorization_details: retained,
        })
      }
      if (request.url.endsWith('/userinfo')) return Response.json({ sub: 'target-user-1' })
      return new Response(null, { status: 404 })
    })

    await completeResourceConnectionIntent(
      deps,
      { state: 'reauthorization-state', code: 'authorization-code' },
      'https://auth.example.com',
    )
    expect(deps.externalResources.revokeGrant).toHaveBeenCalledWith(staleGrant.id, expect.any(Date))
    expect(deps.externalResources.revokeGrant).toHaveBeenCalledWith(staleScopeGrant.id, expect.any(Date))
    expect(deps.externalResources.revokeGrant).toHaveBeenCalledWith(missingContextGrant.id, expect.any(Date))
    expect(deps.externalResources.revokeGrant).not.toHaveBeenCalledWith(retainedGrant.id, expect.any(Date))
    expect(deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_resource.access_revoked',
        ownerUserId: null,
        ownerOrganizationId: 'org-1',
        reasonCode: 'connection_authorization_changed',
        metadata: { authorizationDetails: [{ type: 'project_access', identifier: 'project-2' }] },
      }),
    )
  })

  it('rejects connecting a different external account while the resource already has an active account', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue({
      id: 'replacement-intent',
      stateHash: 'state-hash',
      resourceId: 'resource-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      initiatedByUserId: 'user-1',
      scopes: ['offline_access', 'openid', 'projects:read'],
      authorizationDetails: [],
      encryptedPkceVerifier: 'sealed:pkce-verifier',
      returnTo: 'access-approval',
      status: 'completed',
      expiresAt: new Date(Date.now() + 300_000),
      completedAt: new Date(),
      createdAt: now,
      updatedAt: now,
    })
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url.endsWith('/token')) {
        return Response.json({
          access_token: 'another-access',
          refresh_token: 'another-refresh',
          token_type: 'Bearer',
          scope: 'openid offline_access projects:read',
        })
      }
      if (request.url.endsWith('/userinfo')) {
        return Response.json({ sub: 'another-target-user', name: 'Another Project Owner' })
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      completeResourceConnectionIntent(
        deps,
        { state: 'replacement-state', code: 'replacement-code' },
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Disconnect the current resource account before connecting another account.')
    expect(deps.externalResources.replaceConnectionAuthorization).not.toHaveBeenCalled()
    expect(deps.externalResources.createConnection).not.toHaveBeenCalled()
  })

  it(`discovers an external resource and requests a connection before exact access
      [spec: agent-identity/agent-resource-discovery]
      [spec: agent-identity/external-resource-first-access]
      [spec: agent-identity/agent-resource-connection-ensure]`, async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const identity = identityAggregate()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identity)
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([])
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      resources: [
        {
          id: 'resource-1',
          description: 'Manage private projects',
          scopes: expect.arrayContaining([{ value: 'projects:read', description: 'Read projects' }]),
          connection: { status: 'not_connected', displayName: null, authorizedScopes: [] },
        },
      ],
    })
    const request = await createAgentResourceConnectionRequest(
      deps,
      'resource-1',
      { scopes: ['projects:read'], reason: 'Read projects' },
      principal(),
      'https://auth.example.com',
    )
    expect(request).toMatchObject({ status: 'pending' })
    expect(request).not.toHaveProperty('accountConnectionId')
    expect(request.interaction.url).toContain('/agent/resource-connection/approve#token=')
    const sealedToken = decodeURIComponent(new URL(request.interaction.url!).hash.slice('#token='.length))
    const storedConnectionRequest = vi.mocked(deps.externalResources.createAgentConnectionRequest).mock.calls[0]![0]
    vi.mocked(deps.externalResources.findAgentConnectionRequest).mockResolvedValue(storedConnectionRequest)
    vi.mocked(deps.externalResources.findAgentConnectionRequestByApprovalTokenHash).mockResolvedValue(
      storedConnectionRequest,
    )
    await expect(
      getAgentResourceConnectionActivation(deps, request.id, principal(), 'https://auth.example.com'),
    ).resolves.toMatchObject({
      status: 'pending',
    })
    await expect(getAccountResourceConnectionApproval(deps, sealedToken, 'user-1')).resolves.toMatchObject({
      id: request.id,
      status: 'pending',
      agent: { id: 'identity-1' },
      resource: { id: 'resource-1' },
      accountConnection: null,
    })
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => record)
    await expect(
      createAccountConnection(
        deps,
        { context: 'connection-request', approvalToken: sealedToken },
        'user-1',
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      apiResourceId: 'resource-1',
      scopes: ['projects:read'],
      status: 'pending_authorization',
    })
    expect(deps.externalResources.createConnectionIntent).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: 'connection-approval' }),
    )
    expect(deps.externalResources.createGrant).not.toHaveBeenCalled()
    await expect(
      createAgentAccessRequest(
        deps,
        { resourceId: 'resource-1', scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Active resource account connection was not found.')
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue({
      ...connectionRecord(),
      updatedAt: new Date(Date.now() + 60_000),
    })
    await expect(
      getAgentResourceConnectionActivation(deps, request.id, principal(), 'https://auth.example.com'),
    ).resolves.toMatchObject({
      status: 'connected',
    })
  })

  it('reports an expired connection as disconnected when its refresh grant is rejected', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    const expiredConnection = {
      ...connectionRecord(),
      credentialExpiresAt: new Date(Date.now() - 60_000),
    }
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([expiredConnection])
    vi.mocked(deps.externalResources.revokeConnection).mockResolvedValue(true)
    const resourceFetch = vi.mocked(deps.externalHttp.fetch).getMockImplementation()!
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url === 'https://projects.example.com/token') {
        return Response.json({ error: 'invalid_grant', error_description: 'session not found' }, { status: 400 })
      }
      return resourceFetch(request)
    })

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      resources: [{ connection: { status: 'not_connected' } }],
    })
    expect(deps.externalResources.revokeConnection).toHaveBeenCalledWith('connection-1', expect.any(Date))
  })

  it('[spec: agent-identity/resource-account-connection-expansion] preserves active account authority while connection expansion awaits OAuth', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const existingConnection = {
      ...connectionRecord(),
      grantedScopes: ['openid', 'offline_access', 'projects:read'],
      authorizationDetails: [{ type: 'project_access', identifier: 'project-1', actions: ['read'] }],
    }
    mockResourceOpenApi(deps, resource().resourceUrl, ['projects:read', 'projects:write'])
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(existingConnection)
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => record)

    const request = await createAgentResourceConnectionRequest(
      deps,
      'resource-1',
      { scopes: ['projects:write'], reason: 'Update projects' },
      principal(),
      'https://auth.example.com',
    )
    const approvalToken = decodeURIComponent(new URL(request.interaction.url!).hash.slice('#token='.length))
    vi.mocked(deps.externalResources.findAgentConnectionRequestByApprovalTokenHash).mockResolvedValue(
      vi.mocked(deps.externalResources.createAgentConnectionRequest).mock.calls[0]![0],
    )

    await expect(
      createAccountConnection(
        deps,
        { context: 'connection-request', approvalToken },
        'user-1',
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      scopes: ['projects:read', 'projects:write'],
      status: 'pending_authorization',
    })
    expect(deps.externalResources.createConnectionIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ['offline_access', 'openid', 'projects:read', 'projects:write'],
      }),
    )
    expect(deps.externalResources.replaceConnectionAuthorization).not.toHaveBeenCalled()
    expect(deps.externalResources.revokeGrant).not.toHaveBeenCalled()
  })

  it('rejects invalid resource connection approval contexts', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())

    await createAgentResourceConnectionRequest(
      deps,
      'resource-1',
      { scopes: ['projects:read'] },
      principal(),
      'https://auth.example.com',
    )
    const request = vi.mocked(deps.externalResources.createAgentConnectionRequest).mock.calls[0]![0]
    vi.mocked(deps.externalResources.findAgentConnectionRequestByApprovalTokenHash).mockResolvedValue(request)
    const approve = () => getAccountResourceConnectionApproval(deps, 'approval-token', 'user-1')

    vi.mocked(deps.externalResources.findAgentConnectionRequestByApprovalTokenHash).mockResolvedValue({
      ...request,
      expiresAt: new Date(0),
    })
    await expect(approve()).rejects.toThrow('Pending connection request was not found.')

    vi.mocked(deps.externalResources.findAgentConnectionRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(null)
    await expect(approve()).rejects.toThrow('Pending connection request was not found.')

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
      ...identityAggregate(),
      identity: { ...identityAggregate().identity, status: 'revoked' },
    })
    await expect(approve()).rejects.toThrow('Pending connection request was not found.')

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({ ...identityAggregate(), bindings: [] })
    await expect(approve()).rejects.toThrow('Pending connection request was not found.')

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
      ...identityAggregate(),
      identity: {
        ...identityAggregate().identity,
        ownerUserId: 'another-user',
        ownerOrganizationId: null,
      },
    })
    await expect(approve()).rejects.toThrow('Agent controller access is required.')

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.authorization.findResource).mockResolvedValue(nativeResource())
    await expect(approve()).rejects.toThrow('Native Resource Servers do not use account connections.')

    await expect(
      createAgentResourceConnectionRequest(
        deps,
        'resource-1',
        { scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Native Resource Servers do not use account connections.')
  })

  it('represents expired connection requests and rejects stale request ownership', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    await createAgentResourceConnectionRequest(
      deps,
      'resource-1',
      { scopes: ['projects:read'] },
      principal(),
      'https://auth.example.com',
    )
    const stored = vi.mocked(deps.externalResources.createAgentConnectionRequest).mock.calls[0]![0]
    vi.mocked(deps.externalResources.findAgentConnectionRequest).mockResolvedValue({
      ...stored,
      authorizationDetails: [{ type: 'project_access', project_id: 'project-1' }],
      expiresAt: new Date(0),
    })
    await expect(
      getAgentResourceConnectionActivation(deps, stored.id, principal(), 'https://auth.example.com'),
    ).resolves.toMatchObject({
      status: 'expired',
      resources: [{ href: expect.stringContaining('/resources/resource_') }],
      interaction: { status: 'expired', url: null, expiresAt: null },
    })

    vi.mocked(deps.externalResources.findAgentConnectionRequest).mockResolvedValue({
      ...stored,
      agentIdentityId: 'another-agent',
    })
    await expect(
      getAgentResourceConnectionActivation(deps, stored.id, principal(), 'https://auth.example.com'),
    ).rejects.toThrow('Connection request was not found.')

    vi.mocked(deps.externalResources.createAgentConnectionRequest).mockResolvedValueOnce(null)
    await expect(
      createAgentResourceConnectionRequest(
        deps,
        'resource-1',
        { scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Enabled Resource Server is required.')
  })

  it('reuses only an exactly matching pending native access request', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const native = nativeResource()
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    mockResourceOpenApi(deps, native.resourceUrl, ['projects:read'])
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
    const matching = {
      ...requestRecord(),
      id: 'matching-request',
      connectionId: null,
      scopes: ['projects:read'],
      authorizationDetails: [],
    }
    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockResolvedValue([
      { ...matching, id: 'wrong-resource', resourceId: 'resource-2' },
      { ...matching, id: 'wrong-connection', connectionId: 'connection-2' },
      { ...matching, id: 'wrong-scopes', scopes: ['projects:write'] },
      { ...matching, id: 'wrong-details', authorizationDetails: [{ type: 'workspace', identifier: 'workspace-1' }] },
      matching,
    ])
    vi.mocked(deps.secrets.open).mockResolvedValue('pending-approval-token')

    await expect(
      createAgentAccessRequest(
        deps,
        { resourceId: native.id, scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ id: matching.id, status: 'pending' })
    expect(deps.externalResources.createAccessRequest).not.toHaveBeenCalled()

    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.createAccessRequest).mockResolvedValue(null)
    await expect(
      createAgentAccessRequest(
        deps,
        { resourceId: native.id, scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Enabled Resource Server is required.')
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
    const mismatchedIdentity = identityAggregate()
    mismatchedIdentity.identity.ownerUserId = null
    mismatchedIdentity.identity.ownerOrganizationId = 'org-1'
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({
      id: 'member-1',
      organizationId: 'org-1',
      userId: 'user-1',
      roles: ['admin'],
      title: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(mismatchedIdentity)
    await expect(
      decideAgentAccessRequestByToken(deps, 'approval-token', { decision: 'approve', mode: 'once' }, 'user-1'),
    ).rejects.toThrow('Resource account connection is outside the Agent home space.')

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.createGrant).mockResolvedValueOnce(null)
    await expect(
      decideAgentAccessRequestByToken(deps, 'approval-token', { decision: 'approve', mode: 'once' }, 'user-1'),
    ).rejects.toThrow('archived before access could be approved')
  })

  it('[spec: agent-identity/external-resource-contextual-delegation] requests and approves exact granted detail sets', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const selected = [{ type: 'project_access', identifier: 'project-1', actions: ['read'] }]
    const connection = {
      ...connectionRecord(),
      authorizationDetails: [selected[0]!, { type: 'project_access', identifier: 'project-2', actions: ['read'] }],
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...resource(),
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    const created = await createAgentAccessRequest(
      deps,
      {
        resourceId: 'resource-1',
        scopes: ['projects:read'],
        authorizationDetails: [{ actions: ['read'], identifier: 'project-1', type: 'project_access' }],
      },
      principal(),
      'https://auth.example.com',
    )
    expect(created.authorizationDetails).toEqual(selected)
    expect(deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { authorizationDetails: [{ type: 'project_access', identifier: 'project-1' }] },
      }),
    )

    vi.mocked(deps.authorization.findResource).mockResolvedValue({ ...resource(), connectorId: null })
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
          authorizationDetails: selected,
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    vi.mocked(deps.authorization.findResource).mockResolvedValue(resource())
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
          authorizationDetails: selected,
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...resource(),
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
    })
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
          authorizationDetails: [],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
          authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
          authorizationDetails: connection.authorizationDetails,
        },
        principal(),
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ authorizationDetails: connection.authorizationDetails })

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
          authorizationDetails: [selected[0]!, selected[0]!],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
          authorizationDetails: [{ type: 'unknown_context', identifier: 'project-3' }],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue({
      ...connection,
      authorizationDetails: [],
    })
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
          authorizationDetails: selected,
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)

    const request = { ...requestRecord(), authorizationDetails: selected }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.createGrant).mockImplementation(async (record) => record)
    vi.mocked(deps.externalResources.decideAccessRequest).mockImplementation(async (_id, decision) => ({
      ...request,
      ...decision,
    }))
    const outOfBounds = [{ type: 'project_access', identifier: 'project-3', actions: ['read'] }]
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...request,
      authorizationDetails: outOfBounds,
    })
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        { decision: 'approve', mode: 'persistent', authorizationDetails: outOfBounds },
        'user-1',
      ),
    ).rejects.toThrow('exceed the connected account boundary')
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        {
          decision: 'approve',
          mode: 'persistent',
          authorizationDetails: [{ type: 'project_access', identifier: 'project-2', actions: ['read'] }],
        },
        'user-1',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        { decision: 'approve', mode: 'persistent', authorizationDetails: [] },
        'user-1',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })
    await decideAgentAccessRequest(
      deps,
      request.id,
      { decision: 'approve', mode: 'persistent', authorizationDetails: selected },
      'user-1',
    )
    expect(deps.externalResources.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationDetails: selected }),
    )

    const multiDetailRequest = { ...request, authorizationDetails: connection.authorizationDetails }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(multiDetailRequest)
    await decideAgentAccessRequest(
      deps,
      multiDetailRequest.id,
      {
        decision: 'approve',
        mode: 'persistent',
        authorizationDetails: connection.authorizationDetails,
      },
      'user-1',
    )
    expect(deps.externalResources.createGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ authorizationDetails: connection.authorizationDetails }),
    )

    const genericRequest = {
      ...request,
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
    }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(genericRequest)
    await expect(
      decideAgentAccessRequest(
        deps,
        genericRequest.id,
        {
          decision: 'approve',
          mode: 'persistent',
          authorizationDetails: connection.authorizationDetails,
        },
        'user-1',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })
    await expect(
      decideAgentAccessRequest(
        deps,
        genericRequest.id,
        {
          decision: 'approve',
          mode: 'persistent',
          authorizationDetails: [connection.authorizationDetails[0]!],
        },
        'user-1',
      ),
    ).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    vi.mocked(deps.authorization.findResource).mockResolvedValue(resource())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        { decision: 'approve', mode: 'persistent', authorizationDetails: selected },
        'user-1',
      ),
    ).rejects.toThrow('This external API resource does not use authorization details.')

    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...resource(),
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({ ...connection, authorizationDetails: [] })
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        { decision: 'approve', mode: 'persistent', authorizationDetails: selected },
        'user-1',
      ),
    ).rejects.toThrow('The resource account must be explicitly reauthorized for authorization details.')

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({ ...request, authorizationDetails: [] })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection)
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        { decision: 'approve', mode: 'persistent', authorizationDetails: [] },
        'user-1',
      ),
    ).rejects.toThrow('Select at least one concrete authorization detail entry.')

    vi.mocked(deps.authorization.findResource).mockResolvedValue(nativeResource())
    mockResourceOpenApi(deps, nativeResource().resourceUrl)
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...request,
      connectionId: null,
      authorizationDetails: selected,
    })
    await expect(
      decideAgentAccessRequest(
        deps,
        request.id,
        { decision: 'approve', mode: 'persistent', authorizationDetails: selected },
        'user-1',
      ),
    ).rejects.toThrow('Native API resources do not accept authorization details.')
  })

  it('[spec: agent-identity/external-resource-contextual-delegation] lists every account detail with connection and Agent grant state', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const template = { type: 'project_access', actions: ['read'] }
    const connectedDetail = { ...template, identifier: 'project-1' }
    const availableDetail = { ...template, identifier: 'project-2' }
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...resource(),
      authorizationDetails: [template],
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerMetadata: {
          ...metadata(),
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://projects.example.com/par',
          authorization_details_catalog_endpoint: 'https://projects.example.com/authorization-details',
          authorization_details_catalog_scope: 'authorization-details:read',
          authorization_details_catalog_version: 1,
        },
      }),
    )
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue({
      ...connectionRecord(),
      grantedScopes: [
        ...connectionRecord().grantedScopes,
        'projects:write',
        'projects:create',
        'authorization-details:read',
      ],
      authorizationDetails: [connectedDetail],
    })
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([
      { ...grantRecord(), authorizationDetails: [connectedDetail], scopes: ['projects:read'] },
      {
        ...grantRecord(),
        id: 'grant-future',
        authorizationDetails: [connectedDetail],
        scopes: ['projects:write'],
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        ...grantRecord(),
        id: 'grant-expired',
        authorizationDetails: [connectedDetail],
        expiresAt: new Date(Date.now() - 60_000),
      },
      {
        ...grantRecord(),
        id: 'grant-incompatible',
        authorizationDetails: [connectedDetail],
      },
    ])
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockImplementation(async (grantId) => ({
      ...requestRecord(),
      id: `request-${grantId}`,
      grantId,
      authorizationDetails: grantId === 'grant-incompatible' ? [] : [connectedDetail],
    }))
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (fetchRequest) => {
      if (fetchRequest.url === resource().resourceUrl) {
        return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
      }
      if (fetchRequest.url === 'https://projects.example.com/openapi.json') {
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
                    scopes: {
                      'projects:read': 'Read projects',
                      'projects:write': 'Write projects',
                      'projects:create': 'Create projects',
                    },
                  },
                },
              },
            },
          },
          paths: {
            '/projects': {
              get: {
                security: [{ oauth: ['projects:read', 'projects:write', 'projects:create'] }],
                responses: {},
              },
            },
          },
        })
      }
      expect(fetchRequest.url).toBe('https://projects.example.com/authorization-details?limit=100&offset=0')
      expect(fetchRequest.headers.get('authorization')).toBe('Bearer subject')
      return Response.json({
        items: [
          { authorizationDetail: connectedDetail, display: { label: 'Project One' } },
          {
            authorizationDetail: availableDetail,
            display: { label: 'Project Two', metadata: { region: 'ca-central-1' } },
          },
        ],
        pagination: { limit: 100, offset: 0, total: 2, hasMore: false, nextOffset: null },
      })
    })

    await expect(
      listAgentAuthorizationDetailCatalog(
        deps,
        'resource-1',
        principal(),
        { limit: 100, offset: 0 },
        'https://auth.example.com',
      ),
    ).resolves.toEqual({
      items: [
        {
          id: expect.stringMatching(/^resource_/),
          type: 'project_access',
          name: 'Project One',
          description: null,
          metadata: {},
          accountAuthorization: { status: 'authorized' },
          agentAuthorization: {
            authorizedScopes: ['projects:read', 'projects:write'],
            requestableScopes: ['projects:create'],
          },
          links: {
            self: expect.stringContaining('/api/resource-servers/resource-1/resources/'),
            accessRequests: 'https://auth.example.com/api/access/requests',
          },
        },
        {
          id: expect.stringMatching(/^resource_/),
          type: 'project_access',
          name: 'Project Two',
          description: null,
          metadata: { region: 'ca-central-1' },
          accountAuthorization: { status: 'authorization_required' },
          agentAuthorization: { authorizedScopes: [], requestableScopes: [] },
          links: {
            self: expect.stringContaining('/api/resource-servers/resource-1/resources/'),
            accessRequests: 'https://auth.example.com/api/access/requests',
          },
        },
      ],
      pagination: { limit: 100, offset: 0, total: 2, hasMore: false, nextOffset: null },
    })
  })

  it('rejects unavailable, unauthorized, and invalid authorization detail catalogs', async () => {
    await expect(
      listAgentAuthorizationDetailCatalog(
        authorizationCatalogDeps({ providerMetadata: metadata() }),
        'resource-1',
        principal(),
        { limit: 100, offset: 0 },
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      items: [
        {
          id: 'service',
          type: 'service',
          accountAuthorization: { status: 'authorized' },
          agentAuthorization: {
            authorizedScopes: [],
            requestableScopes: ['projects:read', 'authorization-details:read'],
          },
        },
      ],
      pagination: { total: 1 },
    })

    await expect(
      listAgentAuthorizationDetailCatalog(
        authorizationCatalogDeps({ grantedScopes: connectionRecord().grantedScopes }),
        'resource-1',
        principal(),
        { limit: 100, offset: 0 },
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resource account must be reauthorized for the authorization detail catalog scope.')

    for (const [response, message] of [
      [new Response(null, { status: 502 }), 'Authorization detail catalog request failed.'],
      [new Response('not-json'), 'Authorization detail catalog response is invalid.'],
      [
        Response.json({
          items: [],
          pagination: { limit: 100, offset: 0, total: 0, hasMore: true, nextOffset: null },
        }),
        'Authorization detail catalog returned inconsistent pagination metadata.',
      ],
      [
        Response.json({
          items: [
            { authorizationDetail: { type: 'project_access', identifier: 'project-1' }, display: { label: 'One' } },
            {
              authorizationDetail: { type: 'project_access', identifier: 'project-1' },
              display: { label: 'One again' },
            },
          ],
          pagination: { limit: 100, offset: 0, total: 2, hasMore: false, nextOffset: null },
        }),
        'Authorization detail catalog contains duplicate details.',
      ],
      [
        Response.json({
          items: [
            { authorizationDetail: { type: 'other_access', identifier: 'other-1' }, display: { label: 'Other' } },
          ],
          pagination: { limit: 100, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
        'Authorization detail catalog contains a detail outside the resource templates.',
      ],
    ] as const) {
      await expect(
        listAgentAuthorizationDetailCatalog(
          authorizationCatalogDeps({ fetchResponse: response }),
          'resource-1',
          principal(),
          { limit: 100, offset: 0 },
          'https://auth.example.com',
        ),
      ).rejects.toThrow(message)
    }

    await expect(
      listAgentAuthorizationDetailCatalog(
        authorizationCatalogDeps({
          fetchResponse: Response.json({
            items: [
              { authorizationDetail: { type: 'project_access', identifier: 'project-1' }, display: { label: 'One' } },
              { authorizationDetail: { type: 'project_access', identifier: 'project-2' }, display: { label: 'Two' } },
            ],
            pagination: { limit: 1, offset: 0, total: 2, hasMore: true, nextOffset: 1 },
          }),
        }),
        'resource-1',
        principal(),
        { limit: 1, offset: 0 },
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Authorization detail catalog returned more items than requested.')

    const unreachable = authorizationCatalogDeps()
    vi.mocked(unreachable.externalHttp.fetch).mockRejectedValue(new Error('network unavailable'))
    await expect(
      listAgentAuthorizationDetailCatalog(
        unreachable,
        'resource-1',
        principal(),
        { limit: 100, offset: 0 },
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Authorization detail catalog could not be reached.')
  })

  it('lists the authorization detail catalog while approving an account-owned request', async () => {
    const detail = { type: 'project_access', identifier: 'project-1', actions: ['read'] }
    const deps = authorizationCatalogDeps({
      fetchResponse: Response.json({
        items: [{ authorizationDetail: detail, display: { label: 'Project One' } }],
        pagination: { limit: 10, offset: 0, total: 1, hasMore: false, nextOffset: null },
      }),
    })
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(requestRecord())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      grantedScopes: [...connectionRecord().grantedScopes, 'authorization-details:read'],
    })
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])

    await expect(
      listAccountAccessRequestAuthorizationDetailCatalog(deps, 'request-1', 'approval-token', 'user-1', {
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          authorizationDetail: detail,
          connectionStatus: 'authorization_required',
          authorizedScopes: [],
          requestableScopes: [],
        },
      ],
      pagination: { total: 1 },
    })
  })

  it('rejects authorization detail catalog requests without a usable resource context', async () => {
    const nativeAgent = authorizationCatalogDeps()
    vi.mocked(nativeAgent.authorization.findResource).mockResolvedValue(nativeResource())
    await expect(
      listAgentAuthorizationDetailCatalog(
        nativeAgent,
        'resource-1',
        principal(),
        { limit: 10, offset: 0 },
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      items: [{ id: 'service', type: 'service', accountAuthorization: { status: 'not_required' } }],
      pagination: { total: 1 },
    })

    for (const connection of [null, { ...connectionRecord(), status: 'revoked' as const }]) {
      const deps = authorizationCatalogDeps()
      vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
      await expect(
        listAgentAuthorizationDetailCatalog(
          deps,
          'resource-1',
          principal(),
          { limit: 10, offset: 0 },
          'https://auth.example.com',
        ),
      ).resolves.toEqual({
        items: [],
        pagination: { limit: 10, offset: 0, total: 0, hasMore: false, nextOffset: null },
      })
    }

    const mismatchedRequest = authorizationCatalogDeps()
    vi.mocked(mismatchedRequest.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(
      requestRecord(),
    )
    await expect(
      listAccountAccessRequestAuthorizationDetailCatalog(
        mismatchedRequest,
        'another-request',
        'approval-token',
        'user-1',
        { limit: 10, offset: 0 },
      ),
    ).rejects.toThrow('Agent access request was not found.')

    const missingIdentity = authorizationCatalogDeps()
    vi.mocked(missingIdentity.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(requestRecord())
    vi.mocked(missingIdentity.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(missingIdentity.agentIdentities.findIdentity).mockResolvedValue(null)
    await expect(
      listAccountAccessRequestAuthorizationDetailCatalog(missingIdentity, 'request-1', 'approval-token', 'user-1', {
        limit: 10,
        offset: 0,
      }),
    ).rejects.toThrow('Active Agent identity was not found.')

    const nativeAccount = authorizationCatalogDeps()
    vi.mocked(nativeAccount.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(requestRecord())
    vi.mocked(nativeAccount.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(nativeAccount.authorization.findResource).mockResolvedValue(nativeResource())
    await expect(
      listAccountAccessRequestAuthorizationDetailCatalog(nativeAccount, 'request-1', 'approval-token', 'user-1', {
        limit: 10,
        offset: 0,
      }),
    ).rejects.toThrow('Native API resources do not have authorization detail catalogs.')

    for (const connection of [null, { ...connectionRecord(), status: 'revoked' as const }]) {
      const deps = authorizationCatalogDeps()
      vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue({
        ...requestRecord(),
        connectionId: null,
      })
      vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
      await expect(
        listAccountAccessRequestAuthorizationDetailCatalog(deps, 'request-1', 'approval-token', 'user-1', {
          limit: 10,
          offset: 0,
        }),
      ).rejects.toThrow('Active resource account connection was not found.')
    }
  })

  it(`exchanges user and Agent authority for a target-issued DPoP token
      [spec: agent-identity/agent-direct-resource-access]
      [spec: agent-identity/agent-audit-chain]`, async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const openApiFetch = vi.mocked(deps.externalHttp.fetch).getMockImplementation()!
    const request = { ...requestRecord(), status: 'approved', grantId: 'grant-1' }
    const grant = {
      ...grantRecord(),
      mode: 'persistent' as const,
      scopes: ['projects:read', 'projects:write'],
    }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grant)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      clientGeneration: 1,
      credentialExpiresAt: new Date(Date.now() - 1),
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        clientId: 'realmroot-client-new',
        clientSecret: 'target-secret-new',
        clientGeneration: 2,
        retiredClientGenerations: [
          {
            generation: 1,
            clientId: 'realmroot-client',
            encryptedClientSecret: 'sealed:target-secret',
            clientSecretContext: 'connector:connector-1:client-generation:1:client-secret',
            registrationClientUri: null,
            encryptedRegistrationAccessToken: null,
            registrationAccessTokenContext: null,
            registeredScopes: ['openid', 'offline_access', 'projects:read'],
          },
        ],
      }),
    )
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
      expect(outbound.headers.get('authorization')).toBe(`Basic ${btoa('realmroot-client:target-secret')}`)
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
      expect(['refreshed-subject', 'subject']).toContain(form.get('subject_token'))
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
      request.id,
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
      authorizationDetails: [],
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

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
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
    exchangeResponse = { code: 'BAD_REQUEST', message: 'Agent assertion is invalid' }
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
    ).rejects.toThrow('bad_request: Agent assertion is invalid')

    exchangeResponse = { error: 'invalid_grant', error_description: 'The grant expired' }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('invalid_grant: The grant expired')

    exchangeResponse = { error: 'invalid_grant' }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('token request: invalid_grant')

    exchangeResponse = { error: 'invalid_grant', message: 'The provider rejected the grant' }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('invalid_grant: The provider rejected the grant')

    exchangeResponse = { message: 'Unstructured provider failure' }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('External authorization server rejected the token request.')
  })

  it('[spec: agent-identity/external-resource-contextual-delegation] exchanges and leases the exact approved authorization details', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const authorizationDetails = [{ type: 'project_access', identifier: 'project-1', actions: ['read'] }]
    const rarResource = {
      ...resource(),
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
    }
    const request = {
      ...requestRecord(),
      status: 'approved',
      grantId: 'grant-1',
      authorizationDetails,
    }
    const grant = { ...grantRecord(), authorizationDetails }
    const connection = {
      ...connectionRecord(),
      authorizationDetails,
      credentialExpiresAt: new Date(Date.now() - 1_000),
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(rarResource)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grant)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.createTokenLease).mockImplementation(async (record) => record)
    vi.mocked(deps.externalResources.consumeAccessRequest).mockResolvedValue(true)
    vi.mocked(deps.externalResources.consumeGrant).mockResolvedValue(true)
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerMetadata: {
          ...metadata(),
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://projects.example.com/par',
        },
      }),
    )
    const openApiFetch = vi.mocked(deps.externalHttp.fetch).getMockImplementation()!
    let expectedAuthorizationDetails = authorizationDetails
    let issuedAuthorizationDetails: unknown = authorizationDetails
    let refreshedAuthorizationDetails: unknown
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (outbound) => {
      if (outbound.url === rarResource.resourceUrl || outbound.url === 'https://projects.example.com/openapi.json') {
        return openApiFetch(outbound)
      }
      const form = new URLSearchParams(await outbound.text())
      if (form.get('grant_type') === 'refresh_token') {
        expect(JSON.parse(form.get('authorization_details')!)).toEqual(expectedAuthorizationDetails)
        return Response.json({
          access_token: 'refreshed-subject-token',
          refresh_token: 'rotated-refresh-token',
          token_type: 'Bearer',
          expires_in: 300,
          ...(refreshedAuthorizationDetails === undefined
            ? {}
            : { authorization_details: refreshedAuthorizationDetails }),
        })
      }
      if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        return Response.json({ access_token: 'actor-token', token_type: 'Bearer', expires_in: 300 })
      }
      expect(JSON.parse(form.get('authorization_details')!)).toEqual(expectedAuthorizationDetails)
      return Response.json({
        access_token: 'target-token',
        token_type: 'DPoP',
        expires_in: 300,
        scope: 'projects:read',
        authorization_details: issuedAuthorizationDetails,
      })
    })

    const issue = async () =>
      issueTargetAccessToken(
        deps,
        grant.id,
        await createDpopProof('https://projects.example.com/token'),
        'https://auth.example.com/api/agent/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('agent-assertion') },
      )
    await expect(issue()).resolves.toMatchObject({ authorizationDetails })
    expect(deps.externalResources.updateConnectionTokens).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({ encryptedTokens: expect.stringContaining('rotated-refresh-token') }),
    )
    expect(deps.externalResources.createTokenLease).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationDetails }),
    )

    refreshedAuthorizationDetails = [{ type: 'project_access', identifier: 'project-2', actions: ['read'] }]
    await expect(issue()).rejects.toThrow('changed authorization details during refresh')
    refreshedAuthorizationDetails = undefined
    issuedAuthorizationDetails = [{ type: 'project_access', identifier: 'project-2', actions: ['read'] }]
    await expect(issue()).rejects.toThrow('issued different authorization details')
    issuedAuthorizationDetails = undefined
    await expect(issue()).rejects.toMatchObject({ error: 'invalid_authorization_details' })

    const legacyAuthorizationDetails = [
      authorizationDetails[0]!,
      { type: 'project_access', identifier: 'project-2', actions: ['read'] },
    ]
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...request,
      authorizationDetails: legacyAuthorizationDetails,
    })
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue({
      ...grant,
      authorizationDetails: legacyAuthorizationDetails,
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connection,
      authorizationDetails: legacyAuthorizationDetails,
    })
    expectedAuthorizationDetails = legacyAuthorizationDetails
    issuedAuthorizationDetails = legacyAuthorizationDetails
    await expect(issue()).resolves.toMatchObject({ authorizationDetails: legacyAuthorizationDetails })
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
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({ ...connectionRecord(), clientGeneration: 1 })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        clientId: 'realmroot-client-new',
        clientSecret: 'target-secret-new',
        clientGeneration: 2,
        retiredClientGenerations: [
          {
            generation: 1,
            clientId: 'realmroot-client',
            encryptedClientSecret: 'sealed:target-secret',
            clientSecretContext: 'connector:connector-1:client-generation:1:client-secret',
            registrationClientUri: null,
            encryptedRegistrationAccessToken: null,
            registrationAccessTokenContext: null,
            registeredScopes: ['openid', 'offline_access', 'projects:read'],
          },
        ],
      }),
    )
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
        authorizationDetails: [],
        expiresAt: new Date(Date.now() + 300_000),
        revokedAt: null,
        createdAt: now,
      },
    ])
    vi.mocked(deps.externalResources.revokeTokenLease).mockResolvedValue(true)
    vi.mocked(deps.externalResources.revokeGrant).mockResolvedValue(true)
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (outbound) => {
      expect(outbound.url).toBe('https://projects.example.com/revoke')
      expect(outbound.headers.get('authorization')).toBe(`Basic ${btoa('realmroot-client:target-secret')}`)
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
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([
      { ...connectionRecord(), ownerUserId: 'user-1', ownerOrganizationId: null },
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
      scopes: ['projects:read'],
    })
    await expect(listConnectableExternalResources(deps)).resolves.toMatchObject({
      resources: [{ id: 'resource-1' }],
    })
  })

  it('defaults optional connector authorization metadata', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        registrationMode: null,
        clientSecretContext: 'connector:connector-1:client-secret',
        providerMetadata: null,
      }),
    )

    await expect(getExternalResourceAuthorization(deps, 'resource-1')).resolves.toMatchObject({
      registrationMode: 'manual',
    })
  })

  it('creates and revokes account connections, including organization control', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    Object.assign(deps.authorization, {
      findMemberByOrganizationUser: vi.fn().mockResolvedValue({ roles: ['credential_manager'] }),
      listOrganizationRoleScopes: vi
        .fn()
        .mockResolvedValue(new Map([['credential_manager', [{ resourceId: 'res_realmroot', scope: 'agents:write' }]]])),
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

  it('[spec: agent-identity/external-resource-first-access] connects the account with the pending request scopes', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    mockResourceOpenApi(deps, resource().resourceUrl, ['objects:purge', 'projects:read', 'projects:write'])
    const request = {
      ...requestRecord(),
      connectionId: null,
      scopes: ['projects:read'],
    }
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
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
      owner: { type: 'organization', organizationId: 'org-1' },
      scopes: ['projects:read'],
      status: 'pending_authorization',
    })
    expect(deps.externalResources.createConnectionIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'resource-1',
        ownerUserId: null,
        ownerOrganizationId: 'org-1',
        scopes: ['offline_access', 'openid', 'projects:read'],
        returnTo: 'access-approval',
      }),
    )

    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([
      {
        ...connectionRecord(),
        grantedScopes: ['openid', 'offline_access', 'projects:read', 'projects:write'],
      },
    ])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({
      items: [{ id: 'connection-1' }],
      pagination: { total: 1 },
    })

    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([
      { ...connectionRecord(), grantedScopes: ['projects:read'] },
    ])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({
      items: [{ id: 'connection-1', scopes: ['projects:read'] }],
      pagination: { total: 1 },
    })

    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([
      connectionRecord(),
      { ...connectionRecord(), id: 'duplicate-connection' },
    ])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).rejects.toThrow('A resource home space cannot have more than one active account connection.')

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValueOnce(identityAggregate()).mockResolvedValueOnce(null)
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).rejects.toThrow('Active Agent identity was not found.')

    vi.mocked(deps.authorization.findResource).mockResolvedValue(nativeResource())
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toEqual({
      items: [],
      pagination: expect.objectContaining({ total: 0 }),
    })
  })

  it('[spec: agent-identity/resource-account-reauthorization] preserves existing scopes while expanding an account', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const template = { type: 'project_access', actions: ['read'] }
    const existingDetail = { ...template, identifier: 'project-1' }
    const request = {
      ...requestRecord(),
      connectionId: null,
      scopes: ['teams:read'],
      authorizationDetails: [{ ...template, identifier: 'project-2' }],
    }
    const existingConnection = {
      ...connectionRecord(),
      grantedScopes: ['openid', 'offline_access', 'objects:create', 'quota:purchase', 'shares:create'],
      authorizationDetails: [existingDetail],
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...resource(),
      authorizationDetails: [template],
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        registeredScopes: [
          'authorization-details:read',
          'objects:create',
          'offline_access',
          'openid',
          'quota:purchase',
          'shares:create',
          'teams:read',
        ],
        providerMetadata: {
          ...metadata(),
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://projects.example.com/par',
          authorization_details_catalog_endpoint: 'https://projects.example.com/authorization-details',
          authorization_details_catalog_scope: 'authorization-details:read',
          authorization_details_catalog_version: 1,
        },
      }),
    )
    mockResourceOpenApi(deps, resource().resourceUrl, [
      'objects:create',
      'quota:purchase',
      'shares:create',
      'teams:read',
    ])
    const openApiFetch = vi.mocked(deps.externalHttp.fetch).getMockImplementation()!
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (fetchRequest) => {
      if (fetchRequest.url === 'https://projects.example.com/par') {
        const form = new URLSearchParams(await fetchRequest.text())
        expect(form.get('scope')?.split(' ')).toEqual(
          [
            'authorization-details:read',
            'objects:create',
            'offline_access',
            'openid',
            'quota:purchase',
            'shares:create',
            'teams:read',
          ].sort(),
        )
        expect(JSON.parse(form.get('authorization_details')!)).toEqual([template])
        return Response.json({ request_uri: 'urn:example:par:expanded', expires_in: 300 }, { status: 201 })
      }
      return openApiFetch(fetchRequest)
    })
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(existingConnection)
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
      scopes: ['objects:create', 'quota:purchase', 'shares:create', 'teams:read'],
      authorizationDetails: [template],
      status: 'pending_authorization',
    })
    expect(deps.externalResources.findConnectionByOwnerResource).toHaveBeenCalledWith({
      resourceId: 'resource-1',
      ownerUserId: null,
      ownerOrganizationId: 'org-1',
    })
    expect(deps.externalResources.createConnectionIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [
          'authorization-details:read',
          'objects:create',
          'offline_access',
          'openid',
          'quota:purchase',
          'shares:create',
          'teams:read',
        ],
        authorizationDetails: [template],
        returnTo: 'access-approval',
      }),
    )
  })

  it('enforces first-access connection context boundaries', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const request = { ...requestRecord(), connectionId: null }
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
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
      findMemberByOrganizationUser: vi.fn().mockResolvedValue({ roles: ['owner'] }),
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
    ])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ items: [{ id: 'connection-1' }], pagination: { total: 1 } })
  })

  it('rejects invalid internally resolved connections when approving first access', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const request = { ...requestRecord(), connectionId: null }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())

    await expect(
      decideAgentAccessRequest(deps, request.id, { decision: 'approve', mode: 'once' }, 'user-1'),
    ).rejects.toThrow('An account connection is required')

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(requestRecord())

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      resourceId: 'resource-2',
    })
    await expect(
      decideAgentAccessRequest(deps, request.id, { decision: 'approve', mode: 'once' }, 'user-1'),
    ).rejects.toThrow('does not belong to this API resource')

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      grantedScopes: ['projects:write'],
    })
    await expect(
      decideAgentAccessRequest(deps, request.id, { decision: 'approve', mode: 'once' }, 'user-1'),
    ).rejects.toThrow('connected account boundary')

    const native = nativeResource()
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    mockResourceOpenApi(deps, native.resourceUrl)
    await expect(
      decideAgentAccessRequest(deps, request.id, { decision: 'approve', mode: 'once' }, 'user-1'),
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
    })
    mockResourceOpenApi(deps, native.resourceUrl)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([
      { ...grantRecord(), connectionId: null },
    ])
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      connectionId: null,
      status: 'approved',
      grantId: 'grant-1',
    })
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      resources: [{ connection: { status: 'not_required', displayName: null, authorizedScopes: [] } }],
    })
    await expect(
      listAgentApiResources(deps, principal(), { limit: 10, offset: 0 }, 'https://auth.example.com'),
    ).resolves.toMatchObject({
      items: [
        {
          id: 'resource-1',
          scopes: expect.arrayContaining([{ value: 'projects:read', description: 'Read projects' }]),
          availability: { status: 'available' },
          connection: { status: 'not_required', displayName: null, authorizedScopes: [] },
        },
      ],
      pagination: { total: 1 },
    })
    const created = await createAccessRequest(
      deps,
      {
        resource: { href: '/api/resource-servers/resource-1/resources/service' },
        scopes: ['projects:read'],
        reason: 'Read projects',
      },
      principal(),
      'https://auth.example.com/',
    )
    expect(created).toMatchObject({
      target: { type: 'resource', resource: { href: expect.stringContaining('/resources/service') } },
      status: 'approved',
      interaction: { status: 'completed' },
    })
    expect(created).not.toHaveProperty('grantId')
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      id: created.id,
      connectionId: null,
      status: 'approved',
      grantId: 'grant-1',
    })
    await expect(getAccessRequest(deps, created.id, principal(), 'https://auth.example.com')).resolves.toMatchObject({
      id: created.id,
      status: 'approved',
    })
    await expect(
      createAccessRequest(
        deps,
        {
          resource: { href: '/api/resource-servers/resource-1/resources/service' },
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com/',
      ),
    ).resolves.toMatchObject({ reason: null })

    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
    await expect(
      createAccessRequest(
        deps,
        { resource: { href: '/api/resource-servers/resource-1/resources/service' }, scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com/',
      ),
    ).resolves.toMatchObject({
      status: 'pending',
      interaction: {
        status: 'pending',
        url: expect.stringContaining('/agent/resource-access/approve#token='),
        expiresAt: expect.any(String),
      },
    })
    const stored = vi.mocked(deps.externalResources.createAccessRequest).mock.calls[0]![0]
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(stored)
    await expect(getAgentAccessRequest(deps, stored.id, principal())).resolves.toMatchObject({ id: stored.id })
    await expect(getAccessRequest(deps, stored.id, principal(), 'https://auth.example.com')).resolves.toMatchObject({
      target: { type: 'resource' },
    })
  })

  it('exposes Organization and User tenant authority as separate Realmroot Resources [spec: agent-identity/realmroot-built-in-resource-server] [spec: management-api/management-canonical-authority-inventory]', async () => {
    const deps = createTestDeps()
    const builtIn = {
      ...nativeResource(),
      id: 'res_realmroot',
      identifier: 'realmroot',
      name: 'Realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.authorization.listUserMemberships).mockResolvedValue([{ organizationId: 'org-1' } as never])
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      name: 'Example Organization',
      displayName: null,
      disabled: false,
    } as never)
    vi.mocked(deps.users.getUser).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'Example User',
      role: 'admin',
    } as never)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    mockResourceOpenApi(deps, builtIn.resourceUrl)

    const result = await listAgentAuthorizationDetailCatalog(
      deps,
      builtIn.id,
      principal(),
      { limit: 10, offset: 0 },
      'https://auth.example.com',
    )

    expect(result.pagination.total).toBe(1)
    expect(result.items).toEqual([
      expect.objectContaining({ type: 'realmroot_authority', name: 'Example Organization' }),
    ])
    expect(new Set(result.items.map((item) => item.links.self)).size).toBe(1)
  })

  it('reads Realmroot Resource Servers and authority Resources without exposing protocol internals', async () => {
    const deps = createTestDeps()
    const builtIn = {
      ...nativeResource(),
      id: 'res_realmroot',
      identifier: 'realmroot',
      name: 'Realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    Object.assign(deps.authorization, {
      findResource: vi.fn().mockResolvedValue(builtIn),
      listEnabledResources: vi.fn().mockResolvedValue([builtIn]),
      listUserMemberships: vi.fn().mockResolvedValue([]),
    })
    vi.mocked(deps.users.getUser).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      displayName: null,
      role: 'member',
    } as never)
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      name: 'Example Organization',
      displayName: 'Organization Display',
      disabled: false,
    } as never)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    const accountAuthority = { type: 'realmroot_authority', authority: 'organization', id: 'org-1' }
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([
      {
        ...grantRecord(),
        resourceId: builtIn.id,
        connectionId: null,
        authorizationDetails: [accountAuthority],
        scopes: ['users:read'],
      },
      { ...grantRecord(), id: 'wrong-resource', resourceId: 'other', authorizationDetails: [accountAuthority] },
      {
        ...grantRecord(),
        id: 'revoked',
        resourceId: builtIn.id,
        status: 'revoked',
        authorizationDetails: [accountAuthority],
      },
      {
        ...grantRecord(),
        id: 'expired',
        resourceId: builtIn.id,
        expiresAt: new Date(0),
        authorizationDetails: [accountAuthority],
      },
      { ...grantRecord(), id: 'wrong-authority', resourceId: builtIn.id, authorizationDetails: [] },
    ])

    await expect(
      getAgentResourceServer(deps, builtIn.id, principal(), 'https://auth.example.com/'),
    ).resolves.toMatchObject({ id: builtIn.id, connection: { status: 'not_required' } })
    const resources = await listAgentAuthorizationDetailCatalog(
      deps,
      builtIn.id,
      principal(),
      { limit: 10, offset: 0 },
      'https://auth.example.com',
    )
    expect(resources.items).toHaveLength(1)
    await expect(
      getAgentResourceServerResource(deps, builtIn.id, resources.items[0]!.id, principal(), 'https://auth.example.com'),
    ).resolves.toMatchObject({
      name: 'Organization Display',
      type: 'realmroot_authority',
      agentAuthorization: { authorizedScopes: ['users:read'] },
    })
    await expect(
      getAgentResourceServerResource(deps, builtIn.id, 'missing', principal(), 'https://auth.example.com'),
    ).rejects.toThrow('Resource was not found.')

    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([])
    await expect(getAgentResourceServer(deps, 'missing', principal(), 'https://auth.example.com')).rejects.toThrow(
      'Resource Server was not found.',
    )
  })

  it('resolves an organization-owned Agent to one Realmroot authority', async () => {
    const deps = createTestDeps()
    const builtIn = {
      ...nativeResource(),
      id: 'res_realmroot',
      identifier: 'realmroot',
      name: 'Realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    const organizationIdentity = identityAggregate()
    organizationIdentity.identity.ownerUserId = null
    organizationIdentity.identity.ownerOrganizationId = 'org-1'
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      name: 'Organization',
      displayName: 'Organization Display',
      disabled: false,
    } as never)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(organizationIdentity)

    await expect(
      listAgentAuthorizationDetailCatalog(
        deps,
        builtIn.id,
        principal(),
        { limit: 10, offset: 0 },
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      items: [{ name: 'Organization Display', metadata: { authority: 'organization', organizationId: 'org-1' } }],
    })

    vi.mocked(deps.authorization.findOrganization).mockResolvedValue(null)
    await expect(
      listAgentAuthorizationDetailCatalog(
        deps,
        builtIn.id,
        principal(),
        { limit: 10, offset: 0 },
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Organization authority was not found.')
  })

  it('validates Realmroot scopes and requires exactly one authority Resource', async () => {
    const deps = createTestDeps()
    const builtIn = {
      ...nativeResource(),
      id: 'res_realmroot',
      identifier: 'realmroot',
      name: 'Realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())

    await expect(
      createAgentAccessRequest(
        deps,
        { resourceId: builtIn.id, scopes: ['unknown:read'], authorizationDetails: [] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('scope is not declared')
    await expect(
      createAgentAccessRequest(
        deps,
        { resourceId: builtIn.id, scopes: ['users:read'], authorizationDetails: [] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('exactly one Realmroot authority')
  })

  it('issues a credential from an approved Resource access request', async () => {
    const deps = createTestDeps()
    const builtIn = {
      ...nativeResource(),
      id: 'res_realmroot',
      identifier: 'realmroot',
      name: 'Realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    const authority = { type: 'realmroot_authority', authority: 'organization', id: 'org-1' }
    const approved = {
      ...requestRecord(),
      resourceId: builtIn.id,
      connectionId: null,
      scopes: ['users:read'],
      authorizationDetails: [authority],
      status: 'approved' as const,
      grantId: 'grant-1',
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(approved)
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue({
      ...grantRecord(),
      resourceId: builtIn.id,
      connectionId: null,
      scopes: approved.scopes,
      authorizationDetails: [authority],
      mode: 'persistent',
    })
    const signer = { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('credential-token') }
    const endpoint = `https://auth.example.com/api/access/requests/${approved.id}/credentials`

    await expect(
      createAccessRequestCredential(deps, approved.id, await createDpopProof(endpoint), endpoint, principal(), signer),
    ).resolves.toMatchObject({
      accessToken: 'credential-token',
      resourceIndicator: builtIn.resourceUrl,
      resource: { href: expect.stringContaining(`/resource-servers/${builtIn.id}/resources/`) },
    })

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...approved,
      status: 'pending',
      grantId: null,
    })
    await expect(
      createAccessRequestCredential(deps, approved.id, 'proof', endpoint, principal(), signer),
    ).rejects.toThrow('Approved Resource access is required.')
  })

  it('uses connected authorization details as the Resource catalog when no catalog endpoint exists', async () => {
    const deps = createTestDeps()
    const detail = { type: 'project_access', project_id: 'project-1', actions: ['read'] }
    const external = { ...resource(), authorizationDetails: [{ type: 'project_access', actions: ['read'] }] }
    const numericDetail = { type: 'project_access', project_id: 2, actions: ['read'] }
    const typeOnlyDetail = { type: 'project_access', actions: ['read'] }
    const connection = {
      ...connectionRecord(),
      authorizationDetails: [detail, numericDetail, typeOnlyDetail],
      grantedScopes: ['openid', 'offline_access', 'projects:read', 'projects:write'],
    }
    authorizationDeps(deps)
    vi.mocked(deps.authorization.findResource).mockResolvedValue(external)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([
      { ...grantRecord(), authorizationDetails: [detail], mode: 'persistent' },
      { ...grantRecord(), id: 'wrong-resource', resourceId: 'other', authorizationDetails: [detail] },
      { ...grantRecord(), id: 'wrong-connection', connectionId: 'other', authorizationDetails: [detail] },
      { ...grantRecord(), id: 'revoked', status: 'revoked', authorizationDetails: [detail] },
      { ...grantRecord(), id: 'expired', expiresAt: new Date(0), authorizationDetails: [detail] },
      { ...grantRecord(), id: 'other-detail', authorizationDetails: [{ ...detail, project_id: 'project-2' }] },
    ])
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())

    const catalog = await listAgentAuthorizationDetailCatalog(
      deps,
      external.id,
      principal(),
      { limit: 10, offset: 0 },
      'https://auth.example.com',
    )
    expect(catalog.items[0]).toMatchObject({
      name: 'project-1',
      metadata: { project_id: 'project-1' },
      accountAuthorization: { status: 'authorized' },
      agentAuthorization: { authorizedScopes: ['projects:read'], requestableScopes: ['projects:write'] },
    })
    expect(catalog.pagination.total).toBe(3)
    expect(catalog.items[1]).toMatchObject({ name: '2', metadata: { project_id: '2' } })
    expect(catalog.items[2]).toMatchObject({ name: 'project_access', metadata: {} })

    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
    const created = await createAccessRequest(
      deps,
      { resource: { href: catalog.items[0]!.links.self }, scopes: ['projects:read'] },
      principal(),
      'https://auth.example.com',
    )
    expect(created.target).toEqual({ type: 'resource', resource: { href: catalog.items[0]!.links.self } })

    await expect(
      createAccessRequest(
        deps,
        { resource: { href: catalog.items[0]!.links.self }, scopes: ['projects:read'] },
        principal(),
        'https://different.example.com',
      ),
    ).rejects.toThrow('another Realmroot issuer')
    await expect(
      createAccessRequest(
        deps,
        { resource: { href: 'not a valid URL%' }, scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resource href is invalid')

    await expect(
      createAccessRequest(
        deps,
        {
          resource: { href: `/api/resource-servers/${external.id}/resources/value%2Fwith-slash` },
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resource href is invalid')
  })

  it('renders Realmroot authority approval and credential offers', async () => {
    const deps = createTestDeps()
    const builtIn = {
      ...nativeResource(),
      id: 'res_realmroot',
      identifier: 'realmroot',
      name: 'Realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    const authority = { type: 'realmroot_authority', authority: 'organization', id: 'org-1' }
    const approved = {
      ...requestRecord(),
      resourceId: builtIn.id,
      connectionId: null,
      scopes: ['users:read'],
      authorizationDetails: [authority],
      status: 'approved' as const,
      grantId: 'grant-1',
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      name: 'Organization',
      displayName: 'Organization Display',
      disabled: false,
    } as never)
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({
      id: 'member-1',
      organizationId: 'org-1',
      userId: 'user-1',
      roles: ['owner'],
    } as never)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    const pending = { ...approved, status: 'pending' as const, grantId: null }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(pending)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(pending)

    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      requiresAccountConnection: false,
      resource: { name: 'Organization Display', type: 'realmroot_authority' },
    })
    await expect(getControllerAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      id: approved.id,
    })

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(approved)
    await expect(getAccessRequest(deps, approved.id, principal(), 'https://auth.example.com')).resolves.toMatchObject({
      credentialOffer: {
        type: 'dpop',
        resourceIndicator: builtIn.resourceUrl,
        endpoint: expect.stringContaining('/credentials'),
      },
    })
  })

  it('rejects invalid Resource references at each server boundary', async () => {
    const nativeDeps = createTestDeps()
    const native = nativeResource()
    vi.mocked(nativeDeps.authorization.findResource).mockResolvedValue(native)
    vi.mocked(nativeDeps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    mockResourceOpenApi(nativeDeps, native.resourceUrl)
    await expect(
      createAccessRequest(
        nativeDeps,
        { resource: { href: `/api/resource-servers/${native.id}/resources/not-service` }, scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resource was not found.')
    await expect(
      createAccessRequest(
        nativeDeps,
        { resource: { href: 'http://[' }, scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resource href is invalid.')
    await expect(
      createAccessRequest(
        nativeDeps,
        { resource: { href: '/not-a-resource' }, scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resource href is invalid.')

    const realmrootDeps = createTestDeps()
    const builtIn = { ...native, id: 'res_realmroot', resourceUrl: 'https://auth.example.com/api' }
    vi.mocked(realmrootDeps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(realmrootDeps.authorization.listUserMemberships).mockResolvedValue([])
    vi.mocked(realmrootDeps.users.getUser).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: 'member',
    } as never)
    vi.mocked(realmrootDeps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    await expect(
      createAccessRequest(
        realmrootDeps,
        { resource: { href: `/api/resource-servers/${builtIn.id}/resources/missing` }, scopes: ['users:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resource was not found.')

    const externalDeps = createTestDeps()
    authorizationDeps(externalDeps)
    vi.mocked(externalDeps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(externalDeps.externalResources.findConnectionByOwnerResource).mockResolvedValue(null)
    await expect(
      createAccessRequest(
        externalDeps,
        { resource: { href: `/api/resource-servers/${resource().id}/resources/service` }, scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Connect the Resource Server')

    vi.mocked(externalDeps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    await expect(
      createAccessRequest(
        externalDeps,
        {
          resource: { href: `/api/resource-servers/${resource().id}/resources/not-service` },
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resource was not found.')
  })

  it('rejects malformed Realmroot authority approval records', async () => {
    const deps = createTestDeps()
    const builtIn = { ...nativeResource(), id: 'res_realmroot', resourceUrl: 'https://auth.example.com/api' }
    const pending = {
      ...requestRecord(),
      resourceId: builtIn.id,
      connectionId: null,
      authorizationDetails: [{ type: 'realmroot_authority', authority: 'unknown', id: 'bad' }],
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({
      id: 'member-1',
      organizationId: 'org-1',
      userId: 'user-1',
      roles: ['owner'],
    } as never)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(pending)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(pending)

    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).rejects.toThrow(
      'Realmroot authority Resource is invalid.',
    )
  })

  it('represents every Resource access interaction state', async () => {
    const deps = createTestDeps()
    const native = nativeResource()
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())

    for (const [status, interaction] of [
      ['pending', 'pending'],
      ['denied', 'denied'],
      ['expired', 'expired'],
      ['consumed', 'completed'],
    ] as const) {
      vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
        ...requestRecord(),
        connectionId: null,
        status,
        grantId: status === 'consumed' ? 'grant-1' : null,
      })
      await expect(getAccessRequest(deps, 'request-1', principal(), 'https://auth.example.com')).resolves.toMatchObject(
        {
          status,
          interaction: { status: interaction },
        },
      )
    }
  })

  it('filters unavailable Realmroot authorities and paginates singleton service Resources', async () => {
    const deps = createTestDeps()
    const builtIn = { ...nativeResource(), id: 'res_realmroot', resourceUrl: 'https://auth.example.com/api' }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      name: 'Organization',
      displayName: null,
      disabled: false,
    } as never)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    const authorities = await listAgentAuthorizationDetailCatalog(
      deps,
      builtIn.id,
      principal(),
      { limit: 10, offset: 0 },
      'https://auth.example.com',
    )
    expect(authorities.items).toHaveLength(1)

    const native = nativeResource()
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    mockResourceOpenApi(deps, native.resourceUrl)
    await expect(
      listAgentAuthorizationDetailCatalog(
        deps,
        native.id,
        principal(),
        { limit: 10, offset: 1 },
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ items: [], pagination: { total: 1 } })
  })

  it('resolves approval Resources through a paginated external catalog', async () => {
    const deps = authorizationCatalogDeps()
    const requested = { type: 'project_access', project_id: 'project-2', actions: ['read'] }
    const pending = { ...requestRecord(), authorizationDetails: [requested] }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(pending)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(pending)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      grantedScopes: [...connectionRecord().grantedScopes, 'authorization-details:read'],
    })
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/authorization-details') return new Response(null, { status: 404 })
      const offset = Number(url.searchParams.get('offset'))
      if (offset === 0) {
        return Response.json({
          items: [
            {
              authorizationDetail: { type: 'project_access', project_id: 'project-1', actions: ['read'] },
              display: { label: 'Project One' },
            },
          ],
          pagination: { limit: 100, offset: 0, total: 101, hasMore: true, nextOffset: 100 },
        })
      }
      return Response.json({
        items: [
          {
            authorizationDetail: requested,
            display: { label: 'Project Two', description: 'Second project', metadata: { project: '2' } },
          },
        ],
        pagination: { limit: 100, offset: 100, total: 101, hasMore: false, nextOffset: null },
      })
    })

    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      resource: {
        name: 'Project Two',
        description: 'Second project',
        metadata: { project: '2' },
      },
    })

    const missing = { ...pending, authorizationDetails: [{ ...requested, project_id: 'missing' }] }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(missing)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(missing)
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).rejects.toThrow(
      'Resource was not found.',
    )
  })

  it('advertises the external authorization server token endpoint in credential offers', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({ ...connectionRecord(), clientGeneration: 2 })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        clientGeneration: 3,
        retiredClientGenerations: [
          {
            generation: 2,
            clientId: 'old-client',
            encryptedClientSecret: 'sealed:old-secret',
            clientSecretContext: 'connector:connector-1:client-generation:2:client-secret',
            registrationClientUri: null,
            encryptedRegistrationAccessToken: null,
            registrationAccessTokenContext: null,
            registeredScopes: ['projects:read'],
          },
        ],
      }),
    )
    const approved = { ...requestRecord(), status: 'approved' as const, grantId: 'grant-1' }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(approved)

    await expect(getAccessRequest(deps, approved.id, principal(), 'https://auth.example.com')).resolves.toMatchObject({
      credentialOffer: { proof: { uri: 'https://projects.example.com/token' } },
    })

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({ ...approved, connectionId: null })
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord({ clientGeneration: undefined }))
    await expect(getAccessRequest(deps, approved.id, principal(), 'https://auth.example.com')).resolves.toMatchObject({
      credentialOffer: { proof: { uri: 'https://projects.example.com/token' } },
    })

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(approved)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({ ...connectionRecord(), clientGeneration: 99 })
    await expect(getAccessRequest(deps, approved.id, principal(), 'https://auth.example.com')).rejects.toThrow(
      'Active external API resource authorization was not found.',
    )
  })

  it('paginates service fallback Resources and renders active connection approvals', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())

    await expect(
      listAgentAuthorizationDetailCatalog(
        deps,
        resource().id,
        principal(),
        { limit: 10, offset: 1 },
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ items: [], pagination: { total: 1 } })

    await createAgentResourceConnectionRequest(
      deps,
      resource().id,
      { scopes: ['projects:read'] },
      principal(),
      'https://auth.example.com',
    )
    const stored = vi.mocked(deps.externalResources.createAgentConnectionRequest).mock.calls[0]![0]
    vi.mocked(deps.externalResources.findAgentConnectionRequestByApprovalTokenHash).mockResolvedValue(stored)
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue({
      ...connectionRecord(),
      updatedAt: new Date(Date.now() + 60_000),
    })
    await expect(getAccountResourceConnectionApproval(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      status: 'connected',
      accountConnection: { id: connectionRecord().id, status: 'active' },
    })
  })

  it('expands an organization connection with merged Resource authorization details', async () => {
    const deps = createTestDeps()
    const template = { type: 'project_access', actions: ['read'] }
    const existingDetail = { ...template, project_id: 'project-1' }
    const requestedDetail = { ...template, project_id: 'project-2' }
    authorizationDeps(deps)
    vi.mocked(deps.authorization.findResource).mockResolvedValue({ ...resource(), authorizationDetails: [template] })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerMetadata: {
          ...metadata(),
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://projects.example.com/par',
        },
      }),
    )
    const organizationOpenApiFetch = vi.mocked(deps.externalHttp.fetch).getMockImplementation()!
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url === 'https://projects.example.com/par') {
        return Response.json({ request_uri: 'urn:request:organization', expires_in: 300 }, { status: 201 })
      }
      return organizationOpenApiFetch(request)
    })
    const organizationIdentity = identityAggregate()
    organizationIdentity.identity.ownerUserId = null
    organizationIdentity.identity.ownerOrganizationId = 'org-1'
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(organizationIdentity)
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ roles: ['owner'] } as never)
    const connection = {
      ...connectionRecord(),
      ownerUserId: null,
      ownerOrganizationId: 'org-1',
      authorizationDetails: [existingDetail],
    }
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => record)

    await createAgentResourceConnectionRequest(
      deps,
      resource().id,
      { scopes: ['projects:read'] },
      principal(),
      'https://auth.example.com',
    )
    const stored = {
      ...vi.mocked(deps.externalResources.createAgentConnectionRequest).mock.calls[0]![0],
      authorizationDetails: [requestedDetail],
    }
    vi.mocked(deps.externalResources.findAgentConnectionRequestByApprovalTokenHash).mockResolvedValue(stored)

    await expect(
      createAccountConnection(
        deps,
        { context: 'connection-request', approvalToken: 'approval-token' },
        'user-1',
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      owner: { type: 'organization', organizationId: 'org-1' },
      authorizationDetails: expect.arrayContaining([existingDetail, requestedDetail]),
    })
  })

  it('rejects external approval Resources without their active account connection', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const detail = { type: 'project_access', project_id: 'project-1', actions: ['read'] }
    const pending = { ...requestRecord(), authorizationDetails: [detail] }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(pending)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(pending)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(null)
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).rejects.toThrow(
      'Resource account connection was not found.',
    )

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({ ...connectionRecord(), status: 'revoked' })
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).rejects.toThrow(
      'Active resource account connection was not found.',
    )
  })

  it('rejects missing and inconsistent external authorization catalogs', async () => {
    const request = requestRecord()
    const missingCatalog = authorizationCatalogDeps({ providerMetadata: metadata() })
    vi.mocked(missingCatalog.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(missingCatalog.externalResources.findConnection).mockResolvedValue(connectionRecord())
    await expect(
      listAccountAccessRequestAuthorizationDetailCatalog(missingCatalog, request.id, 'approval-token', 'user-1', {
        limit: 100,
        offset: 0,
      }),
    ).rejects.toThrow('does not advertise an authorization detail catalog')

    const mismatched = authorizationCatalogDeps({
      fetchResponse: Response.json({
        items: [],
        pagination: { limit: 99, offset: 0, total: 0, hasMore: false, nextOffset: null },
      }),
    })
    vi.mocked(mismatched.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(mismatched.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      grantedScopes: [...connectionRecord().grantedScopes, 'authorization-details:read'],
    })
    await expect(
      listAccountAccessRequestAuthorizationDetailCatalog(mismatched, request.id, 'approval-token', 'user-1', {
        limit: 100,
        offset: 0,
      }),
    ).rejects.toThrow('mismatched pagination metadata')
  })

  it('rejects duplicate Resource references and propagates non-OAuth connection failures', async () => {
    const duplicateDeps = createTestDeps()
    authorizationDeps(duplicateDeps)
    vi.mocked(duplicateDeps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(duplicateDeps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    const service = `https://auth.example.com/api/resource-servers/${resource().id}/resources/service`
    await expect(
      createAgentResourceConnectionRequest(
        duplicateDeps,
        resource().id,
        { scopes: ['projects:read'], resources: [{ href: service }, { href: service }] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resources must be unique.')

    const discoveryDeps = createTestDeps()
    authorizationDeps(discoveryDeps)
    vi.mocked(discoveryDeps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(discoveryDeps.externalResources.listConnectionsByOrganizations).mockResolvedValue([
      { ...connectionRecord(), credentialExpiresAt: new Date(0) },
    ])
    vi.mocked(discoveryDeps.secrets.open).mockRejectedValueOnce(new Error('credential storage failed'))
    await expect(discoverAgentResources(discoveryDeps, principal())).rejects.toThrow('credential storage failed')
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
      scopeRegistry: null,
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
    vi.mocked(deps.connectors.findById).mockResolvedValue(null)
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
    mockResourceOpenApi(deps, healthy.resourceUrl)

    const result = await listAgentApiResources(deps, principal(), { limit: 10, offset: 0 }, 'https://auth.example.com')
    expect(result).toMatchObject({ pagination: { total: 2 } })
    expect(result.items[0]).toMatchObject({ id: unavailable.id, availability: { status: 'unavailable' }, scopes: [] })
    expect(result.items[1]).toMatchObject({ id: healthy.id, availability: { status: 'available' } })
    expect(result.items[1]?.scopes).toEqual(
      expect.arrayContaining([{ value: 'projects:read', description: 'Read projects' }]),
    )
  })

  it('lists, reads, denies, and approves controlled access requests', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    const pendingExternal = requestRecord()
    const pendingNative = { ...requestRecord(), id: 'request-2', connectionId: null }
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connectionRecord()])
    vi.mocked(deps.externalResources.listPendingAccessRequests).mockResolvedValue([pendingExternal, pendingNative])
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(pendingExternal)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(pendingExternal)

    await expect(listControllerAccessRequests(deps, 'user-1')).resolves.toMatchObject({
      requests: [{ id: 'request-1' }, { id: 'request-2' }],
    })
    await expect(listAccountAccessRequests(deps, 'user-1', { limit: 1, offset: 1 })).resolves.toMatchObject({
      items: [
        {
          id: 'request-2',
          requiresAccountConnection: true,
          agent: { id: 'identity-1', name: 'Project Agent' },
          resource: {
            id: 'service',
            name: 'Projects API',
            authorizationDetailTemplates: resource().authorizationDetails,
          },
        },
      ],
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
    ).resolves.toMatchObject({ status: 'approved' })
  })

  it('lists grants and revokes grants, identities, and binding leases', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.listGrants).mockResolvedValue({
      items: [grantRecord()],
      total: 1,
      limit: 10,
      offset: 0,
    })
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([grantRecord()])
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      grantId: 'grant-1',
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.revokeGrant).mockResolvedValue(true)

    await expect(
      listAgentAccessGrants(deps, principal(), {
        limit: 10,
        offset: 0,
        resourceId: 'resource-1',
        status: 'active',
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'grant-1', target: { accountConnectionId: 'connection-1' } }],
    })
    expect(deps.externalResources.listGrants).toHaveBeenCalledWith({
      agentId: 'identity-1',
      limit: 10,
      offset: 0,
      resourceId: 'resource-1',
      status: 'active',
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
      authorizationDetails: [],
      expiresAt: new Date(Date.now() + 300_000),
      revokedAt: null,
      createdAt: now,
    }
    vi.mocked(deps.externalResources.listActiveTokenLeasesByBinding).mockResolvedValue([
      { ...lease, grantId: 'missing' },
      lease,
    ])
    vi.mocked(deps.externalResources.findGrant).mockResolvedValueOnce(null).mockResolvedValueOnce(grantRecord())
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
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
        act: {
          iss: 'https://auth.example.com/api/auth',
          sub: 'agt_stable',
          sub_profile: 'ai_agent',
        },
      }),
      'at+jwt',
    )
    vi.mocked(deps.externalResources.createTokenLease).mockResolvedValueOnce(null)
    await expect(
      issueTargetAccessToken(
        deps,
        'grant-1',
        proof,
        'https://auth.example.com/api/access-grants/grant-1/tokens',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('Active Agent access grant is required.')
  })

  it('enforces identity, resource, connection, and direct grant scope boundaries on requests', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
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
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Enabled Resource Server')

    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(null)
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Active resource account connection')

    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue({
      ...connectionRecord(),
      grantedScopes: ['openid'],
    })
    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ status: 'pending', scopes: ['projects:read'] })
  })

  it('[spec: agent-identity/agent-resource-access-without-role] allows an Agent without roles to request advertised scopes', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
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

  it('reuses a durable grant that covers a narrower temporary credential request', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const durableGrant = {
      ...grantRecord(),
      mode: 'persistent' as const,
      scopes: ['projects:read', 'projects:write'],
    }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([durableGrant])
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      grantId: durableGrant.id,
      scopes: durableGrant.scopes,
    })
    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    await expect(
      createAgentAccessRequest(
        deps,
        { resourceId: 'resource-1', scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      status: 'approved',
      scopes: ['projects:read'],
      grantId: durableGrant.id,
      approvalUrl: null,
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
      ownerOrganizationId: null,
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
        { resource: { href: '/api/resource-servers/missing/resources/service' }, scopes: [] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Resource href does not belong to the selected Resource Server.')

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

    vi.mocked(deps.connectors.findById).mockResolvedValueOnce(null)
    await expect(getExternalResourceAuthorization(deps, 'resource-1')).rejects.toThrow(
      'External API resource authorization was not found.',
    )
    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce(null)
    await expect(getApiResource(deps, 'missing')).rejects.toThrow('API resource was not found.')
    vi.mocked(deps.connectors.findById).mockResolvedValueOnce(null)
    await expect(getApiResource(deps, 'resource-1')).resolves.toMatchObject({ authorization: null })
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(null)
    await expect(
      completeResourceConnectionIntent(deps, { state: 'invalid', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('Resource connection state is invalid')

    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([
      resource(),
      { ...nativeResource(), id: 'native' },
    ])
    vi.mocked(deps.connectors.findById).mockResolvedValue(null)
    await expect(listConnectableExternalResources(deps)).resolves.toEqual({ resources: [] })
  })

  it('[spec: agent-identity/external-resource-first-access] consumes a failed OAuth connection attempt', async () => {
    const deps = createTestDeps()
    const intent: ResourceConnectionIntentRecord = {
      id: 'failed-intent',
      stateHash: 'state-hash',
      resourceId: 'resource-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      initiatedByUserId: 'user-1',
      scopes: ['openid'],
      authorizationDetails: [],
      encryptedPkceVerifier: 'sealed:pkce-verifier',
      returnTo: 'connection-approval',
      status: 'completed',
      expiresAt: new Date(Date.now() + 300_000),
      completedAt: new Date(),
      createdAt: now,
      updatedAt: now,
    }
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(intent)

    await expect(failResourceConnectionIntent(deps, 'provider-state')).resolves.toEqual({
      returnTo: 'connection-approval',
    })
    expect(deps.externalResources.consumeConnectionIntent).toHaveBeenCalledWith(expect.any(String), expect.any(Date))

    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(null)
    await expect(failResourceConnectionIntent(deps, 'provider-state')).rejects.toThrow(
      'Resource connection state is invalid, expired, or already used.',
    )
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
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      resources: [
        {
          connection: {
            status: 'connected',
            displayName: 'Project Owner',
            authorizedScopes: ['projects:read'],
          },
        },
      ],
    })
    await expect(
      listAgentApiResources(deps, principal(), { limit: 10, offset: 0 }, 'https://auth.example.com'),
    ).resolves.toMatchObject({
      items: [
        {
          connection: {
            status: 'connected',
            displayName: 'Project Owner',
            authorizedScopes: ['projects:read'],
          },
        },
      ],
    })
  })

  it('[spec: agent-identity/agent-resource-access-ensure] returns an approved request immediately for an exact active grant', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([
      { ...grantRecord(), connectionId: 'other-connection' },
      { ...grantRecord(), resourceId: 'other-resource' },
      { ...grantRecord(), scopes: ['projects:write'] },
      { ...grantRecord(), expiresAt: new Date(Date.now() - 1) },
      grantRecord(),
    ])
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      grantId: 'grant-1',
    })
    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
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

  it('requires approval when an active grant does not match its approved request', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([grantRecord()])
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      grantId: 'grant-1',
      authorizationDetails: [{ type: 'project_access', identifier: 'project-1' }],
    })
    vi.mocked(deps.externalResources.listPendingAccessRequestsByAgent).mockResolvedValue([])
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    await expect(
      createAgentAccessRequest(
        deps,
        {
          resourceId: 'resource-1',
          scopes: ['projects:read'],
          reason: 'Scheduled synchronization',
        },
        principal(),
        'https://auth.example.com/',
      ),
    ).resolves.toMatchObject({
      status: 'pending',
      grantId: null,
      approvalUrl: expect.stringContaining('/agent/resource-access/approve#token='),
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
      agentIdentityId: 'another-agent',
      status: 'approved',
    })
    await expect(
      issueTargetAccessToken(deps, 'grant-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Approved Agent access request is required.')
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      grantId: 'another-grant',
    })
    await expect(
      issueTargetAccessToken(
        deps,
        'grant-1',
        'proof',
        'https://auth.example.com/token',
        principal(),
        signer,
        'request-1',
      ),
    ).rejects.toThrow('Approved Agent access request is required.')
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'denied',
    })
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
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      authorizationDetails: [{ type: 'unexpected', id: '1' }],
    })
    await expect(
      issueTargetAccessToken(deps, 'grant-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('authorization details do not match')

    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
    })
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

  it('binds a Realmroot management token to exactly one authority Resource', async () => {
    const deps = createTestDeps()
    const builtIn = {
      ...nativeResource(),
      id: 'res_realmroot',
      identifier: 'realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    const authority = { type: 'realmroot_authority', authority: 'organization', id: 'org-1' }
    authorizationDeps(deps)
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findGrant).mockResolvedValue({
      ...grantRecord(),
      resourceId: builtIn.id,
      connectionId: null,
      scopes: ['users:read'],
      authorizationDetails: [authority],
      mode: 'persistent',
    })
    vi.mocked(deps.externalResources.findAccessRequestByGrant).mockResolvedValue({
      ...requestRecord(),
      resourceId: builtIn.id,
      connectionId: null,
      scopes: ['users:read'],
      authorizationDetails: [authority],
      status: 'approved',
    })
    const signer = { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('realmroot-token') }
    const tokenUrl = 'https://auth.example.com/api/agents/identity-1/access-grants/grant-1/credentials'

    const result = await issueTargetAccessToken(
      deps,
      'grant-1',
      await createDpopProof(tokenUrl),
      tokenUrl,
      principal(),
      signer,
    )

    expect(result).toMatchObject({
      accessToken: 'realmroot-token',
      authorizationDetails: [authority],
      resourceUrl: builtIn.resourceUrl,
    })
    expect(signer.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: principal().subject,
        aud: builtIn.resourceUrl,
        host_id: principal().hostId,
        groups: ['org-1'],
        realmroot_authority: authority,
        scope: expect.stringContaining('users:read'),
      }),
      'at+jwt',
    )
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

    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord({ enabled: false }))
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
        authorizationDetails: [],
        expiresAt: new Date(Date.now() + 30_000),
        revokedAt: null,
        createdAt: now,
      },
    ])
    await revokeAgentResourceAccess(deps, 'identity-1')
    expect(deps.externalResources.revokeTokenLease).toHaveBeenCalledWith('lease-native', expect.any(Date))

    vi.mocked(deps.authorization.findResource).mockResolvedValue(null)
    await expect(revokeAgentResourceAccess(deps, 'identity-1')).rejects.toThrow('API resource was not found.')
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

    const uncontrolled = createTestDeps()
    authorizationDeps(uncontrolled)
    vi.mocked(uncontrolled.externalResources.listConnectionsByUser).mockResolvedValue([])
    vi.mocked(uncontrolled.externalResources.listPendingAccessRequests).mockResolvedValue([
      { ...requestRecord(), connectionId: null },
    ])
    vi.mocked(uncontrolled.agentIdentities.findIdentity).mockResolvedValue({
      ...identityAggregate(),
      identity: { ...identityAggregate().identity, ownerUserId: 'another-user', ownerOrganizationId: null },
    })
    await expect(listControllerAccessRequests(uncontrolled, 'user-1')).resolves.toEqual({ requests: [] })

    const mismatched = createTestDeps()
    authorizationDeps(mismatched)
    vi.mocked(mismatched.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(requestRecord())
    vi.mocked(mismatched.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(mismatched.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    await expect(getAccountAccessRequest(mismatched, 'another-request', 'user-1', 'approval-token')).rejects.toThrow(
      'Agent access request was not found.',
    )

    const missingIdentity = createTestDeps()
    authorizationDeps(missingIdentity)
    vi.mocked(missingIdentity.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(requestRecord())
    vi.mocked(missingIdentity.externalResources.findAccessRequest).mockResolvedValue(requestRecord())
    vi.mocked(missingIdentity.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(missingIdentity.agentIdentities.findIdentity)
      .mockResolvedValueOnce(identityAggregate())
      .mockResolvedValueOnce(null)
    await expect(getAccountAccessRequestByToken(missingIdentity, 'approval-token', 'user-1')).rejects.toThrow(
      'Agent identity was not found.',
    )

    const missingResource = createTestDeps()
    authorizationDeps(missingResource)
    vi.mocked(missingResource.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(requestRecord())
    vi.mocked(missingResource.externalResources.findAccessRequest).mockResolvedValue(requestRecord())
    vi.mocked(missingResource.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(missingResource.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(missingResource.authorization.findResource).mockResolvedValue(null)
    await expect(getAccountAccessRequestByToken(missingResource, 'approval-token', 'user-1')).rejects.toThrow(
      'API resource was not found.',
    )
  })
})

function authorizationDeps(deps: ReturnType<typeof createTestDeps>) {
  Object.assign(deps.authorization, {
    findResource: vi.fn().mockResolvedValue(resource()),
    listResources: vi.fn().mockResolvedValue({ items: [resource()], total: 1, limit: 100, offset: 0 }),
    listEnabledResources: vi.fn().mockResolvedValue([resource()]),
    listUserMemberships: vi.fn().mockResolvedValue([{ organizationId: 'org-1', roles: ['owner'] }]),
    listActiveUserScopeGrants: vi
      .fn()
      .mockResolvedValue([{ scopes: resourceScopeValues, expiresAt: null, revokedAt: null }]),
    listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
    findMemberByOrganizationUser: vi.fn().mockResolvedValue({
      id: 'member-1',
      organizationId: 'org-1',
      userId: 'user-1',
      roles: ['owner'],
    }),
    updateResource: vi.fn().mockResolvedValue(true),
  })
  vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
  mockResourceOpenApi(deps, resource().resourceUrl)
}

function resource(): ApiResourceResponse {
  return {
    id: 'resource-1',
    identifier: 'projects',
    name: 'Projects API',
    resourceUrl: 'https://projects.example.com/api',
    connectorId: 'connector-1',
    authorizationDetails: [],
    description: 'Manage private projects',
    enabled: true,
    ownerOrganizationId: 'org-1',
    visibility: 'public',
    scopeRegistry: {
      discovery: {
        sourceUrl: 'https://projects.example.com/openapi.json',
        etag: null,
        documentHash: 'projects-registry',
        syncedAt: now.toISOString(),
        lastError: null,
      },
      scopes: resourceScopeValues.map((value) => ({
        value,
        description: value === 'projects:read' ? 'Read projects' : `Allows ${value}`,
        grantMode: 'assigned' as const,
      })),
    },
    availableToAgents: true,
    archivedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

const resourceScopeValues = [
  'authorization-details:read',
  'objects:create',
  'objects:purge',
  'projects:create',
  'projects:read',
  'projects:write',
  'quota:purchase',
  'shares:create',
  'teams:read',
]

function nativeResource(): ApiResourceResponse {
  return {
    ...resource(),
    connectorId: null,
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

function authorizationCatalogDeps(
  options: { providerMetadata?: Record<string, unknown>; grantedScopes?: string[]; fetchResponse?: Response } = {},
) {
  const deps = createTestDeps()
  authorizationDeps(deps)
  const template = { type: 'project_access', actions: ['read'] }
  vi.mocked(deps.authorization.findResource).mockResolvedValue({
    ...resource(),
    authorizationDetails: [template],
  })
  vi.mocked(deps.connectors.findById).mockResolvedValue(
    connectorRecord({
      providerMetadata:
        options.providerMetadata ??
        ({
          ...metadata(),
          authorization_details_types_supported: ['project_access'],
          authorization_details_catalog_endpoint: 'https://projects.example.com/authorization-details',
          authorization_details_catalog_scope: 'authorization-details:read',
          authorization_details_catalog_version: 1,
        } as ConnectorRecord['providerMetadata']),
    }),
  )
  vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
  vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue({
    ...connectionRecord(),
    grantedScopes: options.grantedScopes ?? [...connectionRecord().grantedScopes, 'authorization-details:read'],
  })
  vi.mocked(deps.externalResources.listActiveGrantsByAgent).mockResolvedValue([])
  if (options.fetchResponse) vi.mocked(deps.externalHttp.fetch).mockResolvedValue(options.fetchResponse)
  return deps
}

function connectorRecord(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  const providerMetadata: Record<string, unknown> = overrides.providerMetadata ?? metadata()
  const authorizationDetailsCatalogScope =
    typeof providerMetadata.authorization_details_catalog_scope === 'string'
      ? providerMetadata.authorization_details_catalog_scope
      : null
  return {
    id: 'connector-1',
    slug: 'projects',
    providerType: 'generic_oauth',
    providerId: 'projects',
    displayName: 'Projects',
    enabled: true,
    loginEnabled: false,
    clientId: 'realmroot-client',
    clientSecret: 'target-secret',
    clientSecretContext: null,
    issuer: 'https://projects.example.com',
    authorizationEndpoint: 'https://projects.example.com/authorize',
    tokenEndpoint: 'https://projects.example.com/token',
    userInfoEndpoint: 'https://projects.example.com/userinfo',
    jwksEndpoint: 'https://projects.example.com/jwks',
    registrationEndpoint: 'https://projects.example.com/register',
    revocationEndpoint: 'https://projects.example.com/revoke',
    registrationMode: 'dynamic',
    registrationClientUri: null,
    registrationAccessToken: null,
    registrationAccessTokenContext: null,
    registeredScopes: [
      'openid',
      'profile',
      'email',
      'offline_access',
      'projects:read',
      'projects:write',
      ...(authorizationDetailsCatalogScope ? [authorizationDetailsCatalogScope] : []),
    ],
    clientGeneration: 1,
    retiredClientGenerations: null,
    scopes: ['openid', 'offline_access'],
    attributeMapping: null,
    providerMetadata,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function mockResourceOpenApi(deps: ReturnType<typeof createTestDeps>, resourceUrl: string, scopes = ['projects:read']) {
  vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
    if (request.url === 'https://projects.example.com/.well-known/openid-configuration') {
      return Response.json(metadata())
    }
    if (request.url === protectedResourceMetadataUrl(resourceUrl)) {
      return Response.json({ resource: resourceUrl, scopes_supported: scopes })
    }
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
                  scopes: Object.fromEntries(
                    scopes.map((scope) => [scope, scope === 'projects:read' ? 'Read projects' : `Allows ${scope}`]),
                  ),
                },
              },
            },
          },
        },
        paths: {
          '/projects': {
            get: { security: [{ oauth: scopes }], responses: {} },
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
    ownerUserId: null,
    ownerOrganizationId: 'org-1',
    externalSubject: 'target-user-1',
    displayName: 'Project Owner',
    encryptedTokens: 'sealed:{"accessToken":"subject","refreshToken":"refresh"}',
    grantedScopes: ['openid', 'offline_access', 'projects:read'],
    authorizationDetails: [],
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
      ownerUserId: null,
      ownerOrganizationId: 'org-1',
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

async function createDpopProof(tokenEndpoint: string) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  return new SignJWT({
    htm: 'POST',
    htu: tokenEndpoint,
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .sign(privateKey)
}

function requestRecord(): AgentAccessRequestRecord {
  return {
    id: 'request-1',
    resourceId: 'resource-1',
    connectionId: 'connection-1',
    agentIdentityId: 'identity-1',
    bindingId: 'binding-1',
    scopes: ['projects:read'],
    authorizationDetails: [],
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
    authorizationDetails: [],
    mode: 'once',
    status: 'active',
    grantedByUserId: 'user-1',
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}
