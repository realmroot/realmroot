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
          requiredFields: ['clientId', 'clientSecretBinding'],
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

  it('fails fast when an enabled connector references a missing Cloudflare secret binding', async () => {
    await expect(
      loadAuthConnectorConfig(
        createRepository({
          enabled: [connector({ providerId: 'github', clientSecretBinding: 'GITHUB_CLIENT_SECRET' })],
        }),
        {} as Env,
      ),
    ).rejects.toThrow('OAuth connector secret binding is not configured: GITHUB_CLIENT_SECRET')
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

  it('requires Cognito social metadata before auth config generation', async () => {
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
    ).rejects.toMatchObject({
      status: 400,
      message: 'Enabled Cognito connector requires providerMetadata.userPoolId.',
    })
  })
})

function createRepository(
  overrides: { enabled?: ConnectorRow[]; byId?: ConnectorRow | null; existingProvider?: ConnectorRow | null } = {},
): ConnectorRepository {
  return {
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listEnabled: vi.fn().mockResolvedValue(overrides.enabled ?? []),
    findById: vi.fn().mockResolvedValue(overrides.byId ?? null),
    findByProviderId: vi.fn().mockResolvedValue(overrides.existingProvider ?? null),
    create: vi.fn(),
    update: vi.fn(),
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
