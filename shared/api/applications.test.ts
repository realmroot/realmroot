import { describe, expect, it } from 'vitest'
import {
  createApplicationRequestSchema,
  createApplicationResponseSchema,
  listApplicationsResponseSchema,
  listClientSecretsResponseSchema,
  listRedirectUrisResponseSchema,
  paginationQuerySchema,
  updateApplicationRequestSchema,
} from './applications'

describe('application API pagination contracts', () => {
  it('parses pagination query defaults and numeric query strings', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 })
    expect(paginationQuerySchema.parse({ limit: '25', offset: '50' })).toEqual({ limit: 25, offset: 50 })
    expect(() => paginationQuerySchema.parse({ limit: '101' })).toThrow()
    expect(() => paginationQuerySchema.parse({ offset: '-1' })).toThrow()
  })

  it('requires collection responses to include pagination metadata', () => {
    const pagination = {
      limit: 10,
      offset: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
    }

    expect(listApplicationsResponseSchema.parse({ applications: [], pagination })).toEqual({
      applications: [],
      pagination,
    })
    expect(listClientSecretsResponseSchema.parse({ secrets: [], pagination })).toEqual({ secrets: [], pagination })
    expect(listRedirectUrisResponseSchema.parse({ redirectUris: [], pagination })).toEqual({
      redirectUris: [],
      pagination,
    })
    expect(() => listApplicationsResponseSchema.parse({ applications: [] })).toThrow()
  })

  it('makes one-time client secret material explicit in create responses only', () => {
    const response = {
      id: 'app-1',
      slug: 'customer-portal',
      name: 'Customer portal',
      description: null,
      homepageUrl: null,
      iconUrl: null,
      clientId: 'client-1',
      clientType: 'confidential_web',
      public: false,
      firstParty: false,
      trusted: false,
      systemManaged: false,
      disabled: false,
      disabledReason: null,
      redirectUris: ['https://app.example.com/callback'],
      postLogoutRedirectUris: ['https://app.example.com/signed-out'],
      corsOrigins: ['https://app.example.com'],
      customData: { tier: 'gold' },
      allowedGrantTypes: ['authorization_code'],
      allowedScopes: ['openid', 'profile'],
      requirePkce: false,
      tokenEndpointAuthMethod: 'client_secret_basic',
      secretMetadata: [],
      oidc: {
        issuer: 'https://auth.example.com/api/auth',
        authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
        tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
        jwksUri: 'https://auth.example.com/api/auth/jwks',
        userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
        endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      clientSecret: 'fas_secret',
    }

    expect(createApplicationResponseSchema.parse(response).clientSecret).toBe('fas_secret')
    expect(() =>
      listApplicationsResponseSchema.parse({ applications: [response], pagination: pagination(1) }),
    ).toThrow()
  })

  it('keeps management scopes out of user-configurable application requests', () => {
    expect(() =>
      createApplicationRequestSchema.parse({
        name: 'Customer app',
        clientType: 'public_spa',
        redirectUris: ['http://localhost:5173/callback'],
        allowedScopes: ['openid', 'management:read'],
      }),
    ).toThrow()
    expect(() =>
      updateApplicationRequestSchema.parse({
        allowedScopes: ['openid', 'management:write'],
      }),
    ).toThrow()
  })
})

function pagination(total: number) {
  return {
    limit: 10,
    offset: 0,
    total,
    hasMore: false,
    nextOffset: null,
  }
}
