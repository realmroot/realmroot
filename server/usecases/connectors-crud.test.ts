import type { ConnectorRow } from '@server/adapters/repos/connectors'
import {
  connectorReadiness,
  createConnector,
  deleteConnector,
  getConnector,
  loadAuthConnectorConfig,
  updateConnector,
} from '@server/usecases/connectors'
import type { Deps } from '@server/usecases/deps'
import type { ConnectorRepository } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

describe('service.test 2', () => {
  it('reports OIDC discovery readiness', async () => {
    const deps = {
      connectors: createRepository({
        byId: connector({
          id: 'idp_generic',
          providerType: 'generic_oauth',
          providerId: 'generic-oauth',
          clientSecret: null,
          issuer: 'https://idp.example.com',
        }),
      }),
    } as unknown as Deps

    await expect(connectorReadiness(deps, 'idp_generic')).resolves.toEqual({
      connectorId: 'idp_generic',
      ready: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'clientSecret',
          ok: false,
          message: 'Client secret is missing.',
        }),
        expect.objectContaining({
          key: 'oauthEndpoints',
          ok: false,
          message: 'OIDC issuer or required discovered endpoints are missing.',
        }),
      ]),
    })

    const discoveredDeps = {
      connectors: createRepository({
        byId: connector({
          id: 'idp_generic_discovered',
          providerType: 'generic_oauth',
          providerId: 'generic-oauth',
          clientSecret: 'GENERIC_SECRET',
          issuer: 'https://idp.example.com',
          authorizationEndpoint: 'https://idp.example.com/authorize',
          tokenEndpoint: 'https://idp.example.com/token',
          userInfoEndpoint: 'https://idp.example.com/userinfo',
          jwksEndpoint: 'https://idp.example.com/jwks',
        }),
      }),
    } as unknown as Deps
    await expect(connectorReadiness(discoveredDeps, 'idp_generic_discovered')).resolves.toEqual({
      connectorId: 'idp_generic_discovered',
      ready: true,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'oauthEndpoints',
          ok: true,
          message: 'OIDC issuer and discovered endpoints are configured.',
        }),
      ]),
    })

    const incompleteDeps = {
      connectors: createRepository({
        byId: connector({
          id: 'idp_generic_incomplete',
          providerType: 'generic_oauth',
          providerId: 'generic-oauth',
          clientSecret: 'GENERIC_SECRET',
          issuer: null,
          authorizationEndpoint: null,
          tokenEndpoint: null,
        }),
      }),
    } as unknown as Deps
    await expect(connectorReadiness(incompleteDeps, 'idp_generic_incomplete')).resolves.toEqual({
      connectorId: 'idp_generic_incomplete',
      ready: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'oauthEndpoints',
          ok: false,
          message: 'OIDC issuer or required discovered endpoints are missing.',
        }),
      ]),
    })
  })

  it('omits unsupported and incomplete enabled connector rows from auth config [spec: connectors-and-methods/social-login]', async () => {
    const deps = { connectors: createRepository() } as unknown as Deps

    await expect(
      createConnector(deps, {
        providerType: 'social',
        providerId: 'unsupported',
        displayName: 'Unsupported',
        clientId: 'client-id',
        clientSecret: 'UNSUPPORTED_SECRET',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Unsupported social provider.' })
    await expect(
      loadAuthConnectorConfig(createRepository({ enabled: [connector({ clientId: null })] })),
    ).resolves.toMatchObject({
      trustedProviders: [],
    })
    await expect(
      loadAuthConnectorConfig(createRepository({ enabled: [connector({ clientSecret: null })] })),
    ).resolves.toMatchObject({
      trustedProviders: [],
      socialProviders: {},
      genericOAuthProviders: [],
    })
    await expect(
      loadAuthConnectorConfig(
        createRepository({
          enabled: [
            connector({
              providerType: 'generic_oauth',
              providerId: 'generic-oauth',
              issuer: null,
              authorizationEndpoint: 'https://idp.example.com/authorize',
              tokenEndpoint: null,
              clientSecret: 'GENERIC_CLIENT_SECRET',
            }),
          ],
        }),
      ),
    ).resolves.toMatchObject({ genericOAuthProviders: [] })
    await expect(
      loadAuthConnectorConfig(
        createRepository({
          enabled: [
            connector({
              providerType: 'generic_oauth',
              providerId: 'generic-oauth',
              issuer: null,
              authorizationEndpoint: null,
              tokenEndpoint: 'https://idp.example.com/token',
              clientSecret: 'GENERIC_CLIENT_SECRET',
            }),
            connector({
              providerType: 'generic_oauth',
              providerId: 'mixed-generic',
              issuer: 'https://idp.example.com',
              authorizationEndpoint: 'https://idp.example.com/authorize',
              clientSecret: 'GENERIC_CLIENT_SECRET',
            }),
          ],
        }),
      ),
    ).resolves.toMatchObject({ genericOAuthProviders: [] })
    await expect(
      loadAuthConnectorConfig(
        createRepository({
          enabled: [
            connector({
              providerType: 'social',
              providerId: 'cognito',
              clientSecret: 'COGNITO_CLIENT_SECRET',
              providerMetadata: { domain: 'auth.example.com', region: 'us-east-1' },
            }),
            connector({
              providerType: 'social',
              providerId: 'unsupported',
              clientSecret: 'UNSUPPORTED_SECRET',
            }),
            connector({
              providerType: 'saml',
              providerId: 'google',
              clientSecret: 'SAML_SECRET',
            } as Partial<ConnectorRow>),
          ],
        }),
      ),
    ).resolves.toMatchObject({ trustedProviders: [] })
  })

  it('loads only OIDC connectors enabled for hosted login [spec: connectors-and-methods/oidc-login]', async () => {
    const oidc = {
      providerType: 'generic_oauth' as const,
      issuer: 'https://idp.example.com',
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
      jwksEndpoint: 'https://idp.example.com/jwks',
      clientSecret: 'OIDC_SECRET',
    }
    const config = await loadAuthConnectorConfig(
      createRepository({
        enabled: [
          connector({ ...oidc, providerId: 'login-oidc', loginEnabled: true }),
          connector({ ...oidc, providerId: 'resource-only-oidc', loginEnabled: false }),
        ],
      }),
    )

    expect(config.trustedProviders).toEqual(['login-oidc'])
    expect(config.genericOAuthProviders).toEqual([expect.objectContaining({ providerId: 'login-oidc' })])
  })

  it(`uses canonical callbacks and RAR types for dynamic OIDC registration
      [spec: agent-identity/external-api-resource-canonical-callback]
      [spec: agent-identity/external-resource-rich-authorization-connection]`, async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          issuer: 'https://idp.example.com',
          authorization_endpoint: 'https://idp.example.com/authorize',
          token_endpoint: 'https://idp.example.com/token',
          userinfo_endpoint: 'https://idp.example.com/userinfo',
          jwks_uri: 'https://idp.example.com/jwks',
          registration_endpoint: 'https://idp.example.com/register',
          grant_types_supported: ['authorization_code'],
          authorization_details_types_supported: ['project_access'],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'registered-client',
          client_secret: 'registered-secret',
        }),
      )
    const deps = {
      connectors: createRepository(),
      externalHttp: { fetch },
    } as unknown as Deps

    await createConnector(
      deps,
      {
        providerType: 'generic_oauth',
        providerId: 'projects',
        displayName: 'Projects',
        issuer: 'https://idp.example.com',
        registrationMode: 'dynamic',
      },
      'https://auth.example.com',
    )

    const registrationRequest = fetch.mock.calls[1]?.[0] as Request
    await expect(registrationRequest.json()).resolves.toMatchObject({
      redirect_uris: [
        'https://auth.example.com/api/auth/callback/projects',
        'https://auth.example.com/api/account-connections/oauth/callback',
      ],
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      authorization_details_types: ['project_access'],
    })
    expect(deps.connectors.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMetadata: expect.objectContaining({ grant_types_supported: ['authorization_code'] }),
      }),
    )
  })

  it('falls back to RFC 8414 authorization-server metadata [spec: agent-identity/external-api-resource-registration]', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(discoveryMetadata({ issuer: 'https://idp.example.com/oauth' })))
    const deps = {
      connectors: createRepository(),
      externalHttp: { fetch },
    } as unknown as Deps

    await createConnector(deps, {
      providerType: 'generic_oauth',
      providerId: 'projects',
      displayName: 'Projects',
      issuer: 'https://idp.example.com/oauth',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    })

    expect(fetch.mock.calls.map(([request]) => (request as Request).url)).toEqual([
      'https://idp.example.com/.well-known/openid-configuration/oauth',
      'https://idp.example.com/.well-known/oauth-authorization-server/oauth',
    ])
  })

  it.each([
    ['a missing issuer', { issuer: undefined }, undefined, 'OIDC connectors require an issuer.'],
    [
      'an issuer query',
      { issuer: 'https://idp.example.com?tenant=one' },
      undefined,
      'OIDC issuer cannot contain a query or fragment.',
    ],
    ['an unsafe issuer', { issuer: 'http://idp.example.com' }, undefined, 'OIDC issuer must use HTTPS'],
    [
      'failed discovery',
      { issuer: 'https://idp.example.com' },
      new Response(null, { status: 503 }),
      'OAuth authorization server discovery failed.',
    ],
    [
      'invalid discovery JSON',
      { issuer: 'https://idp.example.com' },
      new Response('invalid', { headers: { 'content-type': 'application/json' } }),
      'OIDC discovery response is invalid.',
    ],
    [
      'a mismatched discovery issuer',
      { issuer: 'https://idp.example.com' },
      Response.json({
        ...discoveryMetadata(),
        issuer: 'https://other.example.com',
      }),
      'OIDC discovery issuer does not match',
    ],
  ])('rejects OIDC connector creation with %s', async (_label, input, discovery, message) => {
    const deps = {
      connectors: createRepository(),
      externalHttp: { fetch: vi.fn().mockResolvedValue(discovery) },
    } as unknown as Deps

    await expect(
      createConnector(deps, {
        providerType: 'generic_oauth',
        providerId: 'projects',
        displayName: 'Projects',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        ...input,
      }),
    ).rejects.toThrow(message)
  })

  it.each([
    ['client ID', { clientSecret: 'secret-1' }],
    ['client secret', { clientId: 'client-1' }],
  ])('requires a %s for manual OIDC registration', async (_label, credentials) => {
    const deps = {
      connectors: createRepository(),
      externalHttp: { fetch: vi.fn().mockResolvedValue(Response.json(discoveryMetadata())) },
    } as unknown as Deps

    await expect(
      createConnector(deps, {
        providerType: 'generic_oauth',
        providerId: 'projects',
        displayName: 'Projects',
        issuer: 'https://idp.example.com',
        registrationMode: 'manual',
        ...credentials,
      }),
    ).rejects.toThrow('Manual OIDC registration requires client credentials.')
  })

  it.each([
    [
      'without provider registration support',
      discoveryMetadata(),
      'https://auth.example.com',
      undefined,
      'OIDC provider does not support dynamic client registration.',
    ],
    [
      'without a callback origin',
      discoveryMetadata({ registration_endpoint: 'https://idp.example.com/register' }),
      undefined,
      undefined,
      'Dynamic OIDC registration requires the configured base URL.',
    ],
    [
      'when registration fails',
      discoveryMetadata({ registration_endpoint: 'https://idp.example.com/register' }),
      'https://auth.example.com',
      new Response(null, { status: 503 }),
      'Dynamic OIDC client registration failed.',
    ],
    [
      'when registration omits the client ID',
      discoveryMetadata({ registration_endpoint: 'https://idp.example.com/register' }),
      'https://auth.example.com',
      Response.json({ client_secret: 'secret-1' }),
      'Dynamic OIDC client registration response requires client_id.',
    ],
  ])('rejects dynamic OIDC registration %s', async (_label, discovery, callbackOrigin, registration, message) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(discovery))
    if (registration) fetch.mockResolvedValueOnce(registration)
    const deps = {
      connectors: createRepository(),
      externalHttp: { fetch },
    } as unknown as Deps

    await expect(
      createConnector(
        deps,
        {
          providerType: 'generic_oauth',
          providerId: 'projects',
          displayName: 'Projects',
          issuer: 'https://idp.example.com',
          registrationMode: 'dynamic',
        },
        callbackOrigin,
      ),
    ).rejects.toThrow(message)
  })

  it('stores optional OIDC discovery and dynamic registration metadata', async () => {
    const discovery = discoveryMetadata({
      registration_endpoint: 'https://idp.example.com/register',
      revocation_endpoint: 'https://idp.example.com/revoke',
    })
    const deps = {
      connectors: createRepository(),
      externalHttp: {
        fetch: vi
          .fn()
          .mockResolvedValueOnce(Response.json(discovery))
          .mockResolvedValueOnce(
            Response.json({
              client_id: 'registered-client',
              client_secret: 'registered-secret',
              registration_access_token: 'registration-token',
            }),
          ),
      },
    } as unknown as Deps

    await createConnector(
      deps,
      {
        providerType: 'generic_oauth',
        providerId: 'projects',
        displayName: 'Projects',
        issuer: 'https://idp.example.com',
        registrationMode: 'dynamic',
      },
      'https://auth.example.com/',
    )

    expect(deps.connectors.create).toHaveBeenCalledWith(
      expect.objectContaining({
        revocationEndpoint: 'https://idp.example.com/revoke',
        registrationAccessToken: 'registration-token',
      }),
    )
  })

  it('creates a manually registered OIDC connector from discovery metadata', async () => {
    const deps = {
      connectors: createRepository(),
      externalHttp: { fetch: vi.fn().mockResolvedValue(Response.json(discoveryMetadata())) },
    } as unknown as Deps

    await createConnector(deps, {
      providerType: 'generic_oauth',
      providerId: 'projects',
      displayName: 'Projects',
      issuer: 'https://idp.example.com',
      registrationMode: 'manual',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    })

    expect(deps.connectors.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        registrationMode: 'manual',
      }),
    )
  })

  it('surfaces missing connector CRUD records', async () => {
    const missing = { connectors: createRepository() } as unknown as Deps
    await expect(getConnector(missing, 'missing')).rejects.toThrow('Connector not found.')
    await expect(connectorReadiness(missing, 'missing')).rejects.toThrow('Connector not found.')
    await expect(updateConnector(missing, 'missing', { enabled: false })).rejects.toThrow('Connector not found.')
    await expect(deleteConnector(missing, 'missing')).rejects.toThrow('Connector not found.')

    const disappeared = {
      connectors: createRepository({ byId: connector(), updateResult: null }),
    } as unknown as Deps
    await expect(updateConnector(disappeared, 'idp_1', { enabled: false })).rejects.toThrow('Connector not found.')
  })

  it('keeps referenced connectors from being deleted', async () => {
    const deps = {
      connectors: createRepository({
        byId: connector(),
        resourceReferenceCount: 2,
      }),
    } as unknown as Deps

    await expect(deleteConnector(deps, 'idp_1')).rejects.toMatchObject({
      status: 409,
      details: { apiResources: 2 },
    })
    expect(deps.connectors.delete).not.toHaveBeenCalled()
  })

  it.each([
    ['client ID', { clientId: null }, 'Enabled connector requires clientId.'],
    ['issuer', { issuer: null }, 'Enabled OIDC connector requires issuer discovery.'],
    [
      'authorization endpoint',
      { authorizationEndpoint: null },
      'Enabled OIDC connector requires discovered authorization, token, and userinfo endpoints.',
    ],
    [
      'token endpoint',
      { tokenEndpoint: null },
      'Enabled OIDC connector requires discovered authorization, token, and userinfo endpoints.',
    ],
    [
      'userinfo endpoint',
      { userInfoEndpoint: null },
      'Enabled OIDC connector requires discovered authorization, token, and userinfo endpoints.',
    ],
  ])('rejects an enabled OIDC connector without its %s', async (_label, overrides, message) => {
    const current = connector({
      providerType: 'generic_oauth',
      providerId: 'projects',
      issuer: 'https://idp.example.com',
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
      ...overrides,
    })
    const deps = { connectors: createRepository({ byId: current }) } as unknown as Deps

    await expect(updateConnector(deps, current.id, {})).rejects.toThrow(message)
  })
})

