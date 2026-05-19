import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../shared/env'
import type { ConnectorRepository, ConnectorRow } from './repository'
import { ConnectorService, loadAuthConnectorConfig } from './service'

describe('ConnectorService', () => {
  it('returns connector templates without secret values', () => {
    const service = new ConnectorService(createRepository())

    expect(service.listTemplates().templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerType: 'social',
          providerId: 'google',
          icon: 'google',
          requiredFields: ['clientId', 'clientSecretBinding'],
          endpoints: expect.objectContaining({ issuer: null }),
        }),
        expect.objectContaining({
          providerType: 'generic_oauth',
          providerId: 'generic-oauth',
          requiredFields: ['clientId', 'clientSecretBinding', 'issuer or authorizationEndpoint + tokenEndpoint'],
        }),
      ]),
    )
  })

  it('maps enabled social and generic OAuth connectors into Better Auth config', async () => {
    const config = await loadAuthConnectorConfig(
      createRepository({
        enabled: [
          connector({
            providerType: 'social',
            providerId: 'google',
            clientSecretBinding: 'GOOGLE_CLIENT_SECRET',
            scopes: ['openid', 'email', 'profile'],
            providerMetadata: { clientSecret: 'metadata-secret', redirectURI: 'https://auth.example.com/callback' },
          }),
          connector({
            providerType: 'generic_oauth',
            providerId: 'okta-main',
            clientSecretBinding: 'OKTA_CLIENT_SECRET',
            issuer: 'https://idp.example.com/oauth2/default',
            scopes: ['openid', 'email'],
            providerMetadata: { pkce: true, requireIssuerValidation: true },
          }),
        ],
      }),
      {
        GOOGLE_CLIENT_SECRET: 'google-secret',
        OKTA_CLIENT_SECRET: 'okta-secret',
      } as unknown as Env,
    )

    expect(config.trustedProviders).toEqual(['google', 'okta-main'])
    expect(config.socialProviders.google).toMatchObject({
      clientId: 'client-id',
      clientSecret: 'google-secret',
      scope: ['openid', 'email', 'profile'],
      redirectURI: 'https://auth.example.com/callback',
    })
    expect(config.socialProviders.google?.clientSecret).not.toBe('metadata-secret')
    expect(config.genericOAuthProviders).toEqual([
      expect.objectContaining({
        providerId: 'okta-main',
        clientId: 'client-id',
        clientSecret: 'okta-secret',
        discoveryUrl: 'https://idp.example.com/oauth2/default/.well-known/openid-configuration',
        pkce: true,
        requireIssuerValidation: true,
      }),
    ])
  })

  it('omits enabled auth connectors when their runtime secret binding is unavailable', async () => {
    const config = await loadAuthConnectorConfig(
      createRepository({
        enabled: [
          connector({ providerId: 'github', clientSecretBinding: 'GITHUB_CLIENT_SECRET' }),
          connector({ providerId: 'google', clientSecretBinding: 'GOOGLE_CLIENT_SECRET' }),
        ],
      }),
      { GOOGLE_CLIENT_SECRET: 'google-secret' } as unknown as Env,
    )

    expect(config.trustedProviders).toEqual(['google'])
    expect(config.socialProviders).toHaveProperty('google')
    expect(config.socialProviders).not.toHaveProperty('github')
    expect(JSON.parse(config.cacheKey)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ secretBinding: 'GITHUB_CLIENT_SECRET', secretAvailable: false }),
        expect.objectContaining({ secretBinding: 'GOOGLE_CLIENT_SECRET', secretAvailable: true }),
      ]),
    )
  })

  it('rejects enabled connector writes when the runtime secret binding is unavailable', async () => {
    const repository = createRepository()
    const service = new ConnectorService(repository)

    await expect(
      service.create(
        {
          providerType: 'social',
          providerId: 'github',
          displayName: 'GitHub',
          clientId: 'review-client-id',
          clientSecretBinding: 'REVIEW_CLIENT_SECRET',
        },
        {} as Env,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'OAuth connector secret binding is not available in this runtime: REVIEW_CLIENT_SECRET.',
    })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('allows disabling a connector whose runtime secret binding is unavailable', async () => {
    const current = connector({
      id: 'idp_github',
      providerId: 'github',
      clientSecretBinding: 'REVIEW_CLIENT_SECRET',
    })
    const repository = createRepository({ byId: current, updateResult: { ...current, enabled: false } })
    const service = new ConnectorService(repository)

    await expect(service.update('idp_github', { enabled: false }, {} as Env)).resolves.toMatchObject({
      id: 'idp_github',
      enabled: false,
    })
    expect(repository.update).toHaveBeenCalledWith('idp_github', {
      enabled: false,
      updatedAt: expect.any(Date),
    })
  })

  it('rejects enabling a connector when its runtime secret binding is unavailable', async () => {
    const current = connector({
      id: 'idp_github',
      providerId: 'github',
      enabled: false,
      clientSecretBinding: 'REVIEW_CLIENT_SECRET',
    })
    const repository = createRepository({ byId: current })
    const service = new ConnectorService(repository)

    await expect(service.update('idp_github', { enabled: true }, {})).rejects.toMatchObject({
      status: 400,
      message: 'OAuth connector secret binding is not available in this runtime: REVIEW_CLIENT_SECRET.',
    })
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('rejects enabled Cognito writes missing required provider metadata', async () => {
    const repository = createRepository()
    const service = new ConnectorService(repository)

    await expect(
      service.create(
        {
          providerType: 'social',
          providerId: 'cognito',
          displayName: 'Cognito',
          clientId: 'client-id',
          clientSecretBinding: 'COGNITO_CLIENT_SECRET',
          providerMetadata: { domain: 'auth.example.com', region: 'us-east-1' },
        },
        { COGNITO_CLIENT_SECRET: 'secret' },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Enabled Cognito connector requires providerMetadata.userPoolId.',
    })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('rejects enabled generic OAuth writes missing endpoint requirements', async () => {
    const repository = createRepository()
    const service = new ConnectorService(repository)

    await expect(
      service.create(
        {
          providerType: 'generic_oauth',
          providerId: 'missing-authorization',
          displayName: 'Missing authorization',
          clientId: 'client-id',
          clientSecretBinding: 'GENERIC_CLIENT_SECRET',
          tokenEndpoint: 'https://idp.example.com/token',
        },
        { GENERIC_CLIENT_SECRET: 'secret' },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Enabled generic OAuth connector requires issuer or authorizationEndpoint.',
    })

    await expect(
      service.create(
        {
          providerType: 'generic_oauth',
          providerId: 'missing-token',
          displayName: 'Missing token',
          clientId: 'client-id',
          clientSecretBinding: 'GENERIC_CLIENT_SECRET',
          authorizationEndpoint: 'https://idp.example.com/authorize',
        },
        { GENERIC_CLIENT_SECRET: 'secret' },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Enabled generic OAuth connector requires tokenEndpoint when issuer is not provided.',
    })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('rejects duplicate provider configuration before inserting', async () => {
    const existing = connector({ providerType: 'generic_oauth', providerId: 'github' })
    const repository = createRepository({ existingProvider: existing })
    const service = new ConnectorService(repository)

    await expect(
      service.create({
        providerType: 'social',
        providerId: 'github',
        displayName: 'GitHub',
        clientId: 'client-id',
        clientSecretBinding: 'GITHUB_CLIENT_SECRET',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Connector provider is already configured.',
    })
    expect(repository.findByProviderId).toHaveBeenCalledWith('github')
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('lists, creates, gets, updates, and deletes connector records', async () => {
    const created = connector({ id: 'idp_github', providerId: 'github', slug: 'github', displayName: 'GitHub' })
    const repository = createRepository({
      byId: created,
      createResult: created,
      updateResult: { ...created, enabled: false },
    })
    const service = new ConnectorService(repository)

    await expect(service.list({ limit: 25, offset: 0 })).resolves.toMatchObject({
      connectors: [],
      pagination: { limit: 25, offset: 0, total: 0, hasMore: false, nextOffset: null },
    })
    await expect(
      service.create(
        {
          providerType: 'social',
          providerId: 'github',
          displayName: 'GitHub',
          clientId: 'client-id',
          clientSecretBinding: 'GITHUB_CLIENT_SECRET',
          scopes: ['read:user'],
          providerMetadata: { prompt: 'consent' },
        },
        { GITHUB_CLIENT_SECRET: 'github-secret' },
      ),
    ).resolves.toMatchObject({
      id: 'idp_github',
      providerId: 'github',
      scopes: [],
      providerMetadata: {},
    })
    await expect(service.get('idp_github')).resolves.toMatchObject({ id: 'idp_github' })
    await expect(service.update('idp_github', { enabled: false })).resolves.toMatchObject({
      id: 'idp_github',
      enabled: false,
    })
    await expect(service.delete('idp_github')).resolves.toBeUndefined()
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'github',
        slug: 'github',
        enabled: true,
        clientSecretBinding: 'GITHUB_CLIENT_SECRET',
      }),
    )
    expect(repository.update).toHaveBeenCalledWith('idp_github', {
      enabled: false,
      updatedAt: expect.any(Date),
    })
    expect(repository.delete).toHaveBeenCalledWith('idp_github')
  })

  it('returns not found for missing connector reads, updates, and deletes', async () => {
    const service = new ConnectorService(createRepository())

    await expect(service.get('missing')).rejects.toMatchObject({ status: 404, message: 'Connector not found.' })
    await expect(service.update('missing', { enabled: false })).rejects.toMatchObject({
      status: 404,
      message: 'Connector not found.',
    })
    await expect(service.delete('missing')).rejects.toMatchObject({ status: 404, message: 'Connector not found.' })
  })

  it('validates update candidates before persisting enabled connectors', async () => {
    const current = connector({ id: 'idp_google', providerId: 'google' })
    const repository = createRepository({ byId: current })
    const service = new ConnectorService(repository)

    await expect(service.update('idp_google', { clientSecretBinding: null })).rejects.toMatchObject({
      status: 400,
      message: 'Enabled connector requires clientSecretBinding.',
    })
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('omits Cognito social connectors missing required metadata from auth config', async () => {
    await expect(
      loadAuthConnectorConfig(
        createRepository({
          enabled: [
            connector({
              providerType: 'social',
              providerId: 'cognito',
              clientSecretBinding: 'COGNITO_CLIENT_SECRET',
              providerMetadata: { domain: 'auth.example.com', region: 'us-east-1' },
            }),
          ],
        }),
        { COGNITO_CLIENT_SECRET: 'secret' } as unknown as Env,
      ),
    ).resolves.toMatchObject({ trustedProviders: [], socialProviders: {} })
  })

  it('accepts disabled incomplete connectors and generic OAuth endpoint configuration', async () => {
    const disabled = connector({ enabled: false, clientId: null, clientSecretBinding: null })
    const repository = createRepository({ createResult: disabled })
    const service = new ConnectorService(repository)
    const endpointConfigured = connector({
      providerType: 'generic_oauth',
      providerId: 'generic-oauth',
      issuer: null,
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
      clientSecretBinding: 'GENERIC_CLIENT_SECRET',
      scopes: null,
    })
    await expect(
      service.create({
        providerType: 'social',
        providerId: 'google',
        displayName: 'Google',
        enabled: false,
      }),
    ).resolves.toMatchObject({ enabled: false, clientId: null })
    const config = await loadAuthConnectorConfig(createRepository({ enabled: [endpointConfigured] }), {
      GENERIC_CLIENT_SECRET: 'generic-secret',
    } as unknown as Env)

    expect(config.genericOAuthProviders).toEqual([
      expect.objectContaining({
        providerId: 'generic-oauth',
        authorizationUrl: 'https://idp.example.com/authorize',
        tokenUrl: 'https://idp.example.com/token',
        userInfoUrl: 'https://idp.example.com/userinfo',
      }),
    ])
  })

  it('reports configuration readiness without exposing secret values', async () => {
    const connectorRow = connector({ id: 'idp_google', providerId: 'google', clientSecretBinding: 'GOOGLE_SECRET' })
    const service = new ConnectorService(createRepository({ byId: connectorRow }))

    await expect(
      service.readiness('idp_google', { GOOGLE_SECRET: 'resolved-secret' } as unknown as Env),
    ).resolves.toEqual({
      connectorId: 'idp_google',
      ready: true,
      checks: expect.arrayContaining([expect.objectContaining({ key: 'clientSecretAvailable', ok: true })]),
    })
    await expect(service.readiness('idp_google', {} as Env)).resolves.toMatchObject({
      connectorId: 'idp_google',
      ready: false,
      checks: expect.arrayContaining([expect.objectContaining({ key: 'clientSecretAvailable', ok: false })]),
    })
    await expect(service.readiness('idp_google', { GOOGLE_SECRET: '' } as unknown as Env)).resolves.toMatchObject({
      connectorId: 'idp_google',
      ready: false,
      checks: expect.arrayContaining([expect.objectContaining({ key: 'clientSecretAvailable', ok: false })]),
    })

    const disabledService = new ConnectorService(
      createRepository({
        byId: connector({
          id: 'idp_disabled',
          enabled: false,
          clientId: null,
          clientSecretBinding: null,
        }),
      }),
    )
    await expect(disabledService.readiness('idp_disabled', {} as Env)).resolves.toMatchObject({
      connectorId: 'idp_disabled',
      ready: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'enabled',
          ok: false,
          message: 'Connector is disabled.',
        }),
        expect.objectContaining({
          key: 'clientId',
          ok: false,
          message: 'Client ID is missing.',
        }),
      ]),
    })
  })

  it('reports generic OAuth issuer mixed with explicit optional endpoints as not ready', async () => {
    const connectorRow = connector({
      id: 'idp_generic',
      providerType: 'generic_oauth',
      providerId: 'generic-oauth',
      clientSecretBinding: 'GENERIC_SECRET',
      issuer: 'https://idp.example.com',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
    })
    const service = new ConnectorService(createRepository({ byId: connectorRow }))

    await expect(
      service.readiness('idp_generic', { GENERIC_SECRET: 'resolved-secret' } as unknown as Env),
    ).resolves.toEqual({
      connectorId: 'idp_generic',
      ready: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'oauthEndpoints',
          ok: false,
          message: 'Use issuer discovery or explicit endpoints, not both.',
        }),
      ]),
    })
  })

  it('reports generic OAuth endpoint readiness modes', async () => {
    const service = new ConnectorService(
      createRepository({
        byId: connector({
          id: 'idp_generic',
          providerType: 'generic_oauth',
          providerId: 'generic-oauth',
          clientSecretBinding: null,
          issuer: 'https://idp.example.com',
        }),
      }),
    )

    await expect(service.readiness('idp_generic', {} as Env)).resolves.toEqual({
      connectorId: 'idp_generic',
      ready: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'clientSecretBinding',
          ok: false,
          message: 'Client secret binding name is missing.',
        }),
        expect.objectContaining({
          key: 'oauthEndpoints',
          ok: true,
          message: 'Issuer discovery is configured.',
        }),
      ]),
    })

    const explicitService = new ConnectorService(
      createRepository({
        byId: connector({
          id: 'idp_generic_explicit',
          providerType: 'generic_oauth',
          providerId: 'generic-oauth',
          clientSecretBinding: 'GENERIC_SECRET',
          issuer: null,
          authorizationEndpoint: 'https://idp.example.com/authorize',
          tokenEndpoint: 'https://idp.example.com/token',
        }),
      }),
    )
    await expect(
      explicitService.readiness('idp_generic_explicit', { GENERIC_SECRET: 'resolved-secret' } as unknown as Env),
    ).resolves.toEqual({
      connectorId: 'idp_generic_explicit',
      ready: true,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'oauthEndpoints',
          ok: true,
          message: 'Explicit authorization and token endpoints are configured.',
        }),
      ]),
    })

    const incompleteService = new ConnectorService(
      createRepository({
        byId: connector({
          id: 'idp_generic_incomplete',
          providerType: 'generic_oauth',
          providerId: 'generic-oauth',
          clientSecretBinding: 'GENERIC_SECRET',
          issuer: null,
          authorizationEndpoint: null,
          tokenEndpoint: null,
        }),
      }),
    )
    await expect(
      incompleteService.readiness('idp_generic_incomplete', { GENERIC_SECRET: 'resolved-secret' } as unknown as Env),
    ).resolves.toEqual({
      connectorId: 'idp_generic_incomplete',
      ready: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'oauthEndpoints',
          ok: false,
          message: 'Configure issuer discovery or explicit authorization and token endpoints.',
        }),
      ]),
    })
  })

  it('omits unsupported, incomplete, and unavailable enabled connector rows from auth config', async () => {
    const service = new ConnectorService(createRepository())

    await expect(
      service.create({
        providerType: 'social',
        providerId: 'unsupported',
        displayName: 'Unsupported',
        clientId: 'client-id',
        clientSecretBinding: 'UNSUPPORTED_SECRET',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Unsupported social provider.' })
    await expect(
      loadAuthConnectorConfig(createRepository({ enabled: [connector({ clientId: null })] }), {
        GOOGLE_CLIENT_SECRET: 'google-secret',
      } as unknown as Env),
    ).resolves.toMatchObject({ trustedProviders: [] })
    await expect(
      loadAuthConnectorConfig(createRepository({ enabled: [connector({ clientSecretBinding: null })] }), {
        GOOGLE_CLIENT_SECRET: 'google-secret',
      } as unknown as Env),
    ).resolves.toMatchObject({ trustedProviders: [] })
    await expect(
      loadAuthConnectorConfig(
        createRepository({ enabled: [connector({ clientSecretBinding: 'GOOGLE_CLIENT_SECRET' })] }),
        { GOOGLE_CLIENT_SECRET: '' } as unknown as Env,
      ),
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
              clientSecretBinding: 'GENERIC_CLIENT_SECRET',
            }),
          ],
        }),
        { GENERIC_CLIENT_SECRET: 'generic-secret' } as unknown as Env,
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
              clientSecretBinding: 'GENERIC_CLIENT_SECRET',
            }),
            connector({
              providerType: 'generic_oauth',
              providerId: 'mixed-generic',
              issuer: 'https://idp.example.com',
              authorizationEndpoint: 'https://idp.example.com/authorize',
              clientSecretBinding: 'GENERIC_CLIENT_SECRET',
            }),
          ],
        }),
        { GENERIC_CLIENT_SECRET: 'generic-secret' } as unknown as Env,
      ),
    ).resolves.toMatchObject({ genericOAuthProviders: [] })
    await expect(
      loadAuthConnectorConfig(
        createRepository({
          enabled: [
            connector({
              providerType: 'social',
              providerId: 'cognito',
              clientSecretBinding: 'COGNITO_CLIENT_SECRET',
              providerMetadata: { domain: 'auth.example.com', region: 'us-east-1' },
            }),
            connector({
              providerType: 'social',
              providerId: 'unsupported',
              clientSecretBinding: 'UNSUPPORTED_SECRET',
            }),
            connector({
              providerType: 'saml',
              providerId: 'google',
              clientSecretBinding: 'SAML_SECRET',
            } as Partial<ConnectorRow>),
          ],
        }),
        { COGNITO_CLIENT_SECRET: 'secret', UNSUPPORTED_SECRET: 'secret', SAML_SECRET: 'secret' } as unknown as Env,
      ),
    ).resolves.toMatchObject({ trustedProviders: [] })
    await expect(
      service.create({
        providerType: 'generic_oauth',
        providerId: 'mixed',
        displayName: 'Mixed',
        clientId: 'mixed-client',
        clientSecretBinding: 'MIXED_SECRET',
        issuer: 'https://idp.example.com',
        authorizationEndpoint: 'https://idp.example.com/authorize',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Enabled generic OAuth connector uses either issuer discovery or explicit endpoints, not both.',
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
    clientId: 'client-id',
    clientSecretBinding: 'GOOGLE_CLIENT_SECRET',
    issuer: null,
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    jwksEndpoint: null,
    scopes: null,
    attributeMapping: null,
    providerMetadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
