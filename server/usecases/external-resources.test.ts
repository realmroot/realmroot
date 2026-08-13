import { badGateway } from '@server/domain/errors'
import { createTestDeps } from '@server/http/test-deps'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import {
  completeResourceConnectionIntent,
  createAccessRequest,
  createAccessRequestCredential,
  createAccountConnection,
  createAgentAccessRequest,
  createAgentConnectionRequest as createAgentResourceConnectionRequest,
  createProviderConnectionIntent,
  createResourceConnectionIntent,
  decideAccessRequest,
  decideAgentAccessRequest,
  decideAgentAccessRequestByToken,
  disconnectProviderConnection,
  discoverAgentResources,
  exchangeAgentConnectionCredential,
  failResourceConnectionIntent,
  getAccessRequest,
  getAccountAccessRequest,
  getAccountAccessRequestByToken,
  getAccountConnection,
  getAccountResourceConnectionApproval,
  getAgentAccessRequest,
  getAgentPermission,
  getAgentConnectionRequest as getAgentResourceConnectionActivation,
  getAgentResourceServer,
  getApiResource,
  getControllerAccessRequestByToken,
  getExternalResourceAuthorization,
  issueTargetAccessToken,
  listAccessRequestConnections,
  listAccountAccessRequestAuthorizationDetailCatalog,
  listAccountAccessRequests,
  listAccountConnections,
  listAccountProviderConnections,
  listAccountProviderConnectors,
  listAgentResourceServers as listAgentApiResources,
  listAgentResourceServerAuthorizationDetails as listAgentAuthorizationDetailCatalog,
  listAgentPermissions,
  listApiResources,
  listConnectableExternalResources,
  listControllerAccessRequests,
  listResourceConnections,
  revokeAgentPermission,
  revokeAgentResourceAccess,
  revokeAgentResourceLeasesForBinding,
  revokeResourceConnection,
} from '@server/usecases/external-resources'
import type {
  AgentAccessRequestRecord,
  AgentIdentityAggregate,
  ConnectorRecord,
  ProviderConnectionRecord,
  ProviderCredentialRecord,
  ProviderResourceAuthorizationRecord,
  ResourceConnectionIntentRecord,
  ResourceScopeEntitlementRecord,
} from '@server/usecases/ports'
import { validateExternalResourceConnector } from '@server/usecases/resource-connectors'
import { protectedResourceMetadataUrl } from '@server/usecases/resource-metadata'
import { accessTokenType, exchangeToken, tokenExchangeGrantType } from '@server/usecases/token-exchange'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { exportJWK, generateKeyPair, type JWTHeaderParameters, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const now = new Date('2026-07-29T12:00:00.000Z')

describe('external API resource authorization', () => {
  it('rejects a deleted external resource connection intent', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.authorization.findResource).mockResolvedValue(null)

    await expect(
      createResourceConnectionIntent(
        deps,
        'resource-1',
        { owner: { type: 'user' }, scopes: [] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toThrow('External API resource was not found.')

    vi.mocked(deps.authorization.findResource).mockResolvedValue({ ...resource(), enabled: false })
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
    const stored = vi.mocked(deps.externalResources.createResourceAuthorization).mock.calls[0]![0]
    expect(stored.credentials[0]!.clientGeneration).toBe(1)
    expect(stored.credentials[0]!.encryptedTokens).not.toContain('subject-refresh')

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

    vi.mocked(deps.externalResources.createResourceAuthorization).mockResolvedValueOnce(null)
    await expect(
      completeResourceConnectionIntent(
        deps,
        { state: 'deleted-state', code: 'deleted-code' },
        'https://auth.example.com/',
      ),
    ).rejects.toThrow('deleted while completing the connection')
  })

  it('authorizes connector-backed native access without provider-specific OAuth parameters [spec: agent-identity/connector-backed-native-agent-connection]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...nativeResource(),
      providerConnection: { connectorId: 'connector-1', mode: 'managed' },
      resourceUrl: 'https://adapters.example.com/cloudflare',
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => record)

    const result = await createResourceConnectionIntent(
      deps,
      'resource-1',
      { owner: { type: 'user' }, scopes: ['projects:read'] },
      'user-1',
      'https://auth.example.com',
    )
    const url = new URL(result.authorizationUrl)
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(['offline_access', 'openid', 'projects:read'])
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.has('resource')).toBe(false)
    expect(url.searchParams.has('authorization_details')).toBe(false)
    expect(url.searchParams.has('request_uri')).toBe(false)

    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...nativeResource(),
      providerConnection: { connectorId: 'connector-1', mode: 'managed' },
      authorizationDetails: [{ type: 'linear_workspace' }],
      resourceUrl: 'https://adapters.example.com/linear',
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({ providerType: 'social', providerId: 'linear' }),
    )

    const linear = await createResourceConnectionIntent(
      deps,
      'resource-1',
      {
        owner: { type: 'user' },
        scopes: ['projects:read'],
        authorizationDetails: [{ type: 'linear_workspace' }],
      },
      'user-1',
      'https://auth.example.com',
    )
    const linearUrl = new URL(linear.authorizationUrl)
    expect(linearUrl.origin).toBe('https://linear.app')
    expect(linearUrl.searchParams.get('scope')).toBe('projects:read')
    expect(linearUrl.searchParams.get('actor')).toBe('app')
    expect(linearUrl.searchParams.has('authorization_details')).toBe(false)
  })

  it('fails managed OAuth completion when its driver disappears or identity lookup fails', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const intent: ResourceConnectionIntentRecord = {
      id: 'intent-1',
      stateHash: 'state-hash',
      resourceId: 'resource-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      initiatedByUserId: 'user-1',
      scopes: ['projects:read'],
      authorizationDetails: [],
      encryptedPkceVerifier: 'sealed:pkce-verifier',
      authorizationMode: 'oauth',
      clientGeneration: 1,
      returnTo: 'account-center',
      status: 'completed',
      expiresAt: new Date(Date.now() + 300_000),
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(intent)
    vi.mocked(deps.connectors.findById).mockResolvedValueOnce(connectorRecord()).mockResolvedValueOnce(null)

    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('no longer supports resource authorization')

    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) =>
      request.url.endsWith('/token')
        ? Response.json({ access_token: 'access', refresh_token: 'refresh' })
        : new Response(null, { status: 503 }),
    )
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('Provider connection identity request failed')
  })

  it('[spec: agent-identity/brokered-native-account-connection] connects one brokered native account without storing provider tokens', async () => {
    const deps = createTestDeps()
    const native = {
      ...resource(),
      authorizationModel: 'realmroot' as const,
      providerConnection: { connectorId: 'connector-1', mode: 'brokered' as const },
      authorizationDetails: [{ type: 'github_installation' }],
      scopeRegistry: {
        ...resource().scopeRegistry!,
        accountConnection: {
          mode: 'brokered' as const,
          authorizationEndpoint: 'https://adapter.example/github/account-connection-authorizations',
          tokenEndpoint: 'https://adapter.example/github/account-connection-credentials',
        },
      },
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    let intent: ResourceConnectionIntentRecord | null = null
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => {
      intent = record
      return record
    })
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockImplementation(async () => intent)

    await expect(
      createResourceConnectionIntent(
        deps,
        native.id,
        { owner: { type: 'user' }, scopes: ['projects:read'] },
        'user-1',
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Brokered account connections require Realmroot signing.')

    const pending = await createResourceConnectionIntent(
      deps,
      native.id,
      { owner: { type: 'user' }, scopes: ['projects:read'] },
      'user-1',
      'https://auth.example.com',
      { issuer: 'https://auth.example.com/api/auth', sign: vi.fn(async () => 'signed-request-object') },
    )
    expect(new URL(pending.authorizationUrl).searchParams.get('request')).toBe('signed-request-object')
    expect(intent).toMatchObject({ authorizationMode: 'brokered', ownerUserId: 'user-1' })

    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      expect(request.url).toBe('https://adapter.example/github/account-connection-credentials')
      const form = new URLSearchParams(await request.text())
      expect(form.get('code')).toBe('adapter-code')
      expect(form.get('code_verifier')).toBeTruthy()
      return Response.json({
        external_subject: 'github-user-7',
        display_name: 'GitHub Controller',
        broker_reference: 'connection-1',
        scope: 'projects:read',
        authorization_details: [
          { type: 'github_installation', installation_id: '152097080', account_login: 'realmroot' },
        ],
      })
    })

    const connection = await completeResourceConnectionIntent(
      deps,
      { state: 'realmroot-state', code: 'adapter-code' },
      'https://auth.example.com',
    )
    expect(connection).toMatchObject({
      externalSubject: 'github-user-7',
      authorizationDetails: [{ type: 'github_installation', installation_id: '152097080' }],
    })
    expect(vi.mocked(deps.externalResources.createResourceAuthorization).mock.calls[0]?.[0]).toMatchObject({
      credentials: [
        expect.objectContaining({
          credentialCustody: 'resource_server',
          encryptedTokens: null,
          brokerReference: 'connection-1',
        }),
      ],
    })
  })

  it('[spec: agent-identity/brokered-resource-context-catalog] uses brokered Resource Server display data', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const detail = {
      type: 'github_installation',
      installation_id: '42',
      account_login: 'realmroot',
      target_type: 'Organization',
      repository_selection: 'all',
    }
    const brokered = {
      ...resource(),
      authorizationModel: 'realmroot' as const,
      providerConnection: { connectorId: 'connector-1', mode: 'brokered' as const },
      authorizationDetails: [{ type: 'github_installation' }],
      scopeRegistry: {
        ...resource().scopeRegistry!,
        accountConnection: {
          mode: 'brokered' as const,
          authorizationEndpoint: 'https://adapter.example/github/account-connection-authorizations',
          tokenEndpoint: 'https://adapter.example/github/account-connection-credentials',
          authorizationDetailsEndpoint: 'https://adapter.example/github/account-connection-authorization-details',
        },
      },
    }
    const connection = connectionWithCredential(connectionRecord(), {
      credentialCustody: 'resource_server',
      encryptedTokens: null,
      authorizationDetails: [detail],
      grantedScopes: ['issues:read', 'issues:write'],
      brokerReference: 'broker-reference-1',
    })
    vi.mocked(deps.authorization.findResource).mockResolvedValue(brokered)
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      slug: 'realmroot',
      name: 'Realmroot',
      displayName: 'Realmroot',
      logo: null,
      disabled: false,
      disabledReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      { ...grantRecord(), scope: 'issues:read', authorizationDetails: [detail] },
    ])
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      expect(request.url).toBe(
        'https://adapter.example/github/account-connection-authorization-details?limit=100&offset=0',
      )
      expect(request.headers.get('authorization')).toBe('Bearer broker-reference-1')
      return Response.json({
        items: [
          {
            authorizationDetail: detail,
            display: {
              label: 'realmroot',
              description: 'Organization GitHub App installation',
              metadata: { accountType: 'Organization', repositories: 'All repositories' },
            },
          },
        ],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false, nextOffset: null },
      })
    })

    await expect(
      listAgentAuthorizationDetailCatalog(deps, brokered.id, principal(), { limit: 100, offset: 0 }),
    ).resolves.toEqual({
      items: [
        {
          authorizationDetail: detail,
          name: 'realmroot',
          description: 'Organization GitHub App installation',
          metadata: { accountType: 'Organization', repositories: 'All repositories' },
          accountAuthorizationStatus: 'authorized',
          authorizedScopes: ['issues:read'],
          requestableScopes: ['issues:write'],
        },
      ],
      pagination: { limit: 100, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })
  })

  it('[spec: account-center/provider-connections] starts a Provider connection without an Agent request', async () => {
    const deps = createTestDeps()
    const brokered = {
      ...resource(),
      authorizationModel: 'realmroot' as const,
      providerConnection: { connectorId: 'connector-1', mode: 'brokered' as const },
      authorizationDetails: [{ type: 'github_installation' }],
      scopeRegistry: {
        ...resource().scopeRegistry!,
        accountConnection: {
          mode: 'brokered' as const,
          authorizationEndpoint: 'https://adapter.example/github/account-connection-authorizations',
          tokenEndpoint: 'https://adapter.example/github/account-connection-credentials',
        },
      },
    }
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([brokered])
    vi.mocked(deps.authorization.findResource).mockResolvedValue(brokered)
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (intent) => intent)
    const signer = { issuer: 'https://auth.example.com/api/auth', sign: vi.fn(async () => 'signed-request-object') }

    const intent = await createProviderConnectionIntent(
      deps,
      'connector-1',
      'user-1',
      'https://auth.example.com',
      signer,
    )

    expect(intent).toMatchObject({ connectorId: 'connector-1' })
    expect(new URL(intent.authorizationUrl).searchParams.get('request')).toBe('signed-request-object')
    expect(deps.externalResources.createConnectionIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'user-1',
        resourceId: brokered.id,
        returnTo: 'account-center',
        scopes: resourceScopeValues,
      }),
    )
  })

  it('rejects an unavailable or ambiguous Provider connection authority', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.connectors.findById).mockResolvedValue(null)
    await expect(
      createProviderConnectionIntent(deps, 'connector-1', 'user-1', 'https://auth.example.com'),
    ).rejects.toThrow('Enabled Provider Connector was not found')
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord({ enabled: false }))
    await expect(
      createProviderConnectionIntent(deps, 'connector-1', 'user-1', 'https://auth.example.com'),
    ).rejects.toThrow('Enabled Provider Connector was not found')
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([])

    await expect(
      createProviderConnectionIntent(deps, 'connector-1', 'user-1', 'https://auth.example.com'),
    ).rejects.toThrow('does not support direct account connection')

    const brokered = {
      ...resource(),
      authorizationModel: 'realmroot' as const,
      providerConnection: { connectorId: 'connector-1', mode: 'brokered' as const },
      scopeRegistry: {
        ...resource().scopeRegistry!,
        accountConnection: {
          mode: 'brokered' as const,
          authorizationEndpoint: 'https://adapter.example.com/authorizations',
          tokenEndpoint: 'https://adapter.example.com/credentials',
        },
      },
    }
    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([brokered, { ...brokered, id: 'resource-2' }])
    await expect(
      createProviderConnectionIntent(deps, 'connector-1', 'user-1', 'https://auth.example.com'),
    ).rejects.toThrow('more than one account connection authority')

    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([
      { ...brokered, scopeRegistry: { ...brokered.scopeRegistry, scopes: [] } },
    ])
    await expect(
      createProviderConnectionIntent(deps, 'connector-1', 'user-1', 'https://auth.example.com'),
    ).rejects.toThrow('does not declare any scopes')
  })

  it('[spec: account-center/provider-connections] derives Provider capabilities only from enabled Agent resources', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.connectors.listEnabled).mockResolvedValue([
      connectorRecord(),
      connectorRecord({ id: 'connector-sign-in', providerId: 'sign-in', authenticationEnabled: true }),
      connectorRecord({ id: 'connector-broker', providerId: 'broker' }),
    ])
    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([
      {
        ...resource(),
        providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
        availableToAgents: false,
      },
      {
        ...resource(),
        authorizationModel: 'realmroot',
        providerConnection: { connectorId: 'connector-broker', mode: 'brokered' as const },
        scopeRegistry: {
          ...resource().scopeRegistry!,
          accountConnection: {
            mode: 'brokered',
            authorizationEndpoint: 'https://adapter.example.com/authorizations',
            tokenEndpoint: 'https://adapter.example.com/credentials',
          },
        },
      },
    ])

    await expect(listAccountProviderConnectors(deps, { limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [
        {
          id: 'connector-1',
          capabilities: {
            agentAccess: { available: false },
            connection: { method: null },
          },
        },
        {
          id: 'connector-sign-in',
          capabilities: {
            agentAccess: { available: false },
            connection: { method: 'sign_in' },
          },
        },
        {
          id: 'connector-broker',
          capabilities: {
            agentAccess: { available: true },
            connection: { method: 'provider_authorization' },
          },
        },
      ],
    })
  })

  it('[spec: account-center/provider-connections] reports active Provider connection capabilities', async () => {
    const deps = createTestDeps()
    const connector = connectorRecord()
    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([
      {
        ...resource(),
        providerConnection: { connectorId: connector.id, mode: 'managed' as const },
        availableToAgents: true,
      },
    ])
    vi.mocked(deps.externalResources.listProviderConnectionsByUser).mockResolvedValue([
      {
        id: 'provider-connection-1',
        connectorId: connector.id,
        ownerUserId: 'user-1',
        ownerOrganizationId: null,
        authenticationAccountId: 'account-1',
        externalSubject: 'provider-user-1',
        displayName: 'Provider User',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        connector,
        resourceAuthorizationCount: 1,
        resourceNames: ['Projects'],
      },
      {
        id: 'provider-connection-2',
        connectorId: connector.id,
        ownerUserId: 'user-1',
        ownerOrganizationId: null,
        authenticationAccountId: null,
        externalSubject: 'provider-user-2',
        displayName: 'Unconfigured Provider User',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        connector,
        resourceAuthorizationCount: 0,
        resourceNames: [],
      },
    ])

    await expect(listAccountProviderConnections(deps, 'user-1', { limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [
        {
          capabilities: {
            signIn: { active: true },
            agentAccess: { active: true, authorizationCount: 1, resourceNames: ['Projects'] },
          },
        },
        {
          capabilities: {
            signIn: { active: false },
            agentAccess: { active: false, authorizationCount: 0, resourceNames: [] },
          },
        },
      ],
      pagination: { total: 2 },
    })
  })

  it('[spec: account-center/provider-connections] revokes broker custody before removing a Provider Connection', async () => {
    const deps = createTestDeps()
    const provider = {
      id: 'provider-connection-1',
      connectorId: 'connector-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      authenticationAccountId: null,
      externalSubject: 'provider-user-1',
      displayName: 'Provider User',
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    }
    const authorization = connectionWithCredential(
      {
        ...connectionRecord(),
        providerConnectionId: provider.id,
        ownerUserId: 'user-1',
        ownerOrganizationId: null,
      },
      {
        credentialCustody: 'resource_server',
        encryptedTokens: null,
        brokerReference: 'broker-reference-1',
      },
    )
    const brokered = {
      ...resource(),
      authorizationModel: 'realmroot' as const,
      providerConnection: { connectorId: 'connector-1', mode: 'brokered' as const },
      scopeRegistry: {
        ...resource().scopeRegistry!,
        accountConnection: {
          mode: 'brokered' as const,
          authorizationEndpoint: 'https://adapter.example.com/provider/authorizations',
          tokenEndpoint: 'https://adapter.example.com/provider/credentials',
          revocationEndpoint: 'https://adapter.example.com/provider/revocations',
        },
      },
    }
    vi.mocked(deps.externalResources.findProviderConnection).mockResolvedValue(provider)
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([authorization])
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(authorization)
    vi.mocked(deps.externalResources.listActiveEntitlementsByConnection).mockResolvedValue([])
    vi.mocked(deps.externalResources.revokeConnection).mockResolvedValue(true)
    vi.mocked(deps.externalResources.revokeProviderConnection).mockResolvedValue(true)
    vi.mocked(deps.authorization.findResource).mockResolvedValue(brokered)
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response(null, { status: 204 }))
    const signer = { issuer: 'https://auth.example.com/api/auth', sign: vi.fn(async () => 'signed-revocation') }

    await disconnectProviderConnection(deps, provider.id, 'user-1', signer)

    expect(deps.externalHttp.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://adapter.example.com/provider/revocations',
      }),
    )
    const request = vi.mocked(deps.externalHttp.fetch).mock.calls[0]![0]
    expect(await request.clone().text()).toBe('request=signed-revocation')
    expect(deps.externalResources.revokeProviderConnection).toHaveBeenCalledWith(
      provider.id,
      'user-1',
      expect.any(Date),
    )

    vi.mocked(deps.externalResources.revokeConnection).mockClear()
    vi.mocked(deps.externalResources.revokeProviderConnection).mockClear()
    vi.mocked(deps.externalHttp.fetch).mockRejectedValue(new Error('offline'))
    await expect(disconnectProviderConnection(deps, provider.id, 'user-1', signer)).rejects.toThrow(
      'revocation service is unavailable',
    )
    expect(deps.externalResources.revokeConnection).not.toHaveBeenCalled()
    expect(deps.externalResources.revokeProviderConnection).not.toHaveBeenCalled()

    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response(null, { status: 403 }))
    await expect(disconnectProviderConnection(deps, provider.id, 'user-1', signer)).rejects.toThrow(
      'rejected brokered account connection revocation',
    )

    await expect(disconnectProviderConnection(deps, provider.id, 'user-1')).rejects.toThrow(
      'revocation requires Realmroot signing',
    )
  })

  it('enforces Provider Connection ownership, sign-in safety, and terminal revocation state', async () => {
    const deps = createTestDeps()
    await expect(disconnectProviderConnection(deps, 'missing', 'user-1')).rejects.toThrow('was not found')

    const provider = {
      id: 'provider-connection-1',
      connectorId: 'connector-1',
      ownerUserId: 'other-user',
      ownerOrganizationId: null,
      authenticationAccountId: 'account-provider',
      externalSubject: 'provider-user-1',
      displayName: 'Provider User',
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    }
    vi.mocked(deps.externalResources.findProviderConnection).mockResolvedValue(provider)
    await expect(disconnectProviderConnection(deps, provider.id, 'user-1')).rejects.toThrow('was not found')

    provider.ownerUserId = 'user-1'
    vi.mocked(deps.users.listLinkedAccounts).mockResolvedValue({ items: [], total: 1, limit: 2, offset: 0 })
    await expect(disconnectProviderConnection(deps, provider.id, 'user-1')).rejects.toThrow(
      'Add another sign-in method',
    )

    vi.mocked(deps.users.listLinkedAccounts).mockResolvedValue({ items: [], total: 2, limit: 2, offset: 0 })
    const authorization: ProviderResourceAuthorizationRecord = {
      ...connectionRecord(),
      providerConnectionId: provider.id,
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
    }
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([
      { ...authorization, id: 'revoked-authorization', status: 'revoked' },
      authorization,
    ])
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(authorization)
    vi.mocked(deps.externalResources.listActiveEntitlementsByConnection).mockResolvedValue([])
    vi.mocked(deps.externalResources.revokeConnection).mockResolvedValue(true)
    vi.mocked(deps.externalResources.revokeProviderConnection).mockResolvedValue(false)
    vi.mocked(deps.authorization.findResource).mockResolvedValue(resource())
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response(null, { status: 200 }))
    await expect(disconnectProviderConnection(deps, provider.id, 'user-1')).rejects.toThrow('already disconnected')

    vi.mocked(deps.externalResources.revokeProviderConnection).mockResolvedValue(true)
    authorization.credentials[0]!.credentialCustody = 'resource_server'
    authorization.credentials[0]!.encryptedTokens = null
    authorization.credentials[0]!.brokerReference = 'legacy-broker-reference'
    vi.mocked(deps.authorization.findResource).mockResolvedValue(resource())
    await expect(disconnectProviderConnection(deps, provider.id, 'user-1')).resolves.toBeUndefined()

    vi.mocked(deps.authorization.findResource).mockResolvedValue(null)
    await expect(disconnectProviderConnection(deps, provider.id, 'user-1')).resolves.toBeUndefined()

    authorization.credentials[0]!.credentialCustody = 'realmroot'
    authorization.credentials[0]!.brokerReference = null
    authorization.credentials[0]!.encryptedTokens = connectionRecord().credentials[0]!.encryptedTokens
    vi.mocked(deps.authorization.findResource).mockResolvedValue(null)
    await expect(disconnectProviderConnection(deps, provider.id, 'user-1')).rejects.toThrow(
      'Resource Server was not found',
    )

    vi.mocked(deps.authorization.findResource).mockResolvedValue(resource())
    vi.mocked(deps.connectors.findById).mockResolvedValue(null)
    await expect(disconnectProviderConnection(deps, provider.id, 'user-1')).rejects.toThrow(
      'Active external API resource authorization was not found',
    )
  })

  it(`enforces brokered native connection exchange boundaries and preserves a reconnect
      [spec: account-center/provider-identity-ownership]`, async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const native = {
      ...resource(),
      authorizationModel: 'realmroot' as const,
      providerConnection: { connectorId: 'connector-1', mode: 'brokered' as const },
      authorizationDetails: [{ type: 'github_installation' }],
      scopeRegistry: {
        ...resource().scopeRegistry!,
        accountConnection: {
          mode: 'brokered' as const,
          authorizationEndpoint: 'https://adapter.example/github/account-connection-authorizations',
          tokenEndpoint: 'https://adapter.example/github/account-connection-credentials',
        },
      },
    }
    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([native])
    await expect(listConnectableExternalResources(deps)).resolves.toEqual({
      items: [
        {
          id: native.id,
          identifier: native.identifier,
          name: native.name,
          resourceUrl: native.resourceUrl,
        },
      ],
    })
    const existing: ProviderResourceAuthorizationRecord = {
      ...connectionRecord(),
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      externalSubject: 'github-user-7',
      providerEventOccurredAt: new Date('2026-08-08T20:00:00.000Z'),
      providerEventRevision: 1,
      grantedScopes: ['projects:read'],
      authorizationDetails: [{ type: 'github_installation', installation_id: '152097080', account_login: 'realmroot' }],
      credentials: [
        {
          ...connectionRecord().credentials[0]!,
          credentialCustody: 'resource_server',
          encryptedTokens: null,
          brokerReference: 'connection-1',
          grantedScopes: ['projects:read'],
          authorizationDetails: [
            { type: 'github_installation', installation_id: '152097080', account_login: 'realmroot' },
          ],
        },
      ],
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(existing)
    vi.mocked(deps.externalResources.findProviderConnectionByOwnerConnector).mockImplementation(async (owner) =>
      owner.ownerUserId === 'user-1'
        ? {
            id: existing.providerConnectionId,
            connectorId: 'connector-1',
            ownerUserId: 'user-1',
            ownerOrganizationId: null,
            authenticationAccountId: null,
            externalSubject: existing.externalSubject,
            displayName: existing.displayName,
            status: 'active',
            createdAt: now,
            updatedAt: now,
          }
        : null,
    )
    let intent: ResourceConnectionIntentRecord | null = null
    vi.mocked(deps.externalResources.createConnectionIntent).mockImplementation(async (record) => {
      intent = record
      return record
    })
    const signer = { issuer: 'https://auth.example.com/api/auth', sign: vi.fn(async () => 'signed-request-object') }
    await createResourceConnectionIntent(
      deps,
      native.id,
      {
        owner: { type: 'user' },
        scopes: ['projects:read'],
        authorizationDetails: [{ type: 'github_installation' }],
        returnTo: 'access-approval',
      },
      'user-1',
      'https://auth.example.com',
      signer,
    )
    expect(signer.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_id: existing.providerConnectionId,
        expected_external_subject: existing.externalSubject,
        owner_type: 'user',
        authorization_details: [{ type: 'github_installation' }],
      }),
      'JWT',
    )

    const brokerIntent = intent!
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValueOnce(null)
    await expect(
      createResourceConnectionIntent(
        deps,
        native.id,
        { owner: { type: 'organization', organizationId: 'org-1' }, scopes: ['projects:read'] },
        'user-1',
        'https://auth.example.com',
        signer,
      ),
    ).resolves.toMatchObject({ owner: { type: 'organization', organizationId: 'org-1' } })
    expect(signer.sign).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sub: 'org-1',
        connection_id: expect.stringMatching(/^00000000-0000-7000-8000-/),
        expected_external_subject: null,
        owner_type: 'organization',
      }),
      'JWT',
    )

    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(brokerIntent)
    vi.mocked(deps.externalResources.createConnectionIntent).mockResolvedValueOnce(null)
    await expect(
      createResourceConnectionIntent(
        deps,
        native.id,
        { owner: { type: 'user' }, scopes: ['projects:read'] },
        'user-1',
        'https://auth.example.com',
        signer,
      ),
    ).rejects.toThrow('Enabled native API resource was not found.')

    const unbrokeredNative = {
      ...native,
      authorizationModel: 'realmroot' as const,
      providerConnection: null,
      scopeRegistry: { ...native.scopeRegistry!, accountConnection: null },
    }
    vi.mocked(deps.authorization.findResource)
      .mockResolvedValueOnce(unbrokeredNative)
      .mockResolvedValueOnce(unbrokeredNative)
    await expect(
      createResourceConnectionIntent(
        deps,
        native.id,
        { owner: { type: 'user' }, scopes: ['projects:read'] },
        'user-1',
        'https://auth.example.com',
        signer,
      ),
    ).rejects.toThrow('Realmroot-issued access does not use account connections.')

    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce({
      ...native,
      scopeRegistry: { ...native.scopeRegistry!, accountConnection: null },
    })
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('no longer supports brokered account connections')

    vi.mocked(deps.externalHttp.fetch).mockRejectedValueOnce(new Error('offline'))
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('Brokered account connection service is unavailable')

    vi.mocked(deps.externalHttp.fetch).mockResolvedValueOnce(new Response(null, { status: 401 }))
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('rejected the brokered account connection code')

    const nativeWithoutAuthorizationDetails = { ...native, authorizationDetails: [] }
    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce(nativeWithoutAuthorizationDetails)
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValueOnce(null)
    vi.mocked(deps.externalResources.createResourceAuthorization).mockResolvedValueOnce(null)
    vi.mocked(deps.externalHttp.fetch).mockResolvedValueOnce(
      Response.json({
        external_subject: 'github-user-7',
        display_name: 'GitHub Controller',
        broker_reference: 'connection-1',
      }),
    )
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('Resource Server was deleted while completing the connection.')

    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce(nativeWithoutAuthorizationDetails)
    vi.mocked(deps.externalHttp.fetch).mockResolvedValueOnce(
      Response.json({
        external_subject: 'github-user-7',
        display_name: 'GitHub Controller',
        broker_reference: 'connection-1',
        authorization_details: [{ type: 'github_installation', installation_id: '152097080' }],
      }),
    )
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('returned unsupported authorization details')

    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce(native)
    vi.mocked(deps.externalHttp.fetch).mockResolvedValueOnce(
      Response.json({
        external_subject: existing.externalSubject,
        display_name: existing.displayName,
        broker_reference: 'connection-1',
        authorization_details: [
          { type: 'github_installation', installation_id: '152097080', account_login: 'realmroot' },
        ],
        authority_constraints: [
          {
            authorizationDetails: [
              { type: 'github_installation', installation_id: '152097080', account_login: 'realmroot' },
            ],
            scopes: ['projects:admin'],
          },
        ],
      }),
    )
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('authority constraints do not cover')

    const brokerResponse = (externalSubject: string) =>
      Response.json({
        external_subject: externalSubject,
        display_name: 'GitHub Controller',
        broker_reference: existing.providerConnectionId,
        authorization_details: [
          { type: 'github_installation', installation_id: '152097080', account_login: 'realmroot' },
        ],
      })
    vi.mocked(deps.externalHttp.fetch).mockResolvedValueOnce(brokerResponse('different-github-user'))
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('Disconnect the current Provider account')

    vi.mocked(deps.externalResources.findProviderConnectionByOwnerConnector).mockResolvedValueOnce(null)
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValueOnce(null)
    vi.mocked(deps.externalHttp.fetch).mockResolvedValueOnce(brokerResponse(existing.externalSubject))
    vi.mocked(deps.externalResources.createResourceAuthorization).mockClear()
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).resolves.toMatchObject({ externalSubject: existing.externalSubject })

    vi.mocked(deps.externalResources.upsertProviderCredential).mockImplementation(async (id, input) =>
      connectionWithCredential({ ...existing, id }, input),
    )
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockReset().mockResolvedValue(existing)
    vi.mocked(deps.externalResources.listActiveEntitlementsByConnection).mockResolvedValue([])
    vi.mocked(deps.externalHttp.fetch).mockResolvedValueOnce(brokerResponse(existing.externalSubject))
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).resolves.toMatchObject({
      id: existing.id,
      externalSubject: existing.externalSubject,
      returnTo: 'access-approval',
    })
    expect(deps.externalResources.upsertProviderCredential).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({
        credentialCustody: 'resource_server',
        encryptedTokens: null,
        brokerReference: existing.providerConnectionId,
      }),
    )

    const sameReference = {
      ...existing,
      brokerReference: existing.providerConnectionId,
      providerEventOccurredAt: new Date('2026-08-08T20:05:00.000Z'),
      providerEventRevision: 2,
    }
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(sameReference)
    vi.mocked(deps.externalHttp.fetch).mockResolvedValueOnce(brokerResponse(existing.externalSubject))
    vi.mocked(deps.externalResources.upsertProviderCredential).mockClear()
    await expect(
      completeResourceConnectionIntent(deps, { state: 'state', code: 'code' }, 'https://auth.example.com'),
    ).resolves.toMatchObject({ id: existing.id })
    const sameReferenceInput = vi.mocked(deps.externalResources.upsertProviderCredential).mock.calls[0]![1]
    expect(sameReferenceInput).not.toHaveProperty('providerEventOccurredAt')
    expect(sameReferenceInput).not.toHaveProperty('providerEventRevision')
  })

  it('preserves a same-subject connection identity while switching only it to a new client generation', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const existing = connectionWithCredential(connectionRecord(), { clientGeneration: 1 })
    const intent: ResourceConnectionIntentRecord = {
      id: 'intent-generation-2',
      stateHash: 'state-hash',
      resourceId: 'resource-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      initiatedByUserId: 'user-1',
      scopes: ['offline_access', 'openid', 'projects:read'],
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
    vi.mocked(deps.externalResources.findProviderConnectionByOwnerConnector).mockResolvedValue(
      providerConnectionFor(existing),
    )
    vi.mocked(deps.externalResources.findConnectionByProviderResource).mockResolvedValue(existing)
    const coveredGrant = grantRecord()
    const uncoveredGrant = { ...grantRecord(), id: 'grant-write', scope: 'projects:write' }
    vi.mocked(deps.externalResources.listActiveEntitlementsByConnection).mockResolvedValue([
      coveredGrant,
      uncoveredGrant,
    ])
    vi.mocked(deps.externalResources.endEntitlement).mockResolvedValue(true)
    vi.mocked(deps.externalResources.upsertProviderCredential).mockImplementation(async (id, input) =>
      connectionWithCredential({ ...existing, id }, input),
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
    expect(deps.externalResources.upsertProviderCredential).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({ clientGeneration: 2 }),
    )
    expect(deps.externalResources.endEntitlement).not.toHaveBeenCalledWith(coveredGrant.id, 'revoked', expect.any(Date))
    expect(deps.externalResources.endEntitlement).toHaveBeenCalledWith(uncoveredGrant.id, 'revoked', expect.any(Date))
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
    expect(deps.externalResources.createResourceAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: [expect.objectContaining({ authorizationDetails: granted })],
      }),
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
    vi.mocked(deps.externalResources.findProviderConnectionByOwnerConnector).mockResolvedValue(
      providerConnectionFor(existing),
    )
    vi.mocked(deps.externalResources.findConnectionByProviderResource).mockResolvedValue(existing)
    vi.mocked(deps.externalResources.upsertProviderCredential).mockImplementation(async (id, input) =>
      connectionWithCredential({ ...existing, id }, input),
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
      displayName: 'Project Owner',
      grantedScopes: ['offline_access', 'openid', 'projects:read', 'projects:write'],
      status: 'active',
      returnTo: 'access-approval',
    })
    expect(deps.externalResources.findConnectionByProviderResource).toHaveBeenCalledWith({
      providerConnectionId: existing.providerConnectionId,
      resourceId: 'resource-1',
    })
    expect(deps.externalResources.upsertProviderCredential).toHaveBeenCalledWith(
      'connection-1',
      expect.objectContaining({
        encryptedTokens: expect.stringContaining('replacement-refresh'),
        grantedScopes: ['offline_access', 'openid', 'projects:read', 'projects:write'],
        status: 'active',
        revokedAt: null,
      }),
    )
    expect(deps.secrets.seal).toHaveBeenCalledWith(
      expect.stringContaining('replacement-refresh'),
      'provider-credential:credential-1:tokens',
    )
    expect(deps.externalResources.createResourceAuthorization).not.toHaveBeenCalled()
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
    vi.mocked(deps.externalResources.findProviderConnectionByOwnerConnector).mockResolvedValue(
      providerConnectionFor(existing),
    )
    vi.mocked(deps.externalResources.findConnectionByProviderResource).mockResolvedValue(existing)
    vi.mocked(deps.externalResources.upsertProviderCredential).mockImplementation(async (id, input) =>
      connectionWithCredential({ ...existing, id }, input),
    )
    vi.mocked(deps.externalResources.listActiveEntitlementsByConnection).mockResolvedValue([
      retainedGrant,
      staleGrant,
      staleScopeGrant,
      missingContextGrant,
    ])
    vi.mocked(deps.externalResources.listActiveTokenLeasesByEntitlement).mockResolvedValue([])
    vi.mocked(deps.externalResources.endEntitlement).mockResolvedValue(true)
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
    expect(deps.externalResources.endEntitlement).toHaveBeenCalledWith(staleGrant.id, 'revoked', expect.any(Date))
    expect(deps.externalResources.endEntitlement).toHaveBeenCalledWith(staleScopeGrant.id, 'revoked', expect.any(Date))
    expect(deps.externalResources.endEntitlement).toHaveBeenCalledWith(
      missingContextGrant.id,
      'revoked',
      expect.any(Date),
    )
    expect(deps.externalResources.endEntitlement).not.toHaveBeenCalledWith(
      retainedGrant.id,
      'revoked',
      expect.any(Date),
    )
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

  it('creates the first managed Provider Connection for an external account', async () => {
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
    ).resolves.toMatchObject({
      id: 'replacement-intent',
      externalSubject: 'another-target-user',
      displayName: 'Another Project Owner',
    })
    expect(deps.externalResources.upsertProviderCredential).not.toHaveBeenCalled()
    expect(deps.externalResources.createResourceAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'replacement-intent', providerConnectionId: expect.any(String) }),
    )
  })

  it('[spec: agent-identity/linear-managed-workspace-connections] stores multiple Linear workspaces as credentials under one Provider Connection', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const template = { type: 'linear_workspace' }
    const existing = connectionWithCredential(connectionRecord(), {
      externalSubject: 'workspace-1',
      displayName: 'Workspace One',
      authorizationDetails: [{ ...template, workspace_id: 'workspace-1', workspace_name: 'Workspace One' }],
    })
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...nativeResource(),
      providerConnection: { connectorId: 'connector-1', mode: 'managed' },
      authorizationDetails: [template],
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({ providerType: 'social', providerId: 'linear' }),
    )
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue({
      id: 'workspace-2-intent',
      stateHash: 'state-hash',
      resourceId: 'resource-1',
      ownerUserId: 'user-1',
      ownerOrganizationId: null,
      initiatedByUserId: 'user-1',
      scopes: ['read'],
      authorizationDetails: [template],
      encryptedPkceVerifier: 'sealed:pkce-verifier',
      returnTo: 'account-center',
      status: 'completed',
      expiresAt: new Date(Date.now() + 300_000),
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    vi.mocked(deps.externalResources.findProviderConnectionByOwnerConnector).mockResolvedValue(
      providerConnectionFor(existing),
    )
    vi.mocked(deps.externalResources.findConnectionByProviderResource).mockResolvedValue(existing)
    vi.mocked(deps.externalResources.upsertProviderCredential).mockImplementation(async (id, input) => ({
      ...existing,
      id,
      credentials: [...existing.credentials, { ...input, providerResourceAuthorizationId: id }],
      grantedScopes: [...new Set([...existing.grantedScopes, ...input.grantedScopes])],
      authorizationDetails: [...existing.authorizationDetails, ...input.authorizationDetails],
      status: 'active',
      revokedAt: null,
      updatedAt: input.updatedAt,
    }))
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url === 'https://api.linear.app/oauth/token') {
        expect(request.headers.get('authorization')).toBeNull()
        const body = new URLSearchParams(await request.text())
        expect(body.get('client_id')).toBe('realmroot-client')
        expect(body.get('client_secret')).toBe('target-secret')
        return Response.json({
          access_token: 'workspace-2-access',
          refresh_token: 'workspace-2-refresh',
          token_type: 'Bearer',
          scope: 'read',
        })
      }
      if (request.url === 'https://api.linear.app/graphql') {
        return Response.json({ data: { organization: { id: 'workspace-2', name: 'Workspace Two' } } })
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      completeResourceConnectionIntent(deps, { state: 'workspace-2-state', code: 'code' }, 'https://auth.example.com'),
    ).resolves.toMatchObject({
      id: existing.id,
      authorizationDetails: expect.arrayContaining([
        expect.objectContaining({ type: 'linear_workspace', workspace_id: 'workspace-1' }),
        expect.objectContaining({ type: 'linear_workspace', workspace_id: 'workspace-2' }),
      ]),
    })
    expect(deps.externalResources.upsertProviderCredential).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({
        externalSubject: 'workspace-2',
        displayName: 'Workspace Two',
        authorizationDetails: [
          { type: 'linear_workspace', workspace_id: 'workspace-2', workspace_name: 'Workspace Two' },
        ],
      }),
    )
    expect(deps.externalResources.createResourceAuthorization).not.toHaveBeenCalled()
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
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      items: [
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
    expect(deps.externalResources.approveAccessRequestWithEntitlements).not.toHaveBeenCalled()
    await expect(
      createAgentAccessRequest(
        deps,
        { resourceId: 'resource-1', scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ status: 'pending', connectionId: null })
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

  it('evaluates managed credential liveness without hiding refresh boundary failures', async () => {
    const fixture = () => {
      const deps = createTestDeps()
      authorizationDeps(deps)
      const managed = {
        ...nativeResource(),
        providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
        resourceUrl: 'https://adapters.example.com/cloudflare',
      }
      const connection = connectionWithCredential(connectionRecord(), {
        encryptedTokens: 'sealed:{"accessToken":"expired","refreshToken":"refresh-token"}',
        credentialExpiresAt: new Date(Date.now() - 60_000),
      })
      vi.mocked(deps.authorization.findResource).mockResolvedValue(managed)
      vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
      vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
      vi.mocked(deps.externalResources.createAgentConnectionRequest).mockImplementation(async (record) => record)
      vi.mocked(deps.externalResources.claimProviderCredentialRefresh).mockResolvedValue(true)
      return deps
    }
    const request = (deps: ReturnType<typeof fixture>) =>
      createAgentResourceConnectionRequest(
        deps,
        'resource-1',
        { scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      )

    const invalidGrant = fixture()
    vi.mocked(invalidGrant.externalHttp.fetch).mockResolvedValue(
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    )
    await expect(request(invalidGrant)).resolves.toMatchObject({ status: 'pending' })

    const unavailable = fixture()
    vi.mocked(unavailable.externalHttp.fetch).mockRejectedValue(new Error('offline'))
    await expect(request(unavailable)).resolves.toMatchObject({ status: 'pending' })

    const malformed = fixture()
    vi.mocked(malformed.secrets.open).mockResolvedValue('{}')
    await expect(request(malformed)).rejects.toThrow('Stored resource connection is missing refreshToken')

    const secretFailure = fixture()
    vi.mocked(secretFailure.secrets.open).mockRejectedValue(new Error('secret storage unavailable'))
    await expect(request(secretFailure)).rejects.toThrow('secret storage unavailable')
  })

  it(`creates one access approval before connection and continues OAuth through it
      [spec: agent-identity/external-resource-first-access]`, async () => {
    const deps = authorizationCatalogDeps({
      providerMetadata: {
        ...metadata(),
        pushed_authorization_request_endpoint: 'https://projects.example.com/par',
        authorization_details_types_supported: ['project_access'],
        authorization_details_catalog_endpoint: 'https://projects.example.com/authorization-details',
        authorization_details_catalog_scope: 'authorization-details:read',
        authorization_details_catalog_version: 1,
      },
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(null)
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])

    const access = await createAgentAccessRequest(
      deps,
      { resourceId: 'resource-1', scopes: ['projects:read'], reason: 'Read one project' },
      principal(),
      'https://auth.example.com',
    )

    expect(access).toMatchObject({
      connectionId: null,
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
      status: 'pending',
    })
    expect(access.approvalUrl).toContain('/agent/resource-access/approve#token=')
    expect(deps.externalResources.createAgentConnectionRequest).not.toHaveBeenCalled()

    const stored = vi.mocked(deps.externalResources.createAccessRequestWithAudit).mock.calls[0]![0]
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(stored)
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(stored)
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
      authorizationDetail: null,
      requiresAccountConnection: true,
    })
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      Response.json(
        { request_uri: 'urn:ietf:params:oauth:request_uri:first-access', expires_in: 300 },
        { status: 201 },
      ),
    )
    await expect(
      createAccountConnection(
        deps,
        { context: 'access-request', accessRequestId: stored.id, approvalToken: 'approval-token' },
        'user-1',
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ status: 'pending_authorization', scopes: ['projects:read'] })
    expect(deps.externalResources.createConnectionIntent).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: 'access-approval' }),
    )

    const selectedAuthorizationDetails = [{ type: 'project_access', identifier: 'project-1', actions: ['read'] }]
    const connected = {
      ...connectionRecord(),
      authorizationDetails: selectedAuthorizationDetails,
    }
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connected)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connected)
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connected])
    vi.mocked(deps.externalResources.decideAccessRequest).mockImplementation(async (_id, decision) => ({
      ...stored,
      ...decision,
    }))

    await expect(
      decideAgentAccessRequest(
        deps,
        stored.id,
        {
          decision: 'approve',
          mode: 'persistent',
          authorizationDetails: selectedAuthorizationDetails,
        },
        'user-1',
      ),
    ).resolves.toMatchObject({
      status: 'approved',
      connectionId: connected.id,
      authorizationDetails: selectedAuthorizationDetails,
    })
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      stored.id,
      expect.objectContaining({
        connectionId: connected.id,
        authorizationDetails: selectedAuthorizationDetails,
      }),
      expect.anything(),
      undefined,
    )
  })

  it('keeps a generic Context requirement when an account is already connected', async () => {
    const deps = authorizationCatalogDeps()
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connectionRecord()])
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])

    await expect(
      createAgentAccessRequest(
        deps,
        { resourceId: 'resource-1', scopes: ['projects:read'], reason: 'Read one project' },
        principal(),
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({
      connectionId: 'connection-1',
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
      status: 'pending',
    })
  })

  it('discovers stored connections without contacting the Provider [spec: agent-identity/agent-resource-discovery]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    const expiredConnection = {
      ...connectionRecord(),
      credentialExpiresAt: new Date(Date.now() - 60_000),
    }
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([expiredConnection])
    vi.mocked(deps.externalHttp.fetch).mockReturnValue(new Promise<Response>(() => {}))

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      items: [{ connection: { status: 'connected' } }],
    })
    expect(deps.externalHttp.fetch).not.toHaveBeenCalled()
    expect(deps.externalResources.revokeConnection).not.toHaveBeenCalled()
  })

  it('[spec: agent-identity/resource-account-connection-expansion] preserves active account authority while connection expansion awaits OAuth', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const existingConnection = {
      ...connectionRecord(),
      grantedScopes: ['openid', 'offline_access', 'workspaces:discover', 'projects:read'],
      authorizationDetails: [{ type: 'project_access', identifier: 'project-1', actions: ['read'] }],
    }
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        providerMetadata: {
          ...metadata(),
          authorization_details_catalog_endpoint: 'https://projects.example.com/authorization-details',
          authorization_details_catalog_scope: 'workspaces:discover',
          authorization_details_types_supported: ['project_access'],
        },
      }),
    )
    mockResourceOpenApi(deps, resource().resourceUrl, ['projects:read', 'projects:write'])
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(existingConnection)
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([existingConnection])
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
        scopes: ['offline_access', 'openid', 'projects:read', 'projects:write', 'workspaces:discover'],
      }),
    )

    expect(deps.externalResources.upsertProviderCredential).not.toHaveBeenCalled()
    expect(deps.externalResources.endEntitlement).not.toHaveBeenCalled()
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
      identity: { ...identityAggregate().identity, status: 'inactive' },
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
      authorizationDetails: [{ type: 'project_access', project_id: 'project-1' }],
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
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])
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
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.approveAccessRequestWithEntitlements).mockImplementation(
      async (records, _updates, id, decision) => ({
        entitlements: records,
        request: { ...requestRecord(), id, ...decision },
      }),
    )
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
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          connectionId: 'connection-1',
          mode: 'once',
          scope: 'projects:read',
          grantedByUserId: 'user-1',
          grantedByAgentIdentityId: null,
        }),
      ],
      [],
      'request-1',
      expect.objectContaining({ status: 'approved' }),
      expect.objectContaining({ accessRequestId: 'request-1' }),
      undefined,
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
    vi.mocked(deps.externalResources.approveAccessRequestWithEntitlements).mockResolvedValueOnce('resource_unavailable')
    await expect(
      decideAgentAccessRequestByToken(deps, 'approval-token', { decision: 'approve', mode: 'once' }, 'user-1'),
    ).rejects.toThrow('deleted before access could be approved')
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
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connection])
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])
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

    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...resource(),
      authorizationModel: 'realmroot',
      providerConnection: null,
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
    ).resolves.toMatchObject({
      status: 'pending',
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
    })

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
    ).resolves.toMatchObject({
      status: 'pending',
      authorizationDetails: [{ type: 'project_access', actions: ['read'] }],
    })

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

    const connectionWithoutDetails = {
      ...connection,
      authorizationDetails: [],
    }
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionWithoutDetails)
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connectionWithoutDetails])
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
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connection])

    const request = { ...requestRecord(), authorizationDetails: selected }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.approveAccessRequestWithEntitlements).mockImplementation(
      async (records, _updates, id, decision) => ({
        entitlements: records,
        request: { ...requestRecord(), id, ...decision },
      }),
    )
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
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenCalledWith(
      [expect.objectContaining({ authorizationDetails: selected })],
      [],
      request.id,
      expect.objectContaining({ status: 'approved' }),
      expect.any(Object),
      undefined,
    )

    const contextHash = 'FsIE5gcoLMmZV2zpHjBDgpSCXVVV1BmKB-gtZ5AddwA'
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      {
        ...grantRecord(),
        authorizationDetails: selected,
        authorizationContextHash: contextHash,
        mode: 'until',
        expiresAt: new Date('2098-01-01T00:00:00.000Z'),
      },
    ])
    await decideAgentAccessRequest(
      deps,
      request.id,
      {
        decision: 'approve',
        mode: 'until',
        expiresAt: '2099-01-01T00:00:00.000Z',
        authorizationDetails: selected,
      },
      'user-1',
    )
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenLastCalledWith(
      [],
      [expect.objectContaining({ id: 'ent_1', mode: 'until', expiresAt: new Date('2099-01-01T00:00:00.000Z') })],
      request.id,
      expect.objectContaining({ status: 'approved' }),
      expect.any(Object),
      undefined,
    )

    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      {
        ...grantRecord(),
        authorizationDetails: selected,
        authorizationContextHash: contextHash,
        mode: 'until',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    ])
    await decideAgentAccessRequest(
      deps,
      request.id,
      {
        decision: 'approve',
        mode: 'until',
        expiresAt: '2098-01-01T00:00:00.000Z',
        authorizationDetails: selected,
      },
      'user-1',
    )
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenLastCalledWith(
      [],
      [],
      request.id,
      expect.objectContaining({ status: 'approved' }),
      expect.any(Object),
      undefined,
    )

    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      {
        ...grantRecord(),
        authorizationDetails: selected,
        authorizationContextHash: contextHash,
        mode: 'until',
        expiresAt: null,
      },
    ])
    await decideAgentAccessRequest(
      deps,
      request.id,
      {
        decision: 'approve',
        mode: 'until',
        expiresAt: '2099-01-01T00:00:00.000Z',
        authorizationDetails: selected,
      },
      'user-1',
    )
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenLastCalledWith(
      [],
      [expect.objectContaining({ id: 'ent_1', mode: 'until', expiresAt: new Date('2099-01-01T00:00:00.000Z') })],
      request.id,
      expect.objectContaining({ status: 'approved' }),
      expect.any(Object),
      undefined,
    )

    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      {
        ...grantRecord(),
        authorizationDetails: selected,
        authorizationContextHash: contextHash,
        mode: 'once',
      },
    ])
    await decideAgentAccessRequest(
      deps,
      request.id,
      { decision: 'approve', mode: 'persistent', authorizationDetails: selected },
      'user-1',
    )
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenLastCalledWith(
      [],
      [expect.objectContaining({ id: 'ent_1', mode: 'persistent', expiresAt: null })],
      request.id,
      expect.objectContaining({ status: 'approved' }),
      expect.any(Object),
      undefined,
    )

    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      {
        ...grantRecord(),
        authorizationDetails: selected,
        authorizationContextHash: 'stale-context',
        mode: 'persistent',
      },
    ])
    await decideAgentAccessRequest(
      deps,
      request.id,
      { decision: 'approve', mode: 'once', authorizationDetails: selected },
      'user-1',
    )
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenLastCalledWith(
      [],
      [expect.objectContaining({ id: 'ent_1', mode: 'persistent', expiresAt: null })],
      request.id,
      expect.objectContaining({ status: 'approved' }),
      expect.any(Object),
      undefined,
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
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenLastCalledWith(
      [expect.objectContaining({ authorizationDetails: connection.authorizationDetails })],
      [],
      multiDetailRequest.id,
      expect.objectContaining({ status: 'approved' }),
      expect.any(Object),
      undefined,
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
    ).resolves.toMatchObject({
      status: 'approved',
      authorizationDetails: [connection.authorizationDetails[0]],
    })

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
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      { ...grantRecord(), authorizationDetails: [connectedDetail], scope: 'projects:read' },
      {
        ...grantRecord(),
        id: 'grant-future',
        authorizationDetails: [connectedDetail],
        scope: 'projects:write',
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
    vi.mocked(deps.externalResources.findAccessRequest).mockImplementation(async (entitlementId) => ({
      ...requestRecord(),
      id: `request-${entitlementId}`,
      authorizationDetails: entitlementId === 'grant-incompatible' ? [] : [connectedDetail],
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
      listAgentAuthorizationDetailCatalog(deps, 'resource-1', principal(), { limit: 100, offset: 0 }),
    ).resolves.toEqual({
      items: [
        {
          authorizationDetail: connectedDetail,
          name: 'Project One',
          description: null,
          metadata: {},
          accountAuthorizationStatus: 'authorized',
          authorizedScopes: ['projects:read', 'projects:write'],
          requestableScopes: ['projects:create'],
        },
        {
          authorizationDetail: availableDetail,
          name: 'Project Two',
          description: null,
          metadata: { region: 'ca-central-1' },
          accountAuthorizationStatus: 'authorization_required',
          authorizedScopes: [],
          requestableScopes: [],
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
      ),
    ).resolves.toMatchObject({ items: [], pagination: { total: 0 } })

    await expect(
      listAgentAuthorizationDetailCatalog(
        authorizationCatalogDeps({ grantedScopes: connectionRecord().grantedScopes }),
        'resource-1',
        principal(),
        { limit: 100, offset: 0 },
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
      ),
    ).rejects.toThrow('Authorization detail catalog returned more items than requested.')

    const unreachable = authorizationCatalogDeps()
    vi.mocked(unreachable.externalHttp.fetch).mockRejectedValue(new Error('network unavailable'))
    await expect(
      listAgentAuthorizationDetailCatalog(unreachable, 'resource-1', principal(), { limit: 100, offset: 0 }),
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
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])

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

    const linearDetail = { type: 'linear_workspace', workspace_id: 'workspace-1', workspace_name: 'Acme' }
    const managed = authorizationCatalogDeps()
    vi.mocked(managed.authorization.findResource).mockResolvedValue({
      ...nativeResource(),
      providerConnection: { connectorId: 'connector-1', mode: 'managed' },
      authorizationDetails: [{ type: 'linear_workspace' }],
    })
    vi.mocked(managed.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue({
      ...requestRecord(),
      authorizationDetails: [{ type: 'linear_workspace' }],
    })
    vi.mocked(managed.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connectionRecord(), { authorizationDetails: [linearDetail] }),
    )
    vi.mocked(managed.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])

    await expect(
      listAccountAccessRequestAuthorizationDetailCatalog(managed, 'request-1', 'approval-token', 'user-1', {
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          authorizationDetail: linearDetail,
          connectionStatus: 'authorized',
          requestableScopes: expect.arrayContaining(['projects:read']),
        },
      ],
    })
  })

  it('rejects authorization detail catalog requests without a usable resource context', async () => {
    const nativeAgent = authorizationCatalogDeps()
    vi.mocked(nativeAgent.authorization.findResource).mockResolvedValue(nativeResource())
    await expect(
      listAgentAuthorizationDetailCatalog(nativeAgent, 'resource-1', principal(), { limit: 10, offset: 0 }),
    ).resolves.toMatchObject({ items: [], pagination: { total: 0 } })

    for (const connection of [null, { ...connectionRecord(), status: 'revoked' as const }]) {
      const deps = authorizationCatalogDeps()
      vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
      await expect(
        listAgentAuthorizationDetailCatalog(deps, 'resource-1', principal(), { limit: 10, offset: 0 }),
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

  it(`exchanges user and Agent authority for a target-issued DPoP token [spec: agent-identity/agent-resource-entitlement-policy]
      [spec: agent-identity/agent-direct-resource-access]
      [spec: agent-identity/agent-audit-chain]`, async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const openApiFetch = vi.mocked(deps.externalHttp.fetch).getMockImplementation()!
    const request = {
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    }
    const grant = {
      ...grantRecord(),
      mode: 'persistent' as const,
      scopes: ['projects:read', 'projects:write'],
    }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grant)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connectionRecord(), {
        clientGeneration: 1,
        credentialExpiresAt: new Date(Date.now() - 1),
      }),
    )
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
    vi.mocked(deps.externalResources.endEntitlement).mockResolvedValue(true)
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
      expires_in: 3_600,
    }
    let exchangeStatus = 200
    let exchangeHeaders: Record<string, string> = {}
    let exchangeFailure: 'network' | 'timeout' | 'invalid-json' | null = null
    let notifyTimeoutRequestStarted = () => {}
    const timeoutRequestStarted = new Promise<void>((resolve) => {
      notifyTimeoutRequestStarted = resolve
    })
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
      if (exchangeFailure === 'network') throw new Error('connection reset')
      if (exchangeFailure === 'timeout') {
        notifyTimeoutRequestStarted()
        return new Promise<Response>(() => {})
      }
      if (exchangeFailure === 'invalid-json') return new Response('upstream failure', { status: 502 })
      return Response.json(exchangeResponse, { status: exchangeStatus, headers: exchangeHeaders })
    })

    const sign = vi.fn().mockResolvedValue('signed-agent-assertion')
    const lease = await issueTargetAccessToken(
      deps,
      request.id,
      proof,
      'https://auth.example.com/api/agent/access-requests/request-1/credentials',
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
      authorizationDetails: [],
      resourceUrl: 'https://projects.example.com/api',
      dpopNonce: null,
    })
    expect(deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_resource.token_issued',
        agentIdentityId: 'identity-1',
        hostId: 'host-1',
        resourceConnectionId: 'connection-1',
        accessRequestId: 'request-1',
        scopes: ['projects:read'],
      }),
    )

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({ ...request, connectionId: null })
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({ ...grant, connectionId: null })
    await expect(
      issueTargetAccessToken(
        deps,
        request.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('Active external API resource grant is required.')
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grant)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grant,
      expiresAt: new Date(Date.now() + 10_000),
    })
    exchangeResponse = { access_token: 'beyond-entitlement', token_type: 'DPoP', expires_in: 60 }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('beyond an Entitlement lifetime')
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grant)
    exchangeResponse = { access_token: 'excessive-expiry', token_type: 'DPoP', expires_in: 5_000 }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('excessive lifetime')
    exchangeResponse = { access_token: 'wrong-type', token_type: 'Bearer', expires_in: 60 }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
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
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
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
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
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
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
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
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
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
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
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
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
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
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('External authorization server rejected the token request.')

    exchangeResponse = {
      error: 'use_dpop_nonce',
      error_description: 'Authorization server requires nonce in DPoP proof',
    }
    exchangeHeaders = { 'DPoP-Nonce': 'challenge-nonce' }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toMatchObject({
      status: 400,
      error: 'use_dpop_nonce',
      headers: { 'DPoP-Nonce': 'challenge-nonce' },
    })

    exchangeResponse = { error: 'use_dpop_nonce' }
    exchangeHeaders = {}
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('invalid DPoP nonce challenge')

    exchangeHeaders = { 'DPoP-Nonce': 'fallback-nonce' }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toMatchObject({
      message: 'Authorization server requires nonce in DPoP proof.',
      headers: { 'DPoP-Nonce': 'fallback-nonce' },
    })

    exchangeStatus = 200
    exchangeResponse = { access_token: 'target-dpop-access', token_type: 'DPoP', expires_in: 60 }
    exchangeHeaders = { 'DPoP-Nonce': 'invalid nonce' }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('invalid DPoP nonce')

    exchangeFailure = 'network'
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('External authorization server is unavailable')

    exchangeFailure = 'timeout'
    vi.useFakeTimers()
    try {
      const issue = issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      )
      const result = expect(issue).rejects.toThrow('External authorization server is unavailable')
      await timeoutRequestStarted
      await vi.advanceTimersByTimeAsync(5_000)
      await result
    } finally {
      vi.useRealTimers()
    }

    exchangeFailure = 'invalid-json'
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('External authorization server rejected the token request')

    exchangeFailure = null
    exchangeHeaders = { 'DPoP-Nonce': 'next-nonce' }
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).resolves.toMatchObject({ dpopNonce: 'next-nonce' })

    vi.mocked(deps.connectors.findById).mockResolvedValue(null)
    await expect(
      issueTargetAccessToken(
        deps,
        grant.id,
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('Connector not found.')
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
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
      authorizationDetails,
    }
    const grant = { ...grantRecord(), authorizationDetails }
    const connection = connectionWithCredential(connectionRecord(), {
      authorizationDetails,
      credentialExpiresAt: new Date(Date.now() - 1_000),
    })
    vi.mocked(deps.authorization.findResource).mockResolvedValue(rarResource)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grant)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.createTokenLease).mockImplementation(async (record) => record)
    vi.mocked(deps.externalResources.consumeAccessRequest).mockResolvedValue(true)
    vi.mocked(deps.externalResources.endEntitlement).mockResolvedValue(true)
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
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('agent-assertion') },
      )
    await expect(issue()).resolves.toMatchObject({ authorizationDetails })
    expect(deps.externalResources.completeProviderCredentialRefresh).toHaveBeenCalledWith(
      connection.credentials[0]!.id,
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
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...request,
      authorizationDetails: legacyAuthorizationDetails,
    })
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grant,
      authorizationDetails: legacyAuthorizationDetails,
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connection, { authorizationDetails: legacyAuthorizationDetails }),
    )
    expectedAuthorizationDetails = legacyAuthorizationDetails
    issuedAuthorizationDetails = legacyAuthorizationDetails
    await expect(issue()).resolves.toMatchObject({ authorizationDetails: legacyAuthorizationDetails })
  })

  it('returns only the connected provider access token for a valid Agent lease [spec: agent-identity/application-provider-token-exchange]', async () => {
    const { deps, input } = connectorBackedExchangeFixture()

    await expect(exchangeAgentConnectionCredential(deps, input)).resolves.toMatchObject({
      accessToken: 'provider-access-token',
      scopes: ['openid', 'offline_access', 'projects:read'],
      expiresIn: expect.any(Number),
    })
    expect(deps.externalResources.claimProviderCredentialRefresh).not.toHaveBeenCalled()
  })

  it('[spec: agent-identity/linear-managed-workspace-connections] selects one managed credential from the approved Authorization Detail', async () => {
    const { deps, input } = connectorBackedExchangeFixture()
    const detail = { type: 'linear_workspace', workspace_id: 'workspace-2', workspace_name: 'Workspace Two' }
    const baseConnection = await deps.externalResources.findConnection('connection-1')
    const baseRequest = await deps.externalResources.findAccessRequest('request-1')
    const baseEntitlement = (await deps.externalResources.findEntitlements(['grant-1']))[0]!
    const baseLease = await deps.externalResources.findActiveTokenLeaseByTokenHash('token-hash', now)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...baseConnection!,
      credentials: [
        baseConnection!.credentials[0]!,
        {
          ...baseConnection!.credentials[0]!,
          id: 'credential-2',
          externalSubject: 'workspace-2',
          displayName: 'Workspace Two',
          encryptedTokens:
            'sealed:{"accessToken":"workspace-2-access-token","refreshToken":"workspace-2-refresh-token"}',
          authorizationDetails: [detail],
        },
      ],
      authorizationDetails: [detail],
    })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...baseRequest!,
      authorizationDetails: [detail],
    })
    vi.mocked(deps.externalResources.findEntitlements).mockResolvedValue([
      { ...baseEntitlement, authorizationDetails: [detail] },
    ])
    vi.mocked(deps.externalResources.findActiveTokenLeaseByTokenHash).mockResolvedValue({
      ...baseLease!,
      authorizationDetails: [detail],
    })
    Object.assign(input.claims, { authorization_details: [detail] })

    await expect(exchangeAgentConnectionCredential(deps, input)).resolves.toMatchObject({
      accessToken: 'workspace-2-access-token',
    })
  })

  it('requires an Authorization Detail when multiple managed credentials cover the same scopes', async () => {
    const { deps, input } = connectorBackedExchangeFixture()
    const connection = await deps.externalResources.findConnection('connection-1')
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connection!,
      credentials: [
        connection!.credentials[0]!,
        { ...connection!.credentials[0]!, id: 'credential-2', externalSubject: 'workspace-2' },
      ],
    })

    await expect(exchangeAgentConnectionCredential(deps, input)).rejects.toThrow(
      'Select an authorization context that identifies one provider credential.',
    )
  })

  it('rejects a managed exchange when no credential covers the requested scopes', async () => {
    const { deps, input } = connectorBackedExchangeFixture()
    const connection = await deps.externalResources.findConnection('connection-1')
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connection!,
      credentials: connection!.credentials.map((credential) => ({
        ...credential,
        grantedScopes: ['projects:write'],
      })),
    })

    await expect(exchangeAgentConnectionCredential(deps, input)).rejects.toThrow(
      'No active provider credential covers the requested authority.',
    )

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connection!,
      credentials: connection!.credentials.map((credential) => ({ ...credential, status: 'revoked' as const })),
    })
    await expect(exchangeAgentConnectionCredential(deps, input)).rejects.toThrow(
      'No active provider credential covers the requested authority.',
    )
  })

  it('exchanges a verified Agent access token through an authorized Application', async () => {
    const subjectToken = `${base64UrlString(JSON.stringify({ typ: 'at+jwt', alg: 'ES256' }))}.${base64UrlString('{}')}.${base64UrlString('signature')}`
    const { deps, input } = connectorBackedExchangeFixture({ subjectToken })
    const clientSecret = 'adapter-secret'
    vi.mocked(deps.tokenExchange.findClient).mockResolvedValue({
      clientId: 'adapter-client',
      clientSecret: await hashProviderSecret(clientSecret),
      disabled: false,
      grantTypes: JSON.stringify([tokenExchangeGrantType]),
      scopes: JSON.stringify(['projects:read']),
    })
    vi.mocked(deps.applications.findByClientId).mockResolvedValue({
      id: 'adapter-application',
      clientId: 'adapter-client',
      ownerOrganizationId: 'org-1',
      disabled: false,
      oidcScopes: [],
      resourceScopes: [{ resourceServerId: 'resource-1', scopes: ['projects:read'] }],
    } as never)
    const applicationResource = {
      ...nativeResource(),
      providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
      resourceUrl: input.audience,
    }
    vi.mocked(deps.authorization.findResourceByResourceUrl).mockResolvedValue(applicationResource)
    vi.mocked(deps.authorization.listActiveApplicationScopeEntitlements).mockResolvedValue([
      { scope: 'projects:read' },
    ] as never)

    await expect(
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: accessTokenType,
          requestedTokenType: accessTokenType,
          audience: input.audience,
          scope: 'projects:read',
          verifiedSubjectClaims: input.claims,
        },
        { clientId: 'adapter-client', clientSecret },
      ),
    ).resolves.toMatchObject({
      access_token: 'provider-access-token',
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
      scope: 'openid offline_access projects:read',
    })

    const exchange = (overrides: Record<string, unknown> = {}) =>
      exchangeToken(
        deps,
        {
          grantType: tokenExchangeGrantType,
          subjectToken,
          subjectTokenType: accessTokenType,
          audience: input.audience,
          scope: 'projects:read',
          verifiedSubjectClaims: input.claims,
          ...overrides,
        },
        { clientId: 'adapter-client', clientSecret },
      )
    await expect(exchange({ verifiedSubjectClaims: undefined })).rejects.toMatchObject({ error: 'invalid_grant' })
    const wrongTypeToken = `${base64UrlString(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${base64UrlString('{}')}.${base64UrlString('signature')}`
    await expect(exchange({ subjectToken: wrongTypeToken })).rejects.toMatchObject({ error: 'invalid_grant' })

    await expect(exchange({ subjectTokenType: 'urn:example:unsupported-token' })).rejects.toMatchObject({
      error: 'invalid_request',
    })

    vi.mocked(deps.authorization.findResourceByResourceUrl).mockResolvedValueOnce(null)
    await expect(exchange()).rejects.toMatchObject({ error: 'invalid_target' })
    vi.mocked(deps.authorization.findResourceByResourceUrl)
      .mockResolvedValueOnce(applicationResource)
      .mockResolvedValueOnce(null)
    await expect(exchange()).rejects.toMatchObject({ error: 'invalid_target' })
    vi.mocked(deps.authorization.listActiveApplicationScopeEntitlements).mockResolvedValueOnce([])
    await expect(exchange()).rejects.toMatchObject({ error: 'invalid_scope' })
    vi.mocked(deps.externalResources.findActiveTokenLeaseByTokenHash).mockResolvedValueOnce(null)
    await expect(exchange()).rejects.toMatchObject({ error: 'invalid_grant' })
    vi.mocked(deps.connectors.findById).mockRejectedValueOnce(badGateway('provider unavailable'))
    await expect(exchange()).rejects.toMatchObject({ error: 'temporarily_unavailable' })
    vi.mocked(deps.externalResources.findActiveTokenLeaseByTokenHash).mockRejectedValueOnce(
      new Error('database unavailable'),
    )
    await expect(exchange()).rejects.toMatchObject({ error: 'invalid_grant' })
  })

  it('fails retryably when another instance owns provider refresh [spec: agent-identity/provider-token-refresh-concurrency]', async () => {
    const { deps, input } = connectorBackedExchangeFixture({ expired: true })
    vi.mocked(deps.externalResources.claimProviderCredentialRefresh).mockResolvedValue(false)

    await expect(exchangeAgentConnectionCredential(deps, input)).rejects.toMatchObject({
      status: 503,
      error: 'temporarily_unavailable',
      headers: { 'Retry-After': '1' },
    })
    expect(deps.externalHttp.fetch).not.toHaveBeenCalled()
  })

  it('rejects every stale authority boundary before returning a provider token', async () => {
    const cases: Array<{
      mutate: (deps: ReturnType<typeof connectorBackedExchangeFixture>['deps']) => void
      error: string
    }> = [
      {
        mutate: (deps) => vi.mocked(deps.externalResources.findActiveTokenLeaseByTokenHash).mockResolvedValue(null),
        error: 'token lease is not active',
      },
      {
        mutate: (deps) => vi.mocked(deps.secrets.open).mockResolvedValueOnce('different-token'),
        error: 'token lease is invalid',
      },
      {
        mutate: (deps) => vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(null),
        error: 'access request is no longer valid',
      },
      {
        mutate: (deps) =>
          vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
            ...requestRecord(),
            status: 'denied',
          }),
        error: 'access request is no longer valid',
      },
      {
        mutate: (deps) =>
          vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
            ...requestRecord(),
            bindingId: 'binding-2',
          }),
        error: 'access request is no longer valid',
      },
      {
        mutate: (deps) =>
          vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
            ...requestRecord(),
            connectionId: null,
          }),
        error: 'access request is no longer valid',
      },
      {
        mutate: (deps) =>
          vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
            ...requestRecord(),
            scopes: ['projects:write'],
          }),
        error: 'access request is no longer valid',
      },
      {
        mutate: (deps) => vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(null),
        error: 'identity or host binding is no longer active',
      },
      {
        mutate: (deps) => vi.mocked(deps.authorization.findResource).mockResolvedValue(null),
        error: 'audience is not a connector-backed native Resource Server',
      },
      {
        mutate: (deps) =>
          vi.mocked(deps.authorization.findResource).mockResolvedValue({
            ...nativeResource(),
            authorizationModel: 'federated',
          }),
        error: 'audience is not a connector-backed native Resource Server',
      },
      {
        mutate: (deps) =>
          vi.mocked(deps.authorization.findResource).mockResolvedValue({
            ...nativeResource(),
            providerConnection: null,
          }),
        error: 'audience is not a connector-backed native Resource Server',
      },
      {
        mutate: (deps) =>
          vi.mocked(deps.authorization.findResource).mockResolvedValue({
            ...nativeResource(),
            providerConnection: { connectorId: 'connector-1', mode: 'managed' },
            resourceUrl: 'https://wrong.example.com',
          }),
        error: 'audience is not a connector-backed native Resource Server',
      },
      {
        mutate: (deps) => vi.mocked(deps.externalResources.findConnection).mockResolvedValue(null),
        error: 'account connection is no longer active',
      },
      ...[
        { ...connectionRecord(), status: 'revoked' as const },
        { ...connectionRecord(), id: 'connection-2' },
        { ...connectionRecord(), resourceId: 'resource-2' },
        connectionWithCredential(connectionRecord(), {
          credentialCustody: 'resource_server',
          encryptedTokens: null,
          brokerReference: 'broker-reference',
        }),
        connectionWithCredential(connectionRecord(), { encryptedTokens: null }),
      ].map((connection) => ({
        mutate: (deps: ReturnType<typeof connectorBackedExchangeFixture>['deps']) =>
          vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection),
        error: 'account connection is no longer active',
      })),
      {
        mutate: (deps) => {
          const identity = identityAggregate()
          vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
            ...identity,
            identity: { ...identity.identity, ownerOrganizationId: 'org-2' },
          })
        },
        error: 'outside the Agent home space',
      },
      {
        mutate: (deps) => vi.mocked(deps.externalResources.findEntitlements).mockResolvedValue([]),
        error: 'Permissions are no longer active',
      },
      ...[
        { ...grantRecord(), agentIdentityId: 'identity-2' },
        { ...grantRecord(), resourceServerId: 'resource-2' },
        { ...grantRecord(), connectionId: 'connection-2' },
        { ...grantRecord(), endedAt: new Date(), endReason: 'revoked' as const },
        { ...grantRecord(), expiresAt: new Date(Date.now() - 1) },
        { ...grantRecord(), scope: 'projects:write' },
      ].map((entitlement) => ({
        mutate: (deps: ReturnType<typeof connectorBackedExchangeFixture>['deps']) =>
          vi.mocked(deps.externalResources.findEntitlements).mockResolvedValue([entitlement]),
        error: 'Permissions are no longer active',
      })),
    ]

    for (const testCase of cases) {
      const { deps, input } = connectorBackedExchangeFixture()
      testCase.mutate(deps)
      await expect(exchangeAgentConnectionCredential(deps, input)).rejects.toThrow(testCase.error)
    }
  })

  it('rejects every mismatched Agent access token authority claim', async () => {
    const mutations: Array<(claims: Record<string, unknown>) => void> = [
      (claims) => {
        claims.aud = 'https://wrong.example.com'
      },
      (claims) => {
        claims.sub = 'wrong-subject'
      },
      (claims) => {
        claims.client_id = 'wrong-client'
      },
      (claims) => {
        claims.connection_id = 'wrong-connection'
      },
      (claims) => {
        claims.act = { ...(claims.act as Record<string, unknown>), iss: 'https://wrong.example.com' }
      },
      (claims) => {
        claims.act = { ...(claims.act as Record<string, unknown>), sub: 'wrong-agent' }
      },
      (claims) => {
        claims.act = { ...(claims.act as Record<string, unknown>), sub_profile: 'human' }
      },
      (claims) => {
        claims.cnf = { jkt: 'wrong-thumbprint' }
      },
      (claims) => {
        claims.scope = 'projects:write'
      },
      (claims) => void delete claims.act,
      (claims) => void delete claims.cnf,
      (claims) => void delete claims.scope,
    ]
    for (const mutate of mutations) {
      const { deps, input } = connectorBackedExchangeFixture()
      mutate(input.claims)
      await expect(exchangeAgentConnectionCredential(deps, input)).rejects.toThrow(
        'claims do not match its active authority',
      )
    }
  })

  it('rejects provider credentials without a usable expiry', async () => {
    const { deps, input } = connectorBackedExchangeFixture()
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connectionRecord(), {
        credentialCustody: 'realmroot',
        encryptedTokens: 'sealed:{"accessToken":"provider-access-token","refreshToken":"provider-refresh-token"}',
        credentialExpiresAt: null,
      }),
    )
    vi.mocked(deps.externalResources.claimProviderCredentialRefresh).mockResolvedValue(true)
    vi.mocked(deps.externalResources.completeProviderCredentialRefresh).mockResolvedValue(
      connectionRecord().credentials[0]!,
    )
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      Response.json({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        scope: 'projects:read',
      }),
    )

    await expect(exchangeAgentConnectionCredential(deps, input)).rejects.toMatchObject({
      status: 503,
      error: 'temporarily_unavailable',
    })
  })

  it('claims and completes a rotating provider refresh exactly once', async () => {
    const { deps, input } = connectorBackedExchangeFixture({ expired: true })
    vi.mocked(deps.externalResources.claimProviderCredentialRefresh).mockResolvedValue(true)
    vi.mocked(deps.externalResources.completeProviderCredentialRefresh).mockResolvedValue(
      connectionRecord().credentials[0]!,
    )
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      Response.json({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        token_type: 'Bearer',
        expires_in: 300,
        scope: 'openid offline_access projects:read',
      }),
    )

    await expect(exchangeAgentConnectionCredential(deps, input)).resolves.toMatchObject({
      accessToken: 'rotated-access-token',
      scopes: ['offline_access', 'openid', 'projects:read'],
    })
    expect(deps.externalResources.claimProviderCredentialRefresh).toHaveBeenCalledOnce()
    expect(deps.externalResources.completeProviderCredentialRefresh).toHaveBeenCalledOnce()
  })

  it('revokes active target token leases [spec: agent-identity/agent-resource-revocation]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connectionRecord(), { clientGeneration: 1 }),
    )
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
    vi.mocked(deps.externalResources.listActiveTokenLeasesByEntitlement).mockResolvedValue([
      {
        id: 'lease-1',
        entitlementIds: ['ent_1'],
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
    vi.mocked(deps.externalResources.endEntitlement).mockResolvedValue(true)
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (outbound) => {
      expect(outbound.url).toBe('https://projects.example.com/revoke')
      expect(outbound.headers.get('authorization')).toBe(`Basic ${btoa('realmroot-client:target-secret')}`)
      expect(new URLSearchParams(await outbound.text()).get('token')).toBe('target-dpop-access')
      return new Response(null, { status: 200 })
    })

    await revokeAgentPermission(deps, 'grant-1', 'user-1')
    expect(deps.externalResources.revokeTokenLease).toHaveBeenCalledWith('lease-1', expect.any(Date))
    expect(deps.externalResources.endEntitlement).toHaveBeenCalledWith('ent_1', 'revoked', expect.any(Date))
  })

  it('records the Agent owner when revoking native Resource access', async () => {
    const deps = createTestDeps()
    const identity = identityAggregate()
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
      ...identity,
      identity: { ...identity.identity, ownerUserId: 'user-1', ownerOrganizationId: null },
    })
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({ ...grantRecord(), connectionId: null })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({ ...requestRecord(), connectionId: null })
    vi.mocked(deps.authorization.findResource).mockResolvedValue(nativeResource())
    vi.mocked(deps.externalResources.listActiveTokenLeasesByEntitlement).mockResolvedValue([
      {
        id: 'lease-native',
        entitlementIds: ['ent_1'],
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
    vi.mocked(deps.externalResources.endEntitlement).mockResolvedValue(true)

    await revokeAgentPermission(deps, 'ent_1', 'user-1')

    expect(deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_resource.access_revoked',
        agentIdentityId: 'identity-1',
        ownerUserId: 'user-1',
      }),
    )
    expect(deps.externalResources.revokeTokenLease).toHaveBeenCalledWith('lease-native', expect.any(Date))
  })

  it('maps management and account resource views', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([
      { ...connectionRecord(), ownerUserId: 'user-1', ownerOrganizationId: null },
      connectionWithCredential(
        {
          ...connectionRecord(),
          id: 'connection-2',
          ownerUserId: null,
          ownerOrganizationId: 'organization-1',
          externalSubject: 'tiny',
        },
        { credentialExpiresAt: null },
      ),
    ])

    await expect(getExternalResourceAuthorization(deps, 'resource-1')).resolves.toMatchObject({
      resourceId: 'resource-1',
      clientSecretConfigured: true,
    })
    await expect(getApiResource(deps, 'resource-1', 'https://auth.example.com')).resolves.toMatchObject({
      id: 'resource-1',
      authorization: { issuer: 'https://projects.example.com' },
    })
    const resources = await listApiResources(deps, { limit: 10, offset: 0 }, 'https://auth.example.com')
    expect(resources.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'resource-1' })]))
    await expect(listResourceConnections(deps, 'user-1')).resolves.toMatchObject({
      items: [{ owner: { type: 'user' } }, { owner: { type: 'organization' }, credentialExpiresAt: null }],
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
      items: [{ id: 'resource-1' }],
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

  it('creates and revokes account connections, including organization control [spec: agent-identity/connector-backed-connection-revocation]', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...nativeResource(),
      providerConnection: { connectorId: 'connector-1', mode: 'managed' },
    })
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response(null, { status: 200 }))
    Object.assign(deps.authorization, {
      findMemberByOrganizationUser: vi.fn().mockResolvedValue({ roles: ['credential_manager'] }),
      listOrganizationRoleScopes: vi
        .fn()
        .mockResolvedValue(
          new Map([['credential_manager', [{ resourceId: 'resource-realmroot', scope: 'agents:write' }]]]),
        ),
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
    vi.mocked(deps.externalResources.listActiveEntitlementsByConnection).mockResolvedValue([])
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

    const personalAccessIdentity = identityAggregate()
    personalAccessIdentity.identity.ownerOrganizationId = null
    personalAccessIdentity.identity.ownerUserId = 'user-1'
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(personalAccessIdentity)
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(null)
    await expect(
      createAccountConnection(
        deps,
        { context: 'access-request', accessRequestId: request.id, approvalToken: 'approval-token' },
        'user-1',
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ owner: { type: 'user' } })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())

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
      { ...connectionRecord(), status: 'revoked' },
    ])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ items: [], pagination: { total: 0 } })

    const personalIdentity = identityAggregate()
    personalIdentity.identity.ownerOrganizationId = null
    personalIdentity.identity.ownerUserId = 'user-1'
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(personalIdentity)
    vi.mocked(deps.externalResources.listConnectionsByUser).mockResolvedValue([connectionRecord()])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ items: [{ id: 'connection-1' }], pagination: { total: 1 } })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())

    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([
      connectionRecord(),
      { ...connectionRecord(), id: 'duplicate-connection' },
    ])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({
      items: [{ id: 'connection-1' }, { id: 'duplicate-connection' }],
      pagination: { total: 2 },
    })

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
      grantedScopes: [
        'openid',
        'offline_access',
        'workspaces:discover',
        'objects:create',
        'quota:purchase',
        'shares:create',
      ],
      authorizationDetails: [existingDetail],
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      ...resource(),
      authorizationDetails: [template],
    })
    vi.mocked(deps.connectors.findById).mockResolvedValue(
      connectorRecord({
        registeredScopes: [
          'workspaces:discover',
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
          authorization_details_catalog_scope: 'workspaces:discover',
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
            'workspaces:discover',
            'objects:create',
            'offline_access',
            'openid',
            'quota:purchase',
            'shares:create',
            'teams:read',
          ].sort(),
        )
        expect(JSON.parse(form.get('authorization_details')!)).toEqual([
          existingDetail,
          request.authorizationDetails[0],
        ])
        return Response.json({ request_uri: 'urn:example:par:expanded', expires_in: 300 }, { status: 201 })
      }
      return openApiFetch(fetchRequest)
    })
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(request)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(existingConnection)
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([existingConnection])
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
      authorizationDetails: [existingDetail, request.authorizationDetails[0]],
      status: 'pending_authorization',
    })
    expect(deps.externalResources.createConnectionIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [
          'objects:create',
          'offline_access',
          'openid',
          'quota:purchase',
          'shares:create',
          'teams:read',
          'workspaces:discover',
        ],
        authorizationDetails: [existingDetail, request.authorizationDetails[0]],
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

    const native = { ...nativeResource(), scopeRegistry: null }
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

    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([
      { ...connectionRecord(), ownerUserId: null, ownerOrganizationId: 'org-1' },
      { ...connectionRecord(), id: 'connection-2', ownerUserId: null, ownerOrganizationId: 'org-1' },
    ])
    await expect(
      listAccessRequestConnections(deps, 'approval-token', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({
      items: [{ id: 'connection-1' }, { id: 'connection-2' }],
      pagination: { total: 2 },
    })
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

  it('approves brokered first access against the connected account authority revision', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    const authorizationDetails = [
      { type: 'github_installation', installation_id: '152097080', account_login: 'realmroot' },
    ]
    const brokered = {
      ...resource(),
      authorizationModel: 'realmroot' as const,
      providerConnection: { connectorId: 'connector-1', mode: 'brokered' as const },
      authorizationDetails: [{ type: 'github_installation' }],
      scopeRegistry: {
        ...resource().scopeRegistry!,
        accountConnection: {
          mode: 'brokered' as const,
          authorizationEndpoint: 'https://adapter.example/github/account-connection-authorizations',
          tokenEndpoint: 'https://adapter.example/github/account-connection-credentials',
        },
      },
    }
    const connection = {
      ...connectionRecord(),
      credentialCustody: 'resource_server' as const,
      encryptedTokens: null,
      brokerReference: 'broker-reference-1',
      providerEventRevision: 7,
      authorizationDetails,
      authorityConstraints: [{ authorizationDetails, scopes: ['projects:read'] }],
    }
    const request = { ...requestRecord(), authorizationDetails }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(brokered)
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.approveAccessRequestWithEntitlements).mockImplementation(
      async (created, _updated, _requestId, decision) => ({
        entitlements: created,
        request: { ...request, ...decision },
      }),
    )

    await expect(
      decideAgentAccessRequest(deps, request.id, { decision: 'approve', mode: 'once', authorizationDetails }, 'user-1'),
    ).resolves.toMatchObject({ status: 'approved', authorizationDetails })
    expect(deps.externalResources.approveAccessRequestWithEntitlements).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      request.id,
      expect.objectContaining({ authorizationDetails }),
      expect.anything(),
      7,
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
      listEnabledResources: vi.fn().mockResolvedValue([native]),
    })
    mockResourceOpenApi(deps, native.resourceUrl)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      { ...grantRecord(), connectionId: null },
    ])
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      connectionId: null,
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    vi.mocked(deps.externalResources.createAccessRequest).mockImplementation(async (record) => record)

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      items: [{ connection: { status: 'not_required', displayName: null, authorizedScopes: [] } }],
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
    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce({ ...native, scopeRegistry: null })
    await expect(
      listAgentAuthorizationDetailCatalog(deps, native.id, principal(), { limit: 10, offset: 0 }),
    ).resolves.toMatchObject({ items: [], pagination: { total: 0 } })
    const personalIdentity = identityAggregate()
    personalIdentity.identity.ownerOrganizationId = null
    personalIdentity.identity.ownerUserId = 'user-1'
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(personalIdentity)
    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      items: [{ id: native.id }],
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    const created = await createAccessRequest(
      deps,
      {
        resourceServerId: 'resource-1',
        scopes: ['projects:read'],
        authorizationDetails: [],
        reason: 'Read projects',
      },
      principal(),
      'https://auth.example.com/',
    )
    expect(created).toMatchObject({
      resourceServerId: 'resource-1',
      authorizationDetails: [],
      status: 'approved',
      interaction: { status: 'completed' },
    })
    expect(created).not.toHaveProperty('grantId')
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      id: created.id,
      connectionId: null,
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    await expect(getAccessRequest(deps, created.id, principal(), 'https://auth.example.com')).resolves.toMatchObject({
      id: created.id,
      status: 'approved',
    })
    await expect(
      createAccessRequest(
        deps,
        {
          resourceServerId: 'resource-1',
          scopes: ['projects:read'],
          authorizationDetails: [],
        },
        principal(),
        'https://auth.example.com/',
      ),
    ).resolves.toMatchObject({ reason: null })

    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])
    await expect(
      createAccessRequest(
        deps,
        { resourceServerId: 'resource-1', scopes: ['projects:read'], authorizationDetails: [] },
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
      resourceServerId: stored.resourceId,
      authorizationDetails: stored.authorizationDetails,
    })
  })

  it("uses a personal Agent controller's active Organization memberships for private Resource Server visibility [spec: agent-identity/agent-private-resource-server-visibility]", async () => {
    const deps = createTestDeps()
    const privateNative = { ...nativeResource(), visibility: 'private' as const }
    const personalIdentity = identityAggregate()
    personalIdentity.identity.ownerOrganizationId = null
    personalIdentity.identity.ownerUserId = 'user-1'
    Object.assign(deps.authorization, {
      findResource: vi.fn().mockResolvedValue(privateNative),
      listEnabledResources: vi.fn().mockResolvedValue([privateNative]),
      listUserMemberships: vi.fn().mockResolvedValue([{ organizationId: privateNative.ownerOrganizationId }]),
      findOrganization: vi.fn().mockResolvedValue({ id: privateNative.ownerOrganizationId, disabled: false }),
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(personalIdentity)

    await expect(discoverAgentResources(deps, principal())).resolves.toMatchObject({
      items: [{ id: privateNative.id }],
    })
    await expect(
      listAgentAuthorizationDetailCatalog(deps, privateNative.id, principal(), { limit: 10, offset: 0 }),
    ).resolves.toMatchObject({ pagination: { total: 0 } })

    vi.mocked(deps.authorization.listUserMemberships).mockResolvedValue([{ organizationId: 'org-other' }] as never)
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({ id: 'org-other', disabled: false } as never)
    await expect(discoverAgentResources(deps, principal())).resolves.toEqual({ items: [] })
    await expect(
      listAgentAuthorizationDetailCatalog(deps, privateNative.id, principal(), { limit: 10, offset: 0 }),
    ).rejects.toThrow('Resource Server is not visible to this Agent.')
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

    const result = await listAgentAuthorizationDetailCatalog(deps, builtIn.id, principal(), { limit: 10, offset: 0 })

    expect(result.pagination.total).toBe(1)
    expect(result.items).toEqual([
      expect.objectContaining({
        authorizationDetail: expect.objectContaining({ type: 'realmroot_authority' }),
        name: 'Example Organization',
      }),
    ])

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
      ...identityAggregate(),
      identity: {
        ...identityAggregate().identity,
        ownerUserId: 'user-1',
        ownerOrganizationId: null,
      },
    })
    vi.mocked(deps.authorization.listUserMemberships).mockResolvedValue([
      { organizationId: 'org-1', roles: ['owner'] } as never,
      { organizationId: 'org-1', roles: ['owner'] } as never,
      { organizationId: 'org-disabled', roles: ['owner'] } as never,
    ])
    vi.mocked(deps.authorization.findOrganization).mockImplementation(async (id) =>
      id === 'org-1'
        ? ({ id, name: 'Example Organization', displayName: null, disabled: false } as never)
        : ({ id, name: 'Disabled', displayName: null, disabled: true } as never),
    )
    expect(
      (await listAgentAuthorizationDetailCatalog(deps, builtIn.id, principal(), { limit: 10, offset: 0 })).items,
    ).toEqual([
      expect.objectContaining({ name: 'Example User' }),
      expect.objectContaining({ name: 'Example Organization' }),
    ])

    vi.mocked(deps.authorization.findResource).mockResolvedValue({ ...builtIn, scopeRegistry: null })
    vi.mocked(deps.authorization.listUserMemberships).mockResolvedValue([])
    vi.mocked(deps.users.getUser).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      displayName: null,
    } as never)
    await expect(
      listAgentAuthorizationDetailCatalog(deps, builtIn.id, principal(), { limit: 10, offset: 1 }),
    ).resolves.toMatchObject({ pagination: { total: 1 }, items: [] })
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
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      {
        ...grantRecord(),
        resourceServerId: builtIn.id,
        connectionId: null,
        authorizationDetails: [accountAuthority],
        scope: 'users:read',
      },
      { ...grantRecord(), id: 'wrong-resource', resourceServerId: 'other', authorizationDetails: [accountAuthority] },
      { ...grantRecord(), id: 'wrong-authority', resourceServerId: builtIn.id, authorizationDetails: [] },
    ])

    await expect(
      getAgentResourceServer(deps, builtIn.id, principal(), 'https://auth.example.com/'),
    ).resolves.toMatchObject({ id: builtIn.id, connection: { status: 'not_required' } })
    const details = await listAgentAuthorizationDetailCatalog(deps, builtIn.id, principal(), { limit: 10, offset: 0 })
    expect(details.items).toHaveLength(1)
    expect(details.items[0]).toMatchObject({
      name: 'Organization Display',
      authorizationDetail: { type: 'realmroot_authority' },
      authorizedScopes: ['users:read'],
    })

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
      listAgentAuthorizationDetailCatalog(deps, builtIn.id, principal(), { limit: 10, offset: 0 }),
    ).resolves.toMatchObject({
      items: [{ name: 'Organization Display', metadata: { authority: 'organization', organizationId: 'org-1' } }],
    })

    vi.mocked(deps.authorization.findOrganization).mockResolvedValue(null)
    await expect(
      listAgentAuthorizationDetailCatalog(deps, builtIn.id, principal(), { limit: 10, offset: 0 }),
    ).resolves.toMatchObject({ items: [], pagination: { total: 0 } })
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

    const organizationAuthority = { type: 'realmroot_authority', authority: 'organization', id: 'org-1' }
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
      ...identityAggregate(),
      identity: { ...identityAggregate().identity, ownerUserId: 'user-1', ownerOrganizationId: null },
    })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      resourceId: builtIn.id,
      connectionId: null,
      scopes: ['users:read'],
      authorizationDetails: [organizationAuthority],
    })
    vi.mocked(deps.authorization.listUserMemberships).mockResolvedValue([])
    await expect(
      decideAgentAccessRequest(
        deps,
        'request-1',
        { decision: 'approve', mode: 'persistent', authorizationDetails: [organizationAuthority] },
        'user-1',
      ),
    ).rejects.toThrow('controller effective scope')

    const otherUserAuthority = { type: 'realmroot_authority', authority: 'user', id: 'user-2' }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      resourceId: builtIn.id,
      connectionId: null,
      scopes: ['users:read'],
      authorizationDetails: [otherUserAuthority],
    })
    await expect(
      decideAgentAccessRequest(
        deps,
        'request-1',
        { decision: 'approve', mode: 'persistent', authorizationDetails: [otherUserAuthority] },
        'user-1',
      ),
    ).rejects.toThrow('controller effective scope')
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
      approvedEntitlements: [{ scope: 'users:read', entitlementId: 'ent_1' }],
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(approved)
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      resourceServerId: builtIn.id,
      connectionId: null,
      scope: approved.scopes[0],
      authorizationDetails: [authority],
      mode: 'persistent',
    })
    const signer = { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('credential-token') }
    const endpoint = `https://auth.example.com/api/agent/access-requests/${approved.id}/credentials`

    await expect(
      createAccessRequestCredential(deps, approved.id, await createDpopProof(endpoint), endpoint, principal(), signer),
    ).resolves.toMatchObject({
      accessToken: 'credential-token',
      resourceIndicator: builtIn.resourceUrl,
      authorizationDetails: [authority],
    })

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...approved,
      status: 'pending',
      approvedEntitlements: [],
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
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connection])
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      { ...grantRecord(), authorizationDetails: [detail], mode: 'persistent' },
      { ...grantRecord(), id: 'wrong-resource', resourceServerId: 'other', authorizationDetails: [detail] },
      { ...grantRecord(), id: 'wrong-connection', connectionId: 'other', authorizationDetails: [detail] },
      {
        ...grantRecord(),
        id: 'revoked',
        endedAt: now,
        endReason: 'revoked',
        authorizationDetails: [detail],
      },
      { ...grantRecord(), id: 'expired', expiresAt: new Date(0), authorizationDetails: [detail] },
      { ...grantRecord(), id: 'other-detail', authorizationDetails: [{ ...detail, project_id: 'project-2' }] },
    ])
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())

    const catalog = await listAgentAuthorizationDetailCatalog(deps, external.id, principal(), { limit: 10, offset: 0 })
    expect(catalog.items[0]).toMatchObject({
      authorizationDetail: detail,
      name: 'project-1',
      metadata: { project_id: 'project-1' },
      accountAuthorizationStatus: 'authorized',
      authorizedScopes: ['projects:read'],
      requestableScopes: ['projects:write'],
    })
    expect(catalog.pagination.total).toBe(3)
    expect(catalog.items[1]).toMatchObject({ name: '2', metadata: { project_id: '2' } })
    expect(catalog.items[2]).toMatchObject({ name: 'project_access', metadata: {} })

    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])
    const created = await createAccessRequest(
      deps,
      { resourceServerId: external.id, scopes: ['projects:read'], authorizationDetails: [detail] },
      principal(),
      'https://auth.example.com',
    )
    expect(created).toMatchObject({ resourceServerId: external.id, authorizationDetails: [detail] })
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
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
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
    const pending = { ...approved, status: 'pending' as const, approvedEntitlements: [] }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(pending)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(pending)

    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      requiresAccountConnection: false,
      authorizationDetail: { name: 'Organization Display' },
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

    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(approved)
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).rejects.toThrow('not found')

    const serviceRequest = {
      ...pending,
      authorizationDetails: [],
    }
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(serviceRequest)
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(serviceRequest)
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      authorizationDetail: null,
    })
  })

  it('validates optional authorization details against the selected Resource Server', async () => {
    const nativeDeps = createTestDeps()
    const native = nativeResource()
    vi.mocked(nativeDeps.authorization.findResource).mockResolvedValue(native)
    vi.mocked(nativeDeps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    mockResourceOpenApi(nativeDeps, native.resourceUrl)
    await expect(
      createAccessRequest(
        nativeDeps,
        {
          resourceServerId: native.id,
          scopes: ['projects:read'],
          authorizationDetails: [{ type: 'project_access', project_id: 'project-1' }],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Native API resources do not accept authorization details.')

    const realmrootDeps = createTestDeps()
    const builtIn = {
      ...native,
      id: 'resource-realmroot',
      identifier: 'realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
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
        { resourceServerId: builtIn.id, scopes: ['users:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Select exactly one Realmroot authority detail.')

    const externalDeps = createTestDeps()
    authorizationDeps(externalDeps)
    vi.mocked(externalDeps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(externalDeps.externalResources.findConnectionByOwnerResource).mockResolvedValue(null)
    await expect(
      createAccessRequest(
        externalDeps,
        { resourceServerId: resource().id, scopes: ['projects:read'] },
        principal(),
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ status: 'pending', interaction: { status: 'pending' } })

    vi.mocked(externalDeps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    await expect(
      createAccessRequest(
        externalDeps,
        {
          resourceServerId: resource().id,
          scopes: ['projects:read'],
          authorizationDetails: [{ type: 'unsupported' }],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('does not use authorization details')
  })

  it('rejects malformed Realmroot authority approval records', async () => {
    const deps = createTestDeps()
    const builtIn = {
      ...nativeResource(),
      id: 'resource-realmroot',
      identifier: 'realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
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
        approvedEntitlements: status === 'consumed' ? [{ scope: 'projects:read', entitlementId: 'ent_1' }] : [],
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
    const builtIn = {
      ...nativeResource(),
      id: 'resource-realmroot',
      identifier: 'realmroot',
      resourceUrl: 'https://auth.example.com/api',
    }
    vi.mocked(deps.authorization.findResource).mockResolvedValue(builtIn)
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      name: 'Organization',
      displayName: null,
      disabled: false,
    } as never)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    const authorities = await listAgentAuthorizationDetailCatalog(deps, builtIn.id, principal(), {
      limit: 10,
      offset: 0,
    })
    expect(authorities.items).toHaveLength(1)

    const native = nativeResource()
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    mockResourceOpenApi(deps, native.resourceUrl)
    await expect(
      listAgentAuthorizationDetailCatalog(deps, native.id, principal(), { limit: 10, offset: 1 }),
    ).resolves.toMatchObject({ items: [], pagination: { total: 0 } })
  })

  it('resolves approval Resources through a paginated external catalog', async () => {
    const deps = authorizationCatalogDeps()
    const catalogConnector = await deps.connectors.findById('connector-1')
    vi.mocked(deps.connectors.findById).mockResolvedValue({ ...catalogConnector!, registrationMode: 'manual' })
    const requested = { type: 'project_access', project_id: 'project-2', actions: ['read'] }
    const pending = { ...requestRecord(), authorizationDetails: [requested] }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(pending)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(pending)
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connectionRecord(),
      grantedScopes: [...connectionRecord().grantedScopes, 'authorization-details:read'],
    })
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([grantRecord()])
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

    await expect(
      createAgentResourceConnectionRequest(
        deps,
        resource().id,
        { scopes: ['projects:read'], authorizationDetails: [requested] },
        principal(),
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ authorizationDetails: [requested] })

    await expect(
      createAgentResourceConnectionRequest(
        deps,
        resource().id,
        {
          scopes: ['projects:read'],
          authorizationDetails: [{ ...requested, project_id: 'missing' }],
        },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Authorization detail is not available through this Resource Server connection.')

    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(null)
    await expect(
      createAgentResourceConnectionRequest(
        deps,
        resource().id,
        { scopes: ['projects:read'], authorizationDetails: [requested] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Connect the Resource Server before selecting authorization details.')

    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      authorizationDetail: {
        name: 'Project Two',
        description: 'Second project',
        metadata: { project: '2' },
      },
    })

    const fallbackDisplay = { ...pending, authorizationDetails: [{ ...requested, project_id: 'project-1' }] }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(fallbackDisplay)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(fallbackDisplay)
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      authorizationDetail: { name: 'Project One', description: null, metadata: {} },
    })

    const missing = { ...pending, authorizationDetails: [{ ...requested, project_id: 'missing' }] }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(missing)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(missing)
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).rejects.toThrow(
      'Authorization detail was not found.',
    )
  })

  it('advertises the external authorization server token endpoint in credential offers', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connectionRecord(), { clientGeneration: 2 }),
    )
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
    const approved = {
      ...requestRecord(),
      status: 'approved' as const,
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    }
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
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connectionRecord(), { clientGeneration: 99 }),
    )
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
      listAgentAuthorizationDetailCatalog(deps, resource().id, principal(), { limit: 10, offset: 1 }),
    ).resolves.toMatchObject({ items: [], pagination: { total: 0 } })

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

    organizationIdentity.identity.ownerUserId = 'user-1'
    organizationIdentity.identity.ownerOrganizationId = null
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(null)
    await expect(
      createAccountConnection(
        deps,
        { context: 'connection-request', approvalToken: 'approval-token' },
        'user-1',
        'https://auth.example.com',
      ),
    ).resolves.toMatchObject({ owner: { type: 'user' }, authorizationDetails: [requestedDetail] })
  })

  it('keeps an unbound external approval available while requiring bound connections to remain active', async () => {
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

    const unconnected = { ...pending, connectionId: null }
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(unconnected)
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(unconnected)
    await expect(getAccountAccessRequestByToken(deps, 'approval-token', 'user-1')).resolves.toMatchObject({
      id: unconnected.id,
      requiresAccountConnection: true,
    })
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

  it('rejects duplicate authorization details', async () => {
    const duplicateDeps = createTestDeps()
    authorizationDeps(duplicateDeps)
    vi.mocked(duplicateDeps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(duplicateDeps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    const detail = { type: 'project_access', project_id: 'project-1' }
    await expect(
      createAgentResourceConnectionRequest(
        duplicateDeps,
        resource().id,
        { scopes: ['projects:read'], authorizationDetails: [detail, detail] },
        principal(),
        'https://auth.example.com',
      ),
    ).rejects.toThrow('Authorization details contain duplicate entries.')
    await expect(
      createAgentResourceConnectionRequest(
        duplicateDeps,
        resource().id,
        {
          scopes: ['projects:read'],
          authorizationDetails: [],
        },
        principal(),
        '',
      ),
    ).resolves.toMatchObject({ resourceServerId: resource().id, status: 'connected' })
  })

  it('discovers enabled resources independently of deleted database history', async () => {
    const deps = createTestDeps()
    const active = nativeResource()
    const managementPage = vi.fn().mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) => ({
        ...nativeResource(),
        id: `deleted-${index}`,
        deletedAt: now,
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
      items: [{ id: active.id }],
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
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])
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
          authorizationDetail: null,
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
    vi.mocked(deps.externalResources.approveAccessRequestWithEntitlements).mockImplementation(
      async (records, _updates, id, decision) => ({
        entitlements: records,
        request: { ...requestRecord(), id, ...decision },
      }),
    )
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
    vi.mocked(deps.externalResources.listAgentPermissions).mockResolvedValue({
      items: [
        {
          entitlement: grantRecord(),
          resource: { id: 'resource-1', identifier: 'resource-1', name: 'Resource 1' },
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    })
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([grantRecord()])
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.endEntitlement).mockResolvedValue(true)

    await expect(
      listAgentPermissions(deps, principal(), {
        limit: 10,
        offset: 0,
        resourceServerId: 'resource-1',
        status: 'inactive',
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'ent_1', target: { accountConnectionId: 'connection-1' } }],
    })
    expect(deps.externalResources.listAgentPermissions).toHaveBeenCalledWith({
      agentId: 'identity-1',
      limit: 10,
      offset: 0,
      resourceServerId: 'resource-1',
      status: 'inactive',
    })
    await expect(getAgentPermission(deps, 'ent_1', principal())).resolves.toMatchObject({ id: 'ent_1' })
    await revokeAgentResourceAccess(deps, 'identity-1')
    expect(deps.externalResources.endEntitlement).toHaveBeenCalledWith('ent_1', 'revoked', expect.any(Date))

    const lease = {
      id: 'lease-1',
      entitlementIds: ['ent_1'],
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
      { ...lease, entitlementIds: ['missing'] },
      lease,
    ])
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValueOnce(null).mockResolvedValueOnce(grantRecord())
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
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      connectionId: null,
      mode: 'once',
      expiresAt: new Date(Date.now() + 120_000),
    })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      connectionId: null,
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    vi.mocked(deps.externalResources.createTokenLease).mockImplementation(async (record) => record)
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    const proof = await new SignJWT({
      htm: 'POST',
      htu: 'https://auth.example.com/api/agent/access-requests/request-1/credentials',
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
      .sign(privateKey)
    const sign = vi.fn().mockResolvedValue('native-access-token')

    await expect(
      issueTargetAccessToken(
        deps,
        'request-1',
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
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

    const connectorNative = {
      ...native,
      providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
    }
    const connectorRequest = {
      ...requestRecord(),
      status: 'approved' as const,
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    }
    const connectorConnection = connectionWithCredential(connectionRecord(), {
      credentialCustody: 'realmroot',
      encryptedTokens: 'sealed:provider-credentials',
    })
    vi.mocked(deps.authorization.findResource).mockResolvedValue(connectorNative)
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(connectorRequest)
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectorConnection)
    await expect(
      issueTargetAccessToken(
        deps,
        'request-1',
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).resolves.toMatchObject({ accessToken: 'native-access-token' })
    expect(sign).toHaveBeenLastCalledWith(expect.objectContaining({ connection_id: connectorConnection.id }), 'at+jwt')

    for (const invalidConnection of [
      { ...connectorConnection, status: 'revoked' as const },
      { ...connectorConnection, resourceId: 'resource-2' },
      connectionWithCredential(connectorConnection, {
        credentialCustody: 'resource_server',
        encryptedTokens: null,
        brokerReference: 'broker-reference',
      }),
      connectionWithCredential(connectorConnection, { encryptedTokens: null }),
    ]) {
      vi.mocked(deps.externalResources.findConnection).mockReset().mockResolvedValue(invalidConnection)
      await expect(
        issueTargetAccessToken(
          deps,
          'request-1',
          proof,
          'https://auth.example.com/api/agent/access-requests/request-1/credentials',
          principal(),
          { issuer: principal().issuer, sign },
        ),
      ).rejects.toThrow('Active provider account connection is required.')
    }

    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      connectionId: null,
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      connectionId: null,
    })
    vi.mocked(deps.externalResources.issueTokenLeaseWithAudit).mockResolvedValueOnce(null)
    await expect(
      issueTargetAccessToken(
        deps,
        'request-1',
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('Every approved scope requires an active Entitlement.')
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      connectionId: null,
      mode: 'once',
      endedAt: new Date(),
      endReason: 'consumed',
    })
    await expect(
      issueTargetAccessToken(
        deps,
        'request-1',
        proof,
        'https://auth.example.com/api/agent/access-requests/request-1/credentials',
        principal(),
        { issuer: principal().issuer, sign },
      ),
    ).rejects.toThrow('Every approved scope requires an active Entitlement.')
  })

  it('binds brokered native access tokens to the active resource-server-custodied connection', async () => {
    const deps = createTestDeps()
    const authorizationDetails = [
      {
        type: 'github_installation',
        installation_id: '152097080',
        account_login: 'realmroot',
        selector: { repositories: ['realmroot/realmroot'] },
      },
    ]
    const native = {
      ...nativeResource(),
      authorizationModel: 'realmroot' as const,
      providerConnection: { connectorId: 'connector-1', mode: 'brokered' as const },
      authorizationDetails: [{ type: 'github_installation' }],
      scopeRegistry: {
        ...nativeResource().scopeRegistry!,
        accountConnection: {
          mode: 'brokered' as const,
          authorizationEndpoint: 'https://adapter.example/github/account-connection-authorizations',
          tokenEndpoint: 'https://adapter.example/github/account-connection-credentials',
        },
      },
    }
    const connection = connectionWithCredential(
      {
        ...connectionRecord(),
        resourceId: native.id,
        ownerUserId: 'user-1',
        ownerOrganizationId: null,
        authorizationDetails,
        authorityConstraints: [{ authorizationDetails, scopes: ['openid', 'offline_access', 'projects:read'] }],
      },
      {
        credentialCustody: 'resource_server',
        encryptedTokens: null,
        brokerReference: 'broker-reference-1',
        authorizationDetails,
        authorityConstraints: [{ authorizationDetails, scopes: ['openid', 'offline_access', 'projects:read'] }],
      },
    )
    Object.assign(deps.authorization, { findResource: vi.fn().mockResolvedValue(native) })
    mockResourceOpenApi(deps, native.resourceUrl)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      connectionId: connection.id,
      authorizationDetails,
    })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      connectionId: connection.id,
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
      authorizationDetails,
    })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      connectionId: connection.id,
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
      authorizationDetails,
    })
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      { ...grantRecord(), connectionId: connection.id, authorizationDetails },
    ])
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    const tokenUrl = 'https://auth.example.com/api/agent/access-requests/request-1/credentials'
    const proof = await new SignJWT({
      htm: 'POST',
      htu: tokenUrl,
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
      .sign(privateKey)
    const sign = vi.fn().mockResolvedValue('brokered-native-access-token')
    const signer = { issuer: principal().issuer, sign }

    await expect(getAccessRequest(deps, 'request-1', principal(), 'https://auth.example.com')).resolves.toMatchObject({
      credentialOffer: {
        proof: { uri: 'https://auth.example.com/api/agent/access-requests/request-1/credentials' },
      },
    })
    await expect(
      listAgentAuthorizationDetailCatalog(deps, native.id, principal(), { limit: 10, offset: 0 }),
    ).resolves.toMatchObject({
      items: [{ authorizationDetail: { type: 'github_installation' } }],
    })
    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue({
      ...requestRecord(),
      id: 'request-1',
      connectionId: connection.id,
      status: 'pending',
      authorizationDetails,
    })
    await expect(
      listAccountAccessRequestAuthorizationDetailCatalog(deps, 'request-1', 'approval-token', 'user-1', {
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          authorizationDetail: authorizationDetails[0],
          connectionStatus: 'authorized',
        },
      ],
      connection: { status: 'connected' },
    })

    await expect(
      issueTargetAccessToken(deps, 'request-1', proof, tokenUrl, principal(), signer),
    ).resolves.toMatchObject({
      accessToken: 'brokered-native-access-token',
      authorizationDetails,
      resourceUrl: native.resourceUrl,
    })
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_id: connection.credentials[0]!.brokerReference,
        authorization_details: authorizationDetails,
      }),
      'at+jwt',
    )
    expect(deps.externalResources.issueTokenLeaseWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationDetails }),
      ['ent_1'],
      expect.any(Date),
      expect.objectContaining({ resourceConnectionId: connection.id }),
    )

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connection, { brokerReference: null }),
    )
    await expect(issueTargetAccessToken(deps, 'request-1', proof, tokenUrl, principal(), signer)).rejects.toThrow(
      'Active brokered account connection is required.',
    )

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue({
      ...connection,
      authorityConstraints: [{ authorizationDetails, scopes: [] }],
    })
    await expect(issueTargetAccessToken(deps, 'request-1', proof, tokenUrl, principal(), signer)).rejects.toThrow(
      'selected authority boundary',
    )

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connection, {
        credentialCustody: 'realmroot',
        encryptedTokens: connectionRecord().credentials[0]!.encryptedTokens,
        brokerReference: null,
      }),
    )
    await expect(issueTargetAccessToken(deps, 'request-1', proof, tokenUrl, principal(), signer)).rejects.toThrow(
      'Active brokered account connection is required.',
    )

    vi.mocked(deps.authorization.findResource).mockResolvedValue({ ...native, authorizationDetails: [] })
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      connectionId: connection.id,
      authorizationDetails: [],
    })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      connectionId: null,
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
      authorizationDetails: [],
    })
    await expect(issueTargetAccessToken(deps, 'request-1', proof, tokenUrl, principal(), signer)).rejects.toThrow(
      'Every approved scope requires an active Entitlement.',
    )
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
    ).resolves.toMatchObject({ status: 'pending', connectionId: null })

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
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])
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
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connectionRecord()])
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([durableGrant])
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: durableGrant.scope, entitlementId: durableGrant.id }],
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
      approvedEntitlements: [{ scope: durableGrant.scope, entitlementId: durableGrant.id }],
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
    await expect(getApiResource(deps, 'missing', 'https://auth.example.com')).rejects.toThrow(
      'API resource was not found.',
    )
    vi.mocked(deps.connectors.findById).mockResolvedValueOnce(null)
    await expect(getApiResource(deps, 'resource-1', 'https://auth.example.com')).resolves.toMatchObject({
      authorization: null,
    })
    vi.mocked(deps.externalResources.consumeConnectionIntent).mockResolvedValue(null)
    await expect(
      completeResourceConnectionIntent(deps, { state: 'invalid', code: 'code' }, 'https://auth.example.com'),
    ).rejects.toThrow('Resource connection state is invalid')

    vi.mocked(deps.authorization.listEnabledResources).mockResolvedValue([
      resource(),
      { ...nativeResource(), id: 'native' },
    ])
    vi.mocked(deps.connectors.findById).mockResolvedValue(null)
    await expect(listConnectableExternalResources(deps)).resolves.toEqual({ items: [] })
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
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      { ...grantRecord(), expiresAt: new Date(Date.now() - 1) },
      {
        ...grantRecord(),
        id: 'grant-live',
        expiresAt: new Date(Date.now() + 30_000),
        endedAt: now,
        endReason: 'revoked',
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
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connectionRecord()])
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      { ...grantRecord(), connectionId: 'other-connection' },
      { ...grantRecord(), resourceServerId: 'other-resource' },
      { ...grantRecord(), scope: 'projects:write' },
      { ...grantRecord(), expiresAt: new Date(Date.now() - 1) },
      grantRecord(),
    ])
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
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
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
      reason: 'Scheduled synchronization',
      approvalUrl: null,
    })
  })

  it('reuses active Entitlements independently of an older approved request', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connectionRecord())
    vi.mocked(deps.externalResources.listConnectionsByOrganizations).mockResolvedValue([connectionRecord()])
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([grantRecord()])
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
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
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
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
    ).rejects.toThrow('Permission expiry must be in the future.')

    vi.mocked(deps.externalResources.approveAccessRequestWithEntitlements).mockResolvedValue('request_changed')
    vi.mocked(deps.externalResources.decideAccessRequest).mockResolvedValue(null)
    await expect(
      decideAgentAccessRequest(deps, 'request-1', { decision: 'approve', mode: 'persistent' }, 'user-1'),
    ).rejects.toThrow('already decided')

    vi.mocked(deps.externalResources.findAccessRequestByApprovalTokenHash).mockResolvedValue(requestRecord())
    await expect(
      decideAccessRequest(deps, 'different-request', { decision: 'deny', approvalToken: 'approval-token' }, 'user-1'),
    ).rejects.toThrow('Agent access request was not found.')
    await expect(decideAccessRequest(deps, 'request-1', { decision: 'deny' }, 'user-1')).rejects.toThrow(
      'already decided',
    )
    await expect(getAccountAccessRequest(deps, 'different-request', 'user-1', 'approval-token')).rejects.toThrow(
      'Agent access request was not found.',
    )
  })

  it('rejects invalid grants before issuing a target token', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    const signer = { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('token') }

    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(null)
    await expect(
      issueTargetAccessToken(deps, 'missing', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Approved Agent access request is required.')

    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      agentIdentityId: 'another-agent',
    })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Every approved scope requires an active Entitlement.')

    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(null)
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Approved Agent access request is required.')

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      agentIdentityId: 'another-agent',
      status: 'approved',
    })
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Approved Agent access request is required.')
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'another-entitlement' }],
    })
    await expect(
      issueTargetAccessToken(deps, 'grant-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Every approved scope requires an active Entitlement.')
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'denied',
    })
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Approved Agent access request is required.')

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      expiresAt: new Date(Date.now() - 1),
    })
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Every approved scope requires an active Entitlement.')

    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      authorizationDetails: [{ type: 'unexpected', id: '1' }],
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Every approved scope requires an active Entitlement.')

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce({ ...resource(), enabled: false })
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Enabled Resource Server is required.')

    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce({
      ...resource(),
      visibility: 'private',
      ownerOrganizationId: 'other-organization',
    })
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Resource Server is not visible to this Agent.')

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(
      connectionWithCredential(connectionRecord(), { clientGeneration: 2 }),
    )
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Active external API resource grant is required.')

    vi.mocked(deps.externalResources.findConnection).mockResolvedValue(null)
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', 'https://auth.example.com/token', principal(), signer),
    ).rejects.toThrow('Active external API resource grant is required.')
  })

  it('rejects malformed, misbound, stale, and replayed native DPoP proofs', async () => {
    const deps = createTestDeps()
    const native = nativeResource()
    authorizationDeps(deps)
    vi.mocked(deps.authorization.findResource).mockResolvedValue(native)
    mockResourceOpenApi(deps, native.resourceUrl)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      connectionId: null,
      mode: 'persistent',
    })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      connectionId: null,
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    const signer = { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('native-token') }
    const tokenUrl = 'https://auth.example.com/api/agent/access-requests/request-1/credentials'

    vi.mocked(deps.authorization.findResource).mockResolvedValueOnce({
      ...native,
      authorizationModel: 'realmroot',
      providerConnection: { connectorId: 'connector-1', mode: 'brokered' as const },
      scopeRegistry: {
        ...native.scopeRegistry!,
        accountConnection: {
          mode: 'brokered',
          authorizationEndpoint: 'https://adapter.example/connect',
          tokenEndpoint: 'https://adapter.example/token',
        },
      },
    })
    await expect(issueTargetAccessToken(deps, 'request-1', 'proof', tokenUrl, principal(), signer)).rejects.toThrow(
      'Active brokered account connection is required.',
    )

    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValueOnce({
      ...requestRecord(),
      connectionId: 'connection-1',
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValueOnce({
      ...grantRecord(),
      connectionId: 'connection-1',
      mode: 'persistent',
    })
    await expect(issueTargetAccessToken(deps, 'request-1', 'proof', tokenUrl, principal(), signer)).rejects.toThrow(
      'Native API resource grants cannot use account connections.',
    )
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'proof', tokenUrl, principal(), {
        ...signer,
        issuer: 'https://other.example.com',
      }),
    ).rejects.toThrow('does not belong to the active OAuth issuer')
    await expect(
      issueTargetAccessToken(deps, 'request-1', 'not-a-jwt', tokenUrl, principal(), signer),
    ).rejects.toThrow()

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
      issueTargetAccessToken(deps, 'request-1', signedParts.join('.'), tokenUrl, principal(), signer),
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
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      resourceServerId: builtIn.id,
      connectionId: null,
      scope: 'users:read',
      authorizationDetails: [authority],
      mode: 'persistent',
    })
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      resourceId: builtIn.id,
      connectionId: null,
      scopes: ['users:read'],
      authorizationDetails: [authority],
      status: 'approved',
      approvedEntitlements: [{ scope: 'users:read', entitlementId: 'ent_1' }],
    })
    const signer = { issuer: principal().issuer, sign: vi.fn().mockResolvedValue('realmroot-token') }
    const tokenUrl = 'https://auth.example.com/api/agent/access-requests/request-1/credentials'

    const result = await issueTargetAccessToken(
      deps,
      'request-1',
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
      }),
      'at+jwt',
    )
    const signedScope = String(signer.sign.mock.calls[0]![0].scope).split(' ')
    expect(signedScope).toContain('users:read')
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

    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(null)
    await expect(revokeAgentPermission(deps, 'missing', 'user-1')).rejects.toThrow('Agent Permission was not found.')
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grantRecord())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(null)
    await expect(revokeAgentPermission(deps, 'grant-1', 'user-1')).rejects.toThrow(
      'Source Agent access request was not found.',
    )
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      sourceAccessRequestId: null,
    })
    await expect(revokeAgentPermission(deps, 'grant-1', 'user-1')).rejects.toThrow(
      'Source Agent access request was not found.',
    )

    vi.mocked(deps.authorization.findResource).mockResolvedValue(nativeResource())
    vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([
      { ...grantRecord(), connectionId: null },
    ])
    vi.mocked(deps.externalResources.listActiveTokenLeasesByEntitlement).mockResolvedValue([
      {
        id: 'lease-native',
        entitlementIds: ['ent_1'],
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
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(null)
    await expect(revokeAgentResourceAccess(deps, 'identity-1')).rejects.toThrow(
      'Approved Agent access request was not found.',
    )
    vi.mocked(deps.authorization.findResource).mockResolvedValue(resource())
    vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({ ...requestRecord(), connectionId: null })
    await expect(revokeAgentResourceAccess(deps, 'identity-1')).rejects.toThrow(
      'Resource account connection was not found.',
    )
    vi.mocked(deps.authorization.findResource).mockResolvedValue(nativeResource())
    vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue({
      ...requestRecord(),
      status: 'approved',
      approvedEntitlements: [{ scope: 'projects:read', entitlementId: 'ent_1' }],
    })
    await revokeAgentResourceAccess(deps, 'identity-1')
    expect(deps.externalResources.revokeTokenLease).toHaveBeenCalledWith('lease-native', expect.any(Date))

    vi.mocked(deps.authorization.findResource).mockResolvedValue(null)
    await expect(revokeAgentResourceAccess(deps, 'identity-1')).rejects.toThrow('API resource was not found.')
  })

  it('rejects unknown grants and missing host bindings in account views', async () => {
    const deps = createTestDeps()
    authorizationDeps(deps)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue({
      ...grantRecord(),
      agentIdentityId: 'another-agent',
    })
    await expect(getAgentPermission(deps, 'grant-1', principal())).rejects.toThrow('Agent Permission was not found.')
    vi.mocked(deps.externalResources.findEntitlement).mockResolvedValue(grantRecord())
    vi.mocked(deps.authorization.findResource).mockResolvedValue(null)
    await expect(getAgentPermission(deps, 'grant-1', principal())).rejects.toThrow(
      'Agent Permission Resource Server was not found.',
    )

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
  const realmrootResource = {
    ...resource(),
    id: 'resource-realmroot',
    identifier: 'realmroot',
    name: 'Realmroot',
    resourceUrl: 'https://auth.example.com/api',
    authorizationModel: 'realmroot' as const,
    providerConnection: null,
  }
  Object.assign(deps.authorization, {
    findResource: vi
      .fn()
      .mockImplementation(async (id: string) => (id === realmrootResource.id ? realmrootResource : resource())),
    listResources: vi.fn().mockResolvedValue({
      items: [realmrootResource, resource()],
      pagination: { total: 2, limit: 100, offset: 0, hasMore: false, nextOffset: null },
    }),
    listEnabledResources: vi.fn().mockResolvedValue([resource()]),
    listUserMemberships: vi.fn().mockResolvedValue([{ organizationId: 'org-1', roles: ['owner'] }]),
    listActiveUserScopeEntitlements: vi
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
    authorizationModel: 'federated',
    providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
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
    authorizationModel: 'realmroot',
    providerConnection: null,
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
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
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
  const connection = {
    ...connectionRecord(),
    grantedScopes: options.grantedScopes ?? [...connectionRecord().grantedScopes, 'authorization-details:read'],
  }
  vi.mocked(deps.externalResources.findConnectionByOwnerResource).mockResolvedValue(connection)
  vi.mocked(deps.externalResources.listActiveEntitlementsByAgent).mockResolvedValue([])
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
    authenticationEnabled: false,
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

function connectionRecord(): ProviderResourceAuthorizationRecord {
  const credentialExpiresAt = new Date(Date.now() + 300_000)
  return {
    id: 'connection-1',
    providerConnectionId: 'provider-connection-1',
    resourceId: 'resource-1',
    ownerUserId: null,
    ownerOrganizationId: 'org-1',
    externalSubject: 'target-user-1',
    displayName: 'Project Owner',
    grantedScopes: ['openid', 'offline_access', 'projects:read'],
    authorizationDetails: [],
    authorityConstraints: [],
    credentials: [
      {
        id: 'credential-1',
        providerResourceAuthorizationId: 'connection-1',
        externalSubject: 'target-user-1',
        displayName: 'Project Owner',
        credentialCustody: 'realmroot',
        encryptedTokens: 'sealed:{"accessToken":"subject","refreshToken":"refresh"}',
        brokerReference: null,
        grantedScopes: ['openid', 'offline_access', 'projects:read'],
        authorizationDetails: [],
        authorityConstraints: [],
        clientGeneration: 1,
        credentialVersion: 1,
        refreshClaimId: null,
        refreshClaimExpiresAt: null,
        status: 'active',
        credentialExpiresAt,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    status: 'active',
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function connectionWithCredential(
  connection: ProviderResourceAuthorizationRecord,
  overrides: Partial<ProviderCredentialRecord>,
): ProviderResourceAuthorizationRecord {
  const credential = { ...connection.credentials[0]!, ...overrides }
  return {
    ...connection,
    credentials: [credential],
    grantedScopes: credential.grantedScopes,
    authorizationDetails: credential.authorizationDetails,
    authorityConstraints: credential.authorityConstraints,
    status: credential.status,
    updatedAt: credential.updatedAt,
  }
}

function providerConnectionFor(connection: ProviderResourceAuthorizationRecord): ProviderConnectionRecord {
  return {
    id: connection.providerConnectionId,
    connectorId: 'connector-1',
    ownerUserId: connection.ownerUserId,
    ownerOrganizationId: connection.ownerOrganizationId,
    authenticationAccountId: null,
    externalSubject: connection.externalSubject,
    displayName: connection.displayName,
    status: 'active',
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  }
}

function connectorBackedExchangeFixture(options: { expired?: boolean; subjectToken?: string } = {}) {
  const deps = createTestDeps()
  authorizationDeps(deps)
  const subjectToken = options.subjectToken ?? 'realmroot-agent-access-token'
  const connectedResource = {
    ...nativeResource(),
    providerConnection: { connectorId: 'connector-1', mode: 'managed' as const },
    resourceUrl: 'https://adapters.example.com/cloudflare',
  }
  const connection = connectionWithCredential(connectionRecord(), {
    credentialCustody: 'realmroot',
    encryptedTokens: 'sealed:{"accessToken":"provider-access-token","refreshToken":"provider-refresh-token"}',
    credentialExpiresAt: new Date(Date.now() + (options.expired ? -60_000 : 300_000)),
  })
  const request = { ...requestRecord(), status: 'approved' as const }
  const entitlement = grantRecord()
  const lease = {
    id: 'lease-1',
    entitlementIds: [entitlement.id],
    requestId: request.id,
    bindingId: request.bindingId,
    encryptedAccessToken: `sealed:${subjectToken}`,
    tokenHash: 'token-hash',
    confirmationJkt: 'proof-thumbprint',
    scopes: ['projects:read'],
    authorizationDetails: [],
    expiresAt: new Date(Date.now() + 300_000),
    revokedAt: null,
    createdAt: now,
  }
  vi.mocked(deps.authorization.findResource).mockResolvedValue(connectedResource)
  vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(identityAggregate())
  vi.mocked(deps.externalResources.findActiveTokenLeaseByTokenHash).mockResolvedValue(lease)
  vi.mocked(deps.externalResources.findAccessRequest).mockResolvedValue(request)
  vi.mocked(deps.externalResources.findConnection).mockResolvedValue(connection)
  vi.mocked(deps.externalResources.findEntitlements).mockResolvedValue([entitlement])
  vi.mocked(deps.connectors.findById).mockResolvedValue(connectorRecord())
  return {
    deps,
    input: {
      subjectToken,
      audience: connectedResource.resourceUrl,
      scopes: ['projects:read'],
      claims: {
        aud: connectedResource.resourceUrl,
        sub: 'org-1',
        client_id: 'protocol-agent-1',
        connection_id: connection.id,
        scope: 'projects:read',
        act: { iss: 'https://auth.example.com/api/auth', sub: 'agt_stable', sub_profile: 'ai_agent' },
        cnf: { jkt: 'proof-thumbprint' },
      },
    },
  }
}

function identityAggregate(): AgentIdentityAggregate {
  return {
    identity: {
      id: 'identity-1',
      issuer: 'https://auth.example.com/api/auth',
      subject: 'agt_stable',
      username: 'project-agent.00000000000000000000000000000001',
      name: 'Project Agent',
      ownerUserId: null,
      ownerOrganizationId: 'org-1',
      status: 'active',
      deletedAt: null,
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

function base64UrlString(value: string) {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
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
    approvedEntitlements: [],
    expiresAt: new Date(Date.now() + 300_000),
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function grantRecord(): ResourceScopeEntitlementRecord {
  return {
    id: 'ent_1',
    userId: null,
    applicationId: null,
    agentIdentityId: 'identity-1',
    organizationId: null,
    resourceServerId: 'resource-1',
    connectionId: 'connection-1',
    authorizationDetails: [],
    authorizationContextHash: 'hash',
    scope: 'projects:read',
    mode: 'once',
    grantedByUserId: 'user-1',
    grantedByAgentIdentityId: null,
    sourceAccessRequestId: 'request-1',
    expiresAt: null,
    endedAt: null,
    endReason: null,
    createdAt: now,
    updatedAt: now,
  }
}
