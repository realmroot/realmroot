import {
  connectorResponseSchema,
  createConnectorRequestSchema,
  linkAccountRequestSchema,
  unlinkAccountQuerySchema,
  updateConnectorRequestSchema,
} from '@shared/api/connectors'
import { describe, expect, it } from 'vitest'

describe('Connector API schemas', () => {
  it('accepts disabled, social, discovered OAuth, explicit OAuth, and generic API inputs', () => {
    for (const input of [
      { providerType: 'social', providerId: 'google', displayName: 'Google', enabled: false },
      {
        providerType: 'social',
        providerId: 'google',
        displayName: 'Google',
        clientId: 'client',
        clientSecret: 'secret',
      },
      {
        providerType: 'generic_oauth',
        providerId: 'oauth',
        displayName: 'OAuth',
        clientId: 'client',
        clientSecret: 'secret',
        issuer: 'https://issuer.example.com',
      },
      {
        providerType: 'generic_oauth',
        providerId: 'oauth-explicit',
        displayName: 'OAuth explicit',
        clientId: 'client',
        clientSecret: 'secret',
        authorizationEndpoint: 'https://issuer.example.com/authorize',
        tokenEndpoint: 'https://issuer.example.com/token',
      },
      {
        providerType: 'generic_api',
        providerId: 'api',
        displayName: 'API',
        apiBaseUrl: 'https://api.example.com',
        credentialModes: ['header'],
        credentialHeaderName: 'X-API-Key',
        allowedMethods: ['GET'],
        allowedPathPrefixes: ['/v1'],
      },
    ]) {
      expect(createConnectorRequestSchema.safeParse(input).success).toBe(true)
    }
  })

  it('reports every provider-specific create boundary', () => {
    const invalid = [
      { providerType: 'social', providerId: 'google', displayName: 'Google', clientSecret: 'secret' },
      { providerType: 'social', providerId: 'google', displayName: 'Google', clientId: 'client' },
      { providerType: 'generic_api', providerId: 'api', displayName: 'API', credentialModes: ['bearer'] },
      {
        providerType: 'generic_api',
        providerId: 'api',
        displayName: 'API',
        apiBaseUrl: 'https://api.example.com',
      },
      {
        providerType: 'generic_api',
        providerId: 'api',
        displayName: 'API',
        apiBaseUrl: 'https://api.example.com',
        credentialModes: ['oauth'],
      },
      {
        providerType: 'generic_api',
        providerId: 'api',
        displayName: 'API',
        apiBaseUrl: 'https://api.example.com',
        credentialModes: ['header'],
      },
      {
        providerType: 'generic_oauth',
        providerId: 'oauth',
        displayName: 'OAuth',
        clientId: 'client',
        clientSecret: 'secret',
        issuer: 'https://issuer.example.com',
        authorizationEndpoint: 'https://issuer.example.com/authorize',
      },
      {
        providerType: 'generic_oauth',
        providerId: 'oauth',
        displayName: 'OAuth',
        clientId: 'client',
        clientSecret: 'secret',
      },
      {
        providerType: 'generic_oauth',
        providerId: 'oauth',
        displayName: 'OAuth',
        clientId: 'client',
        clientSecret: 'secret',
        authorizationEndpoint: 'https://issuer.example.com/authorize',
      },
    ]
    for (const input of invalid) expect(createConnectorRequestSchema.safeParse(input).success).toBe(false)
  })

  it('parses response, update, linking, and unlinking contracts', () => {
    const now = new Date().toISOString()
    expect(
      connectorResponseSchema.parse({
        id: 'connector-1',
        slug: 'connector',
        providerType: 'generic_api',
        providerId: 'api',
        displayName: 'API',
        enabled: true,
        clientId: null,
        clientSecretConfigured: false,
        issuer: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
        scopes: [],
        apiBaseUrl: 'https://api.example.com',
        credentialModes: ['bearer'],
        credentialHeaderName: null,
        allowedMethods: ['GET'],
        allowedPathPrefixes: ['/'],
        providerMetadata: {},
        createdAt: now,
        updatedAt: now,
      }),
    ).toMatchObject({ id: 'connector-1' })
    expect(updateConnectorRequestSchema.parse({ enabled: false, clientSecret: null })).toEqual({
      enabled: false,
      clientSecret: null,
    })
    expect(
      linkAccountRequestSchema.parse({
        providerType: 'social',
        providerId: 'google',
        callbackURL: '/callback',
      }),
    ).toMatchObject({ providerId: 'google' })
    expect(unlinkAccountQuerySchema.parse({})).toEqual({})
    expect(unlinkAccountQuerySchema.parse({ accountId: 'account-1' })).toEqual({ accountId: 'account-1' })
  })
})