function discoveryMetadata(overrides: Record<string, unknown> = {}) {
  return {
    issuer: 'https://idp.example.com',
    authorization_endpoint: 'https://idp.example.com/authorize',
    token_endpoint: 'https://idp.example.com/token',
    userinfo_endpoint: 'https://idp.example.com/userinfo',
    jwks_uri: 'https://idp.example.com/jwks',
    ...overrides,
  }
}

function createRepository(
  overrides: {
    enabled?: ConnectorRow[]
    byId?: ConnectorRow | null
    existingProvider?: ConnectorRow | null
    createResult?: ConnectorRow
    resourceReferenceCount?: number
    updateResult?: ConnectorRow | null
  } = {},
): ConnectorRepository {
  return {
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listEnabled: vi.fn().mockResolvedValue(overrides.enabled ?? []),
    findById: vi.fn().mockResolvedValue(overrides.byId ?? null),
    findByProviderId: vi.fn().mockResolvedValue(overrides.existingProvider ?? null),
    countResourceReferences: vi.fn().mockResolvedValue(overrides.resourceReferenceCount ?? 0),
    create: vi.fn().mockResolvedValue(overrides.createResult ?? connector()),
    update: vi.fn().mockResolvedValue(overrides.updateResult === undefined ? connector() : overrides.updateResult),
    delete: vi.fn(),
  }
}

function connector(overrides: Partial<ConnectorRow> = {}): ConnectorRow {
  const now = new Date('2026-05-18T00:00:00.000Z')
  return {
    id: 'idp_1',
    slug: overrides.providerId ?? 'google',
    providerType: 'social',
    providerId: 'google',
    displayName: 'Google',
    enabled: true,
    loginEnabled: true,
    clientId: 'client-id',
    clientSecret: 'GOOGLE_CLIENT_SECRET',
    clientSecretContext: null,
    issuer: null,
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    jwksEndpoint: null,
    registrationEndpoint: null,
    revocationEndpoint: null,
    registrationMode: null,
    registrationAccessToken: null,
    registrationAccessTokenContext: null,
    scopes: null,
    attributeMapping: null,
    providerMetadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
