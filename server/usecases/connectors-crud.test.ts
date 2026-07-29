import type { ConnectorRow } from '@server/adapters/repos/connectors'
import { connectorReadiness, createConnector, loadAuthConnectorConfig } from '@server/usecases/connectors'
import type { Deps } from '@server/usecases/deps'
import type { ConnectorRepository } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

describe('service.test 2', () => {
  it('reports generic OAuth endpoint readiness modes', async () => {
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
          ok: true,
          message: 'Issuer discovery is configured.',
        }),
      ]),
    })

    const explicitDeps = {
      connectors: createRepository({
        byId: connector({
          id: 'idp_generic_explicit',
          providerType: 'generic_oauth',
          providerId: 'generic-oauth',
          clientSecret: 'GENERIC_SECRET',
          issuer: null,
          authorizationEndpoint: 'https://idp.example.com/authorize',
          tokenEndpoint: 'https://idp.example.com/token',
        }),
      }),
    } as unknown as Deps
    await expect(connectorReadiness(explicitDeps, 'idp_generic_explicit')).resolves.toEqual({
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
          message: 'Configure issuer discovery or explicit authorization and token endpoints.',
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
    await expect(
      createConnector(deps, {
        providerType: 'generic_oauth',
        providerId: 'mixed',
        displayName: 'Mixed',
        clientId: 'mixed-client',
        clientSecret: 'MIXED_SECRET',
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
