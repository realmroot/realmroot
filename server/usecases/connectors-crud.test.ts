import type { ConnectorRow } from '@server/adapters/repos/connectors'
import { connectorReadiness, createConnector, loadAuthConnectorConfig } from '@server/usecases/connectors'
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

  it('uses canonical callbacks for dynamic OIDC registration [spec: agent-identity/external-api-resource-canonical-callback]', async () => {
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
    })
  })
})

function createRepository(
  overrides: {
    enabled?: ConnectorRow[]
    byId?: ConnectorRow | null
    existingProvider?: ConnectorRow | null
    createResult?: ConnectorRow
    updateResult?: ConnectorRow | null
  } = {},
): ConnectorRepository {
  return {
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listEnabled: vi.fn().mockResolvedValue(overrides.enabled ?? []),
    findById: vi.fn().mockResolvedValue(overrides.byId ?? null),
    findByProviderId: vi.fn().mockResolvedValue(overrides.existingProvider ?? null),
    countResourceReferences: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue(overrides.createResult ?? connector()),
    update: vi.fn().mockResolvedValue(overrides.updateResult ?? connector()),
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
