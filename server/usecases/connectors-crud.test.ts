import type { ConnectorRow } from '@server/adapters/repos/connectors'
import {
  connectorReadiness,
  createConnector,
  deleteConnector,
  ensureDynamicConnectorScopes,
  getConnector,
  loadAuthConnectorConfig,
  refreshDynamicConnectorMetadata,
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

  it('rejects missing and incomplete dynamic connector scope upgrades', async () => {
    const missing = { connectors: createRepository() } as unknown as Deps
    await expect(
      ensureDynamicConnectorScopes(missing, 'missing', ['projects:read'], 'https://auth.example.com'),
    ).rejects.toThrow('Connector not found.')

    const manual = dynamicConnector({ registrationMode: 'manual' })
    const manualDeps = { connectors: createRepository({ byId: manual }) } as unknown as Deps
    await expect(
      ensureDynamicConnectorScopes(manualDeps, manual.id, ['projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(1)

    const incomplete = dynamicConnector({ clientSecret: null })
    const incompleteDeps = { connectors: createRepository({ byId: incomplete }) } as unknown as Deps
    await expect(
      ensureDynamicConnectorScopes(incompleteDeps, incomplete.id, ['projects:read'], 'https://auth.example.com'),
    ).rejects.toThrow('Dynamic OIDC connector is incomplete.')
  })

  it.each([
    {
      name: 'an unadvertised requested scope',
      metadata: discoveryMetadata({ scopes_supported: ['openid'] }),
      message: 'does not advertise every requested scope',
    },
    {
      name: 'an incomplete authorization details catalog',
      metadata: discoveryMetadata({
        scopes_supported: ['projects:read'],
        authorization_details_catalog_endpoint: 'https://idp.example.com/authorization-details',
      }),
      message:
        'must advertise authorization_details_catalog_endpoint, authorization_details_catalog_scope, and authorization_details_catalog_version together',
    },
    {
      name: 'a whitespace-delimited authorization details catalog scope',
      metadata: discoveryMetadata({
        scopes_supported: ['projects:read'],
        authorization_details_catalog_endpoint: 'https://idp.example.com/authorization-details',
        authorization_details_catalog_scope: 'catalog read',
        authorization_details_catalog_version: 1,
      }),
      message: 'has invalid authorization_details_catalog_scope',
    },
    {
      name: 'an unsupported authorization details catalog version',
      metadata: discoveryMetadata({
        scopes_supported: ['projects:read'],
        authorization_details_catalog_endpoint: 'https://idp.example.com/authorization-details',
        authorization_details_catalog_scope: 'authorization-details:read',
        authorization_details_catalog_version: 2,
      }),
      message: 'advertises an unsupported authorization_details_catalog_version',
    },
    {
      name: 'an invalid authorization details type list',
      metadata: discoveryMetadata({
        scopes_supported: ['projects:read'],
        authorization_details_types_supported: [''],
      }),
      message: 'has invalid authorization_details_types_supported',
    },
  ])('rejects discovery metadata with $name', async ({ message, metadata }) => {
    const current = dynamicConnector()
    const deps = {
      connectors: createRepository({ byId: current }),
      externalHttp: { fetch: vi.fn().mockResolvedValue(Response.json(metadata)) },
    } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).rejects.toThrow(message)
  })

  it('falls back to OAuth discovery when OIDC discovery is unavailable', async () => {
    const current = dynamicConnector()
    const deps = {
      connectors: createRepository({ byId: current }),
      externalHttp: {
        fetch: vi
          .fn()
          .mockResolvedValueOnce(new Response(null, { status: 404 }))
          .mockResolvedValueOnce(Response.json(discoveryMetadata({ scopes_supported: ['openid'] }))),
      },
    } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).rejects.toThrow('does not advertise every requested scope')
    expect(deps.externalHttp.fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid dynamic registration update responses', async () => {
    const managed = dynamicConnector({
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
    })
    const managedDeps = {
      connectors: createRepository({ byId: managed }),
      externalHttp: {
        fetch: vi
          .fn()
          .mockResolvedValueOnce(Response.json(discoveryMetadata({ scopes_supported: ['openid', 'projects:read'] })))
          .mockResolvedValueOnce(
            Response.json({
              client_id: 'changed-client-id',
              scope: 'email offline_access openid profile projects:read',
            }),
          ),
      },
    } as unknown as Deps
    await expect(
      ensureDynamicConnectorScopes(managedDeps, managed.id, ['projects:read'], 'https://auth.example.com'),
    ).rejects.toThrow('changed the client identifier')

    const registered = dynamicConnector()
    const registeredDeps = {
      connectors: createRepository({ byId: registered }),
      externalHttp: {
        fetch: vi
          .fn()
          .mockResolvedValueOnce(Response.json(discoveryMetadata({ scopes_supported: ['openid', 'projects:read'] })))
          .mockResolvedValueOnce(
            Response.json({ client_id: 'client-id-2', client_secret: 'secret-2', scope: 'openid' }),
          ),
      },
    } as unknown as Deps
    await expect(
      ensureDynamicConnectorScopes(registeredDeps, registered.id, ['projects:read'], 'https://auth.example.com'),
    ).rejects.toThrow('omitted a requested scope')
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
          authorization_details_catalog_endpoint: 'https://idp.example.com/authorization-details',
          authorization_details_catalog_scope: 'authorization-details:read',
          authorization_details_catalog_version: 1,
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
      scope: 'authorization-details:read email offline_access openid profile',
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
      scopes_supported: ['openid', 'offline_access', 'projects:read', 'projects:write'],
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
              registration_client_uri: 'https://idp.example.com/register/registered-client',
              registration_access_token: 'registration-token',
              scope: 'openid profile email offline_access projects:read projects:write',
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
        registrationClientUri: 'https://idp.example.com/register/registered-client',
        registrationAccessToken: 'registration-token',
        registeredScopes: ['email', 'offline_access', 'openid', 'profile', 'projects:read', 'projects:write'],
      }),
    )
    const registrationRequest = vi.mocked(deps.externalHttp.fetch).mock.calls[1]![0] as Request
    const registrationBody = (await registrationRequest.json()) as { scope: string }
    expect(registrationBody.scope.split(' ')).toEqual([
      'email',
      'offline_access',
      'openid',
      'profile',
      'projects:read',
      'projects:write',
    ])
  })

  it('refreshes discovery metadata for an existing dynamic connector', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      providerId: 'projects',
      issuer: 'https://idp.example.com',
      registrationMode: 'dynamic',
    })
    const repository = createRepository({ byId: current })
    const discovery = discoveryMetadata({
      registration_endpoint: 'https://idp.example.com/register',
      revocation_endpoint: 'https://idp.example.com/revoke',
      authorization_details_catalog_endpoint: 'https://idp.example.com/authorization-details',
      authorization_details_catalog_scope: 'authorization-details:read',
      authorization_details_catalog_version: 1,
    })
    const deps = {
      connectors: repository,
      externalHttp: { fetch: vi.fn().mockResolvedValue(Response.json(discovery)) },
    } as unknown as Deps

    await refreshDynamicConnectorMetadata(deps, current.id)

    expect(repository.update).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        authorizationEndpoint: 'https://idp.example.com/authorize',
        tokenEndpoint: 'https://idp.example.com/token',
        userInfoEndpoint: 'https://idp.example.com/userinfo',
        jwksEndpoint: 'https://idp.example.com/jwks',
        registrationEndpoint: 'https://idp.example.com/register',
        revocationEndpoint: 'https://idp.example.com/revoke',
        providerMetadata: discovery,
      }),
    )
  })

  it('[spec: agent-identity/external-resource-dynamic-client-scope-upgrade] upgrades a dynamic client in place through RFC 7592', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      providerId: 'projects',
      displayName: 'Projects',
      issuer: 'https://idp.example.com',
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
      jwksEndpoint: 'https://idp.example.com/jwks',
      registrationEndpoint: 'https://idp.example.com/register',
      revocationEndpoint: 'https://idp.example.com/revoke',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['openid', 'offline_access'],
      scopes: ['openid'],
    })
    const repository = createRepository({ byId: current })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(discoveryMetadata({ scopes_supported: ['openid', 'offline_access', 'projects:read'] })),
      )
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'client-id',
          client_secret: 'rotated-secret',
          registration_client_uri: 'https://idp.example.com/register/client-id',
          registration_access_token: 'rotated-registration-token',
          scope: 'email offline_access openid profile projects:read',
        }),
      )
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['openid', 'projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(1)

    const managementRequest = fetch.mock.calls[1]![0] as Request
    expect(managementRequest.method).toBe('PUT')
    expect(managementRequest.headers.get('authorization')).toBe('Bearer registration-token')
    expect(repository.update).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        clientSecret: 'rotated-secret',
        registeredScopes: ['email', 'offline_access', 'openid', 'profile', 'projects:read'],
      }),
    )
    expect(repository.rotateClientGeneration).not.toHaveBeenCalled()
  })

  it('verifies cached dynamic client scopes against RFC 7592 state', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      providerId: 'projects',
      displayName: 'Projects',
      issuer: 'https://idp.example.com',
      registrationEndpoint: 'https://idp.example.com/register',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['openid', 'projects:read'],
    })
    const repository = createRepository({ byId: current })
    const fetch = vi.fn().mockResolvedValueOnce(
      Response.json({
        client_id: 'client-id',
        client_name: 'Realmroot Projects',
        redirect_uris: [
          'https://auth.example.com/api/auth/callback/projects',
          'https://auth.example.com/api/account-connections/oauth/callback',
        ],
        grant_types: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
          'urn:ietf:params:oauth:grant-type:token-exchange',
        ],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        jwks_uri: 'https://auth.example.com/api/auth/jwks',
        scope: 'openid projects:read',
      }),
    )
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(1)

    const readRequest = fetch.mock.calls[0]![0] as Request
    expect(readRequest.method).toBe('GET')
    expect(readRequest.headers.get('authorization')).toBe('Bearer registration-token')
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('repairs callback and JWKS metadata drift through RFC 7592', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      providerId: 'projects',
      displayName: 'Projects',
      issuer: 'https://idp.example.com',
      registrationEndpoint: 'https://idp.example.com/register',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['email', 'offline_access', 'openid', 'profile', 'projects:read'],
    })
    const repository = createRepository({ byId: current })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'client-id',
          client_name: 'Realmroot Projects',
          redirect_uris: [
            'https://old-auth.example.com/api/auth/callback/projects',
            'https://old-auth.example.com/api/account-connections/oauth/callback',
          ],
          grant_types: [
            'authorization_code',
            'refresh_token',
            'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'urn:ietf:params:oauth:grant-type:token-exchange',
          ],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_basic',
          jwks_uri: 'https://old-auth.example.com/api/auth/jwks',
          scope: 'email offline_access openid profile projects:read',
        }),
      )
      .mockResolvedValueOnce(Response.json(discoveryMetadata({ scopes_supported: ['openid', 'projects:read'] })))
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'client-id',
          scope: 'email offline_access openid profile projects:read',
        }),
      )
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(1)

    const updateRequest = fetch.mock.calls[2]![0] as Request
    expect(updateRequest.method).toBe('PUT')
    await expect(updateRequest.json()).resolves.toMatchObject({
      redirect_uris: [
        'https://auth.example.com/api/auth/callback/projects',
        'https://auth.example.com/api/account-connections/oauth/callback',
      ],
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
    })
    expect(repository.update).toHaveBeenCalledOnce()
    expect(repository.rotateClientGeneration).not.toHaveBeenCalled()
  })

  it.each([
    { registrationClientUri: null },
    { registrationAccessToken: null },
  ])('trusts cached scopes when RFC 7592 management credentials are incomplete', async (overrides) => {
    const current = connector({
      providerType: 'generic_oauth',
      issuer: 'https://idp.example.com',
      registrationEndpoint: 'https://idp.example.com/register',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['openid', 'projects:read'],
      ...overrides,
    })
    const repository = createRepository({ byId: current })
    const fetch = vi.fn()
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an RFC 7592 response for a different client', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      issuer: 'https://idp.example.com',
      registrationEndpoint: 'https://idp.example.com/register',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['openid', 'projects:read'],
    })
    const repository = createRepository({ byId: current })
    const fetch = vi.fn().mockResolvedValue(Response.json({ client_id: 'other-client', scope: 'projects:read' }))
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).rejects.toThrow('Dynamic OIDC registration management changed the client identifier.')
  })

  it('surfaces transient RFC 7592 reads without changing registration', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      issuer: 'https://idp.example.com',
      registrationEndpoint: 'https://idp.example.com/register',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['openid', 'projects:read'],
    })
    const repository = createRepository({ byId: current })
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).rejects.toThrow('Dynamic OIDC client registration read failed.')
    expect(repository.update).not.toHaveBeenCalled()
    expect(repository.rotateClientGeneration).not.toHaveBeenCalled()
  })

  it('repairs a cached dynamic client when RFC 7592 omits its scope field', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      issuer: 'https://idp.example.com',
      registrationEndpoint: 'https://idp.example.com/register',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['email', 'offline_access', 'openid', 'profile', 'projects:read'],
    })
    const repository = createRepository({ byId: current })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ client_id: 'client-id' }))
      .mockResolvedValueOnce(Response.json(discoveryMetadata({ scopes_supported: ['openid', 'projects:read'] })))
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'client-id',
          scope: 'email offline_access openid profile projects:read',
        }),
      )
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(1)
    expect(repository.update).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({ registeredScopes: ['email', 'offline_access', 'openid', 'profile', 'projects:read'] }),
    )
  })

  it('repairs cached scopes after a terminal RFC 7592 read response', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      issuer: 'https://idp.example.com',
      registrationEndpoint: 'https://idp.example.com/register',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['email', 'offline_access', 'openid', 'profile', 'projects:read'],
    })
    const repository = createRepository({ byId: current })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(discoveryMetadata({ scopes_supported: ['openid', 'projects:read'] })))
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'client-id',
          scope: 'email offline_access openid profile projects:read',
        }),
      )
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(1)
    expect(repository.update).toHaveBeenCalledOnce()
  })

  it('repairs provider-side dynamic client scope drift in place', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      issuer: 'https://idp.example.com',
      registrationEndpoint: 'https://idp.example.com/register',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['email', 'offline_access', 'openid', 'profile', 'projects:read'],
    })
    const repository = createRepository({ byId: current })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ client_id: 'client-id', scope: 'openid' }))
      .mockResolvedValueOnce(Response.json(discoveryMetadata({ scopes_supported: ['openid', 'projects:read'] })))
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'client-id',
          client_secret: 'rotated-secret',
          registration_client_uri: 'https://idp.example.com/register/client-id',
          registration_access_token: 'rotated-registration-token',
          scope: 'email offline_access openid profile projects:read',
        }),
      )
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(1)

    const updateRequest = fetch.mock.calls[2]![0] as Request
    expect(updateRequest.method).toBe('PUT')
    expect(repository.update).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        clientSecret: 'rotated-secret',
        registeredScopes: ['email', 'offline_access', 'openid', 'profile', 'projects:read'],
      }),
    )
    expect(repository.rotateClientGeneration).not.toHaveBeenCalled()
  })

  it('falls back to a new generation only when registration management is terminally unavailable', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      providerId: 'projects',
      displayName: 'Projects',
      issuer: 'https://idp.example.com',
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
      jwksEndpoint: 'https://idp.example.com/jwks',
      registrationEndpoint: 'https://idp.example.com/register',
      revocationEndpoint: 'https://idp.example.com/revoke',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'stale-token',
      registeredScopes: ['openid', 'offline_access'],
      clientGeneration: 1,
    })
    const repository = createRepository({ byId: current })
    vi.mocked(repository.rotateClientGeneration).mockResolvedValue(connector({ clientGeneration: 2 }))
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(discoveryMetadata({ scopes_supported: ['openid', 'offline_access', 'projects:read'] })),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'client-id-2',
          client_secret: 'secret-2',
          registration_client_uri: 'https://idp.example.com/register/client-id-2',
          registration_access_token: 'registration-token-2',
          scope: 'email offline_access openid profile projects:read',
        }),
      )
    const deps = {
      connectors: repository,
      externalHttp: { fetch },
      secrets: { seal: vi.fn(async (value: string, context: string) => `sealed:${context}:${value}`) },
    } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(2)
    expect(repository.rotateClientGeneration).toHaveBeenCalledWith(
      current.id,
      1,
      expect.objectContaining({
        clientId: 'client-id-2',
        clientGeneration: 2,
        retiredClientGenerations: [expect.objectContaining({ generation: 1, clientId: 'client-id' })],
      }),
    )
  })

  it('surfaces transient registration management failures without registering a replacement', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      providerId: 'projects',
      issuer: 'https://idp.example.com',
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
      jwksEndpoint: 'https://idp.example.com/jwks',
      registrationEndpoint: 'https://idp.example.com/register',
      revocationEndpoint: 'https://idp.example.com/revoke',
      registrationMode: 'dynamic',
      registrationClientUri: 'https://idp.example.com/register/client-id',
      registrationAccessToken: 'registration-token',
      registeredScopes: ['openid'],
    })
    const repository = createRepository({ byId: current })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(discoveryMetadata({ scopes_supported: ['openid', 'projects:read'] })))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const deps = { connectors: repository, externalHttp: { fetch } } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).rejects.toThrow('Dynamic OIDC client registration update failed.')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(repository.rotateClientGeneration).not.toHaveBeenCalled()
  })

  it('reloads a concurrent generation winner instead of overwriting it', async () => {
    const current = connector({
      providerType: 'generic_oauth',
      providerId: 'projects',
      issuer: 'https://idp.example.com',
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
      jwksEndpoint: 'https://idp.example.com/jwks',
      registrationEndpoint: 'https://idp.example.com/register',
      revocationEndpoint: 'https://idp.example.com/revoke',
      registrationMode: 'dynamic',
      registeredScopes: ['openid'],
      clientGeneration: 1,
    })
    const winner = connector({
      ...current,
      clientId: 'winner-client',
      registeredScopes: ['openid', 'projects:read'],
      clientGeneration: 2,
    })
    const repository = createRepository({ byId: current })
    vi.mocked(repository.findById).mockResolvedValueOnce(current).mockResolvedValueOnce(winner)
    vi.mocked(repository.rotateClientGeneration).mockResolvedValue(null)
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(discoveryMetadata({ scopes_supported: ['openid', 'projects:read'] })))
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'losing-client',
          client_secret: 'losing-secret',
          scope: 'email offline_access openid profile projects:read',
        }),
      )
    const deps = {
      connectors: repository,
      externalHttp: { fetch },
      secrets: { seal: vi.fn(async (value: string) => `sealed:${value}`) },
    } as unknown as Deps

    await expect(
      ensureDynamicConnectorScopes(deps, current.id, ['projects:read'], 'https://auth.example.com'),
    ).resolves.toBe(2)
    expect(repository.rotateClientGeneration).toHaveBeenCalledWith(current.id, 1, expect.any(Object))
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
    rotateClientGeneration: vi
      .fn()
      .mockResolvedValue(overrides.updateResult === undefined ? connector() : overrides.updateResult),
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
    registrationClientUri: null,
    registrationAccessToken: null,
    registrationAccessTokenContext: null,
    registeredScopes: null,
    clientGeneration: 1,
    retiredClientGenerations: null,
    scopes: null,
    attributeMapping: null,
    providerMetadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function dynamicConnector(overrides: Partial<ConnectorRow> = {}) {
  return connector({
    providerType: 'generic_oauth',
    providerId: 'projects',
    displayName: 'Projects',
    issuer: 'https://idp.example.com',
    authorizationEndpoint: 'https://idp.example.com/authorize',
    tokenEndpoint: 'https://idp.example.com/token',
    userInfoEndpoint: 'https://idp.example.com/userinfo',
    jwksEndpoint: 'https://idp.example.com/jwks',
    registrationEndpoint: 'https://idp.example.com/register',
    registrationMode: 'dynamic',
    registeredScopes: ['openid'],
    ...overrides,
  })
}
