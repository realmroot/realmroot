import {
  applicationResourceScopesSchema,
  createApplicationRequestSchema,
  createApplicationResponseSchema,
  deviceCodeGrantType,
  listApplicationsResponseSchema,
  listClientSecretsResponseSchema,
  listRedirectUrisResponseSchema,
  paginationQuerySchema,
  updateApplicationRequestSchema,
} from '@shared/api/applications'
import { describe, expect, it } from 'vitest'

describe('application Resource Server scope contracts', () => {
  it('normalizes each resource-qualified scope allowlist', () => {
    expect(
      applicationResourceScopesSchema.parse([
        { resourceServerId: 'res_orders', scopes: ['orders:write', 'orders:read', 'orders:read'] },
      ]),
    ).toEqual([{ resourceServerId: 'res_orders', scopes: ['orders:read', 'orders:write'] }])
  })

  it('bounds Resource Server allowlists at the HTTP boundary [spec: admin-console/admin-create-application]', () => {
    expect(
      applicationResourceScopesSchema.safeParse(
        Array.from({ length: 101 }, (_, index) => ({
          resourceServerId: `resource-${index}`,
          scopes: ['resource:read'],
        })),
      ).success,
    ).toBe(false)
    expect(
      applicationResourceScopesSchema.safeParse([
        {
          resourceServerId: 'resource-1',
          scopes: Array.from({ length: 383 }, (_, index) => `scope:${index}`),
        },
      ]).success,
    ).toBe(true)
    expect(
      applicationResourceScopesSchema.safeParse([
        {
          resourceServerId: 'resource-1',
          scopes: Array.from({ length: 1_001 }, (_, index) => `scope:${index}`),
        },
      ]).success,
    ).toBe(false)
  })
})

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

    expect(listApplicationsResponseSchema.parse({ items: [], pagination })).toEqual({
      items: [],
      pagination,
    })
    expect(listClientSecretsResponseSchema.parse({ items: [], pagination })).toEqual({ items: [], pagination })
    expect(listRedirectUrisResponseSchema.parse({ items: [], pagination })).toEqual({
      items: [],
      pagination,
    })
    expect(() => listApplicationsResponseSchema.parse({ items: [] })).toThrow()
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
      consentRequired: true,
      disabled: false,
      disabledReason: null,
      redirectUris: ['https://app.example.com/callback'],
      postLogoutRedirectUris: ['https://app.example.com/signed-out'],
      corsOrigins: ['https://app.example.com'],
      customData: { tier: 'gold' },
      ownerOrganizationId: 'org_platform',
      allowedGrantTypes: ['authorization_code'],
      oidcScopes: ['openid', 'profile'],
      resourceScopes: [],
      requirePkce: false,
      tokenEndpointAuthMethod: 'client_secret_basic',
      secretMetadata: [],
      oidc: {
        issuer: 'https://auth.example.com/api/auth',
        authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
        tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
        jwksUri: 'https://auth.example.com/api/auth/jwks',
        userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
        endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      clientSecret: 'fas_secret',
    }

    expect(createApplicationResponseSchema.parse(response).clientSecret).toBe('fas_secret')
    expect(() => listApplicationsResponseSchema.parse({ items: [response], pagination: pagination(1) })).toThrow()
  })

  it('accepts all four Application types without caller-controlled protocol settings', () => {
    for (const [clientType, redirectUris] of [
      ['confidential_web', ['https://web.example.com/callback']],
      ['public_spa', ['https://spa.example.com/callback']],
      ['public_native', ['com.example.native:/callback']],
      ['machine', []],
    ] as const) {
      expect(
        createApplicationRequestSchema.parse({
          name: `${clientType} app`,
          ownerOrganizationId: 'org-1',
          clientType,
          redirectUris,
        }),
      ).toMatchObject({ clientType, redirectUris })
    }
  })

  it('requires redirects for interactive Applications and rejects them for machine Applications', () => {
    const base = { name: 'Application', ownerOrganizationId: 'org-1' }
    expect(
      createApplicationRequestSchema.safeParse({ ...base, clientType: 'confidential_web', redirectUris: [] }).success,
    ).toBe(false)
    expect(createApplicationRequestSchema.safeParse({ ...base, clientType: 'machine', redirectUris: [] }).success).toBe(
      true,
    )
    expect(
      createApplicationRequestSchema.safeParse({
        ...base,
        clientType: 'machine',
        redirectUris: ['https://app.example.com/callback'],
      }).success,
    ).toBe(false)
  })

  it('keeps Realmroot resource capabilities out of user-configurable application requests', () => {
    expect(() =>
      createApplicationRequestSchema.parse({
        name: 'Customer app',
        clientType: 'public_spa',
        redirectUris: ['http://localhost:5173/callback'],
        oidcScopes: ['openid', 'applications:read'],
      }),
    ).toThrow()
    expect(() =>
      updateApplicationRequestSchema.parse({
        oidcScopes: ['openid', 'applications:write'],
      }),
    ).toThrow()
  })

  it('rejects caller-controlled grants, OIDC scopes, and the discarded applicationType field', () => {
    const base = {
      name: 'Customer app',
      ownerOrganizationId: 'org-1',
      clientType: 'public_spa',
      redirectUris: ['http://localhost:5173/callback'],
    }
    expect(() => createApplicationRequestSchema.parse({ ...base, allowedGrantTypes: [deviceCodeGrantType] })).toThrow()
    expect(() => createApplicationRequestSchema.parse({ ...base, oidcScopes: ['openid'] })).toThrow()
    expect(() =>
      createApplicationRequestSchema.parse({
        name: 'Legacy app',
        ownerOrganizationId: 'org-1',
        applicationType: 'public_spa',
        redirectUris: ['http://localhost:5173/callback'],
      }),
    ).toThrow()
  })

  it('accepts optional device login only for public native Applications', () => {
    const base = {
      name: 'Native app',
      ownerOrganizationId: 'org-1',
      redirectUris: ['com.example.native:/callback'],
      deviceLoginEnabled: true,
    }
    expect(createApplicationRequestSchema.parse({ ...base, clientType: 'public_native' })).toMatchObject({
      deviceLoginEnabled: true,
    })
    expect(createApplicationRequestSchema.safeParse({ ...base, clientType: 'public_spa' }).success).toBe(false)
  })

  it('accepts setup-time redirect lists and rejects caller-provided credentials', () => {
    const request = createApplicationRequestSchema.parse({
      name: 'Customer app',
      ownerOrganizationId: 'org-1',
      clientType: 'public_spa',
      redirectUris: ['http://localhost:5173/callback'],
      postLogoutRedirectUris: ['http://localhost:5173/signed-out'],
      corsOrigins: ['http://localhost:5173'],
    })

    expect(request).toEqual({
      name: 'Customer app',
      clientType: 'public_spa',
      redirectUris: ['http://localhost:5173/callback'],
      postLogoutRedirectUris: ['http://localhost:5173/signed-out'],
      corsOrigins: ['http://localhost:5173'],
      ownerOrganizationId: 'org-1',
    })
    expect(() =>
      createApplicationRequestSchema.parse({
        name: 'Customer app',
        ownerOrganizationId: 'org-1',
        clientType: 'public_spa',
        redirectUris: ['http://localhost:5173/callback'],
        clientId: 'caller-client',
        clientSecret: 'caller-secret',
      }),
    ).toThrow()
  })

  it('accepts valid retired OIDC claim configuration only as compatibility input', () => {
    expect(
      createApplicationRequestSchema.parse({
        name: 'Customer app',
        ownerOrganizationId: 'org-1',
        clientType: 'public_spa',
        redirectUris: ['http://localhost:5173/callback'],
        oidcClaims: {
          accessToken: { authorization: true, scopes: true },
          idToken: { organizationId: true, organizationName: true },
          userInfo: { roles: true, groups: true },
        },
      }),
    ).toHaveProperty('oidcClaims')
    expect(() =>
      updateApplicationRequestSchema.parse({
        oidcClaims: {
          accessToken: { unknownClaim: true },
          idToken: {},
          userInfo: {},
        },
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
