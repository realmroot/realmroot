import {
  createConnectorRequestSchema,
  linkAccountRequestSchema,
  unlinkAccountQuerySchema,
  updateConnectorRequestSchema,
} from '@shared/api/connectors'
import { describe, expect, it } from 'vitest'

describe('connector API contracts', () => {
  it('requires connector secrets for social and generic OAuth providers', () => {
    expect(
      createConnectorRequestSchema.parse({
        providerType: 'social',
        providerId: 'google',
        displayName: 'Google',
        clientId: 'google-client-id',
        clientSecret: 'GOOGLE_CLIENT_SECRET',
      }),
    ).toMatchObject({
      providerType: 'social',
      providerId: 'google',
      displayName: 'Google',
    })

    expect(() =>
      createConnectorRequestSchema.parse({
        providerType: 'social',
        providerId: 'google',
        displayName: 'Google',
        clientId: 'google-client-id',
      }),
    ).toThrow(/clientSecret is required/)

    expect(
      createConnectorRequestSchema.parse({
        providerType: 'social',
        providerId: 'google',
        displayName: 'Google',
        enabled: false,
      }),
    ).toMatchObject({
      providerType: 'social',
      enabled: false,
    })
  })

  it('requires generic OAuth discovery or explicit endpoints', () => {
    expect(
      createConnectorRequestSchema.parse({
        providerType: 'generic_oauth',
        providerId: 'okta-main',
        displayName: 'Okta',
        clientId: 'okta-client-id',
        clientSecret: 'OKTA_CLIENT_SECRET',
        issuer: 'https://idp.example.com/oauth2/default',
      }),
    ).toMatchObject({
      providerType: 'generic_oauth',
      providerId: 'okta-main',
      issuer: 'https://idp.example.com/oauth2/default',
    })

    expect(
      createConnectorRequestSchema.parse({
        providerType: 'generic_oauth',
        providerId: 'entra-main',
        displayName: 'Microsoft Entra ID',
        clientId: 'entra-client-id',
        clientSecret: 'ENTRA_CLIENT_SECRET',
        authorizationEndpoint: 'https://login.example.com/oauth2/v2.0/authorize',
        tokenEndpoint: 'https://login.example.com/oauth2/v2.0/token',
      }),
    ).toMatchObject({
      providerId: 'entra-main',
      authorizationEndpoint: 'https://login.example.com/oauth2/v2.0/authorize',
      tokenEndpoint: 'https://login.example.com/oauth2/v2.0/token',
    })

    expect(() =>
      createConnectorRequestSchema.parse({
        providerType: 'generic_oauth',
        providerId: 'broken-main',
        displayName: 'Broken',
        clientId: 'broken-client-id',
        clientSecret: 'BROKEN_CLIENT_SECRET',
      }),
    ).toThrow(/Generic OAuth requires issuer or authorizationEndpoint/)

    expect(() =>
      createConnectorRequestSchema.parse({
        providerType: 'generic_oauth',
        providerId: 'mixed-main',
        displayName: 'Mixed',
        clientId: 'mixed-client-id',
        clientSecret: 'MIXED_CLIENT_SECRET',
        issuer: 'https://idp.example.com',
        authorizationEndpoint: 'https://idp.example.com/oauth2/v1/authorize',
      }),
    ).toThrow(/either issuer discovery or explicit endpoints/)

    expect(() =>
      createConnectorRequestSchema.parse({
        providerType: 'generic_oauth',
        providerId: 'half-configured-main',
        displayName: 'Half Configured',
        clientId: 'half-client-id',
        clientSecret: 'HALF_CLIENT_SECRET',
        authorizationEndpoint: 'https://login.example.com/oauth2/v2.0/authorize',
      }),
    ).toThrow(/Generic OAuth requires tokenEndpoint when issuer is not provided/)
  })

  it('allows nullable connector updates without defaulting omitted scopes', () => {
    const parsed = updateConnectorRequestSchema.parse({
      clientId: null,
      clientSecret: null,
      issuer: null,
      authorizationEndpoint: null,
      tokenEndpoint: null,
    })

    expect(parsed).toMatchObject({
      clientId: null,
      clientSecret: null,
      issuer: null,
      authorizationEndpoint: null,
      tokenEndpoint: null,
    })
    expect(parsed).not.toHaveProperty('scopes')
  })

  it('validates linked-account request and unlink query boundaries', () => {
    expect(
      linkAccountRequestSchema.parse({
        providerType: 'social',
        providerId: 'google',
        callbackURL: '/account/linked-accounts',
        scopes: ['openid', 'email'],
      }),
    ).toEqual({
      providerType: 'social',
      providerId: 'google',
      callbackURL: '/account/linked-accounts',
      scopes: ['openid', 'email'],
    })

    expect(() =>
      linkAccountRequestSchema.parse({
        providerType: 'social',
        providerId: 'google',
        callbackURL: '   ',
      }),
    ).toThrow()

    expect(unlinkAccountQuerySchema.parse({})).toEqual({})
    expect(unlinkAccountQuerySchema.parse({ accountId: 'google-account-1' })).toEqual({
      accountId: 'google-account-1',
    })
    expect(() => unlinkAccountQuerySchema.parse({ accountId: '' })).toThrow()
  })
})
