import type { ConnectorRow } from '@server/adapters/repos/connectors'
import {
  connectorReadiness,
  createConnector,
  deleteConnector,
  getConnector,
  listConnectors,
  listConnectorTemplates,
  loadAuthConnectorConfig,
  updateConnector,
} from '@server/usecases/connectors'
import type { Deps } from '@server/usecases/deps'
import type { ConnectorRepository } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

describe('service.test 1', () => {
  it('returns connector templates without secret values', () => {
    expect(listConnectorTemplates().templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerType: 'social',
          providerId: 'google',
          icon: 'google',
          requiredFields: ['clientId', 'clientSecret'],
          endpoints: expect.objectContaining({ issuer: null }),
        }),
        expect.objectContaining({
          providerType: 'generic_oauth',
          providerId: 'generic-oauth',
          requiredFields: ['clientId', 'clientSecret', 'issuer or authorizationEndpoint + tokenEndpoint'],
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
            clientSecret: 'google-secret',
            scopes: ['openid', 'email', 'profile'],
            providerMetadata: { clientSecret: 'metadata-secret', redirectURI: 'https://auth.example.com/callback' },
          }),
          connector({
            providerType: 'generic_oauth',
            providerId: 'okta-main',
            clientSecret: 'okta-secret',
            issuer: 'https://idp.example.com/oauth2/default',
            scopes: ['openid', 'email'],
            providerMetadata: { pkce: true, requireIssuerValidation: true },
          }),
        ],
      }),
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

  it('omits enabled auth connectors when their stored client secret is missing', async () => {
    const config = await loadAuthConnectorConfig(
      createRepository({
        enabled: [
          connector({ providerId: 'github', clientSecret: null }),
          connector({ providerId: 'google', clientSecret: 'google-secret' }),
        ],
      }),
    )

    expect(config.trustedProviders).toEqual(['google'])
    expect(config.socialProviders).toHaveProperty('google')
    expect(config.socialProviders).not.toHaveProperty('github')
    expect(JSON.parse(config.cacheKey)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'idp_1', clientSecretConfigured: false }),
        expect.objectContaining({ id: 'idp_1', clientSecretConfigured: true }),
      ]),
    )
  })

  it('stores enabled connector writes with the supplied client secret', async () => {
    const repository = createRepository()
    const deps = { connectors: repository } as unknown as Deps

    await expect(
      createConnector(deps, {
        providerType: 'social',
        providerId: 'github',
        displayName: 'GitHub',
        clientId: 'review-client-id',
        clientSecret: 'review-secret',
      }),
    ).resolves.toMatchObject({ providerId: 'google', clientSecretConfigured: true })
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: 'review-secret' }))
  })

  it('allows disabling a connector without a stored client secret', async () => {
    const current = connector({
      id: 'idp_github',
      providerId: 'github',
      clientSecret: null,
    })
    const repository = createRepository({ byId: current, updateResult: { ...current, enabled: false } })
    const deps = { connectors: repository } as unknown as Deps

    await expect(updateConnector(deps, 'idp_github', { enabled: false })).resolves.toMatchObject({
      id: 'idp_github',
      enabled: false,
    })
    expect(repository.update).toHaveBeenCalledWith('idp_github', {
      enabled: false,
      updatedAt: expect.any(Date),
    })
  })

  it('rejects enabling a connector when its stored client secret is missing', async () => {
    const current = connector({
      id: 'idp_github',
      providerId: 'github',
      enabled: false,
      clientSecret: null,
    })
    const repository = createRepository({ byId: current })
    const deps = { connectors: repository } as unknown as Deps

    await expect(updateConnector(deps, 'idp_github', { enabled: true })).rejects.toMatchObject({
      status: 400,
      message: 'Enabled connector requires clientSecret.',
    })
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('rejects enabled Cognito writes missing required provider metadata', async () => {
    const repository = createRepository()
    const deps = { connectors: repository } as unknown as Deps

    await expect(
      createConnector(deps, {
        providerType: 'social',
        providerId: 'cognito',
        displayName: 'Cognito',
        clientId: 'client-id',
        clientSecret: 'cognito-secret',
        providerMetadata: { domain: 'auth.example.com', region: 'us-east-1' },
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Enabled Cognito connector requires providerMetadata.userPoolId.',
    })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('rejects enabled generic OAuth writes missing endpoint requirements', async () => {
    const repository = createRepository()
    const deps = { connectors: repository } as unknown as Deps

    await expect(
      createConnector(deps, {
        providerType: 'generic_oauth',
        providerId: 'missing-authorization',
        displayName: 'Missing authorization',
        clientId: 'client-id',
        clientSecret: 'generic-secret',
        tokenEndpoint: 'https://idp.example.com/token',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Enabled generic OAuth connector requires issuer or authorizationEndpoint.',
    })

    await expect(
      createConnector(deps, {
        providerType: 'generic_oauth',
        providerId: 'missing-token',
        displayName: 'Missing token',
        clientId: 'client-id',
        clientSecret: 'generic-secret',
        authorizationEndpoint: 'https://idp.example.com/authorize',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Enabled generic OAuth connector requires tokenEndpoint when issuer is not provided.',
    })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('rejects duplicate provider configuration before inserting', async () => {
    const existing = connector({ providerType: 'generic_oauth', providerId: 'github' })
    const repository = createRepository({ existingProvider: existing })
    const deps = { connectors: repository } as unknown as Deps

    await expect(
      createConnector(deps, {
        providerType: 'social',
        providerId: 'github',
        displayName: 'GitHub',
        clientId: 'client-id',
        clientSecret: 'GITHUB_CLIENT_SECRET',
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
    const deps = { connectors: repository } as unknown as Deps

    await expect(listConnectors(deps, { limit: 25, offset: 0 })).resolves.toMatchObject({
      connectors: [],
      pagination: { limit: 25, offset: 0, total: 0, hasMore: false, nextOffset: null },
    })
    await expect(
      createConnector(deps, {
        providerType: 'social',
        providerId: 'github',
        displayName: 'GitHub',
        clientId: 'client-id',
        clientSecret: 'github-secret',
        scopes: ['read:user'],
        providerMetadata: { prompt: 'consent' },
      }),
    ).resolves.toMatchObject({
      id: 'idp_github',
      providerId: 'github',
      scopes: [],
      providerMetadata: {},
    })
    await expect(getConnector(deps, 'idp_github')).resolves.toMatchObject({ id: 'idp_github' })
    await expect(updateConnector(deps, 'idp_github', { enabled: false })).resolves.toMatchObject({
      id: 'idp_github',
      enabled: false,
    })
    await expect(deleteConnector(deps, 'idp_github')).resolves.toBeUndefined()
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'github',
        slug: 'github',
        enabled: true,
        clientSecret: 'github-secret',
      }),
    )
    expect(repository.update).toHaveBeenCalledWith('idp_github', {
      enabled: false,
      updatedAt: expect.any(Date),
    })
    expect(repository.delete).toHaveBeenCalledWith('idp_github')
  })

  it('returns not found for missing connector reads, updates, and deletes', async () => {
    const deps = { connectors: createRepository() } as unknown as Deps

    await expect(getConnector(deps, 'missing')).rejects.toMatchObject({ status: 404, message: 'Connector not found.' })
    await expect(updateConnector(deps, 'missing', { enabled: false })).rejects.toMatchObject({
      status: 404,
      message: 'Connector not found.',
    })
    await expect(deleteConnector(deps, 'missing')).rejects.toMatchObject({
      status: 404,
      message: 'Connector not found.',
    })
  })

  it('validates update candidates before persisting enabled connectors', async () => {
    const current = connector({ id: 'idp_google', providerId: 'google' })
    const repository = createRepository({ byId: current })
    const deps = { connectors: repository } as unknown as Deps

    await expect(updateConnector(deps, 'idp_google', { clientSecret: null })).rejects.toMatchObject({
      status: 400,
      message: 'Enabled connector requires clientSecret.',
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
              clientSecret: 'cognito-secret',
              providerMetadata: { domain: 'auth.example.com', region: 'us-east-1' },
            }),
          ],
        }),
      ),
    ).resolves.toMatchObject({ trustedProviders: [], socialProviders: {} })
  })

  it('accepts disabled incomplete connectors and generic OAuth endpoint configuration', async () => {
    const disabled = connector({ enabled: false, clientId: null, clientSecret: null })
    const repository = createRepository({ createResult: disabled })
    const deps = { connectors: repository } as unknown as Deps
    const endpointConfigured = connector({
      providerType: 'generic_oauth',
      providerId: 'generic-oauth',
      issuer: null,
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
      clientSecret: 'GENERIC_CLIENT_SECRET',
      scopes: null,
    })
    await expect(
      createConnector(deps, {
        providerType: 'social',
        providerId: 'google',
        displayName: 'Google',
        enabled: false,
      }),
    ).resolves.toMatchObject({ enabled: false, clientId: null })
    const config = await loadAuthConnectorConfig(createRepository({ enabled: [endpointConfigured] }))

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
    const connectorRow = connector({ id: 'idp_google', providerId: 'google', clientSecret: 'GOOGLE_SECRET' })
    const deps = { connectors: createRepository({ byId: connectorRow }) } as unknown as Deps

    await expect(connectorReadiness(deps, 'idp_google')).resolves.toEqual({
      connectorId: 'idp_google',
      ready: true,
      checks: expect.arrayContaining([expect.objectContaining({ key: 'clientSecret', ok: true })]),
    })

    const disabledDeps = {
      connectors: createRepository({
        byId: connector({
          id: 'idp_disabled',
          enabled: false,
          clientId: null,
          clientSecret: null,
        }),
      }),
    } as unknown as Deps
    await expect(connectorReadiness(disabledDeps, 'idp_disabled')).resolves.toMatchObject({
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
      clientSecret: 'GENERIC_SECRET',
      issuer: 'https://idp.example.com',
      userInfoEndpoint: 'https://idp.example.com/userinfo',
    })
    const deps = { connectors: createRepository({ byId: connectorRow }) } as unknown as Deps

    await expect(connectorReadiness(deps, 'idp_generic')).resolves.toEqual({
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
    clientSecret: 'GOOGLE_CLIENT_SECRET',
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
