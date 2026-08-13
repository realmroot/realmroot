import type { ConnectorRow } from '@server/adapters/repos/connectors'
import type { Deps } from '@server/usecases/deps'
import {
  validateConnectorBackedNativeResource,
  validateExternalResourceConnector,
} from '@server/usecases/resource-connectors'
import { describe, expect, it, vi } from 'vitest'

const resourceUrl = 'https://api.example.com/v1?tenant=acme'
const issuer = 'https://idp.example.com'
const jwtBearerGrant = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
const tokenExchangeGrant = 'urn:ietf:params:oauth:grant-type:token-exchange'

describe('external resource connector validation', () => {
  it('[spec: agent-identity/linear-managed-workspace-connections] accepts Linear as a managed resource OAuth driver', async () => {
    const deps = createDeps({
      connector: connector({
        providerType: 'social',
        providerId: 'linear',
        issuer: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
        revocationEndpoint: null,
        scopes: ['read', 'issues:create'],
      }),
    })

    await expect(
      validateConnectorBackedNativeResource(deps, 'connector-1', ['read', 'issues:create']),
    ).resolves.toBeUndefined()
  })

  it('accepts a complete OIDC connector and preserves the resource path in metadata discovery', async () => {
    const deps = createDeps()

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).resolves.toMatchObject({
      resource: resourceUrl,
      scopesSupported: ['projects:read'],
    })

    expect(deps.externalHttp.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/.well-known/oauth-protected-resource/v1?tenant=acme',
      }),
    )
  })

  it.each([
    ['missing', null],
    ['non-OIDC', connector({ providerType: 'social' })],
  ])('rejects a %s connector', async (_label, value) => {
    const deps = createDeps({ connector: value })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 404,
      message: 'OIDC connector was not found.',
    })
  })

  it.each([
    ['disabled', { enabled: false }],
    ['client ID', { clientId: null }],
    ['client secret', { clientSecret: null }],
    ['issuer', { issuer: null }],
  ])('rejects a connector without complete %s configuration', async (_label, overrides) => {
    const deps = createDeps({ connector: connector(overrides) })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 400,
      message: 'OIDC connector must be enabled and have complete client credentials.',
    })
  })

  it.each([
    'authorizationEndpoint',
    'tokenEndpoint',
    'userInfoEndpoint',
    'jwksEndpoint',
    'revocationEndpoint',
  ] as const)('rejects a connector without %s', async (field) => {
    const deps = createDeps({ connector: connector({ [field]: null }) })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 400,
      message: 'OIDC connector is missing endpoints required for external API access.',
    })
  })

  it.each([
    ['a failed response', undefined, 503],
    ['invalid JSON', 'invalid-json', 200],
    ['a JSON array', [], 200],
    ['a primitive JSON value', 42, 200],
  ])('rejects protected resource metadata with %s', async (_label, metadata, status) => {
    const deps = createDeps({ metadata, metadataStatus: status })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 502,
      message: 'Protected resource metadata returned an invalid response.',
    })
  })

  it('requires metadata to identify the configured resource', async () => {
    const deps = createDeps({ metadata: protectedMetadata({ resource: 'https://other.example.com/' }) })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 400,
      message: 'Protected resource metadata does not match the configured resource URL.',
    })
  })

  it.each([
    ['no authorization servers', protectedMetadata({ authorization_servers: undefined })],
    ['multiple authorization servers', protectedMetadata({ authorization_servers: [issuer, 'https://other.test'] })],
    ['a non-string authorization server', protectedMetadata({ authorization_servers: [42] })],
  ])('requires exactly one authorization server when metadata has %s', async (_label, metadata) => {
    const deps = createDeps({ metadata })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 400,
      message: 'External API resource must advertise exactly one authorization server.',
    })
  })

  it.each([
    'http://idp.example.com',
    'https://user:secret@idp.example.com',
  ])('rejects an unsafe authorization server URL: %s', async (authorizationServer) => {
    const deps = createDeps({
      metadata: protectedMetadata({ authorization_servers: [authorizationServer] }),
    })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 400,
      message:
        'authorization server issuer must use HTTPS, except for loopback development URLs, and contain no userinfo.',
    })
  })

  it('allows an HTTP loopback authorization server for development', async () => {
    const loopbackIssuer = 'http://localhost:8787'
    const deps = createDeps({
      connector: connector({ issuer: loopbackIssuer }),
      metadata: protectedMetadata({ authorization_servers: [`${loopbackIssuer}/`] }),
    })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).resolves.toMatchObject({
      resource: resourceUrl,
    })
  })

  it('requires the resource authorization server to match the connector issuer', async () => {
    const deps = createDeps({
      metadata: protectedMetadata({ authorization_servers: ['https://other-idp.example.com'] }),
    })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 400,
      message: 'External API resource authorization server does not match the selected OIDC connector.',
    })
  })

  it.each([
    'authorization_code',
    'refresh_token',
    jwtBearerGrant,
    tokenExchangeGrant,
  ])('requires the %s grant', async (missingGrant) => {
    const grants = ['authorization_code', 'refresh_token', jwtBearerGrant, tokenExchangeGrant].filter(
      (grant) => grant !== missingGrant,
    )
    const deps = createDeps({
      connector: connector({ providerMetadata: providerMetadata({ grant_types_supported: grants }) }),
    })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('OIDC connector must support'),
    })
  })

  it('requires advertised DPoP support', async () => {
    const deps = createDeps({
      connector: connector({
        providerMetadata: providerMetadata({ dpop_signing_alg_values_supported: undefined }),
      }),
    })

    await expect(validateExternalResourceConnector(deps, resourceUrl, 'connector-1')).rejects.toMatchObject({
      status: 400,
      message: 'OIDC connector must advertise RFC 9449 DPoP support for external API access.',
    })
  })

  it('[spec: agent-identity/external-resource-rich-authorization-connection] requires advertised RAR types and PAR', async () => {
    const authorizationDetails = [{ type: 'project_access', actions: ['read'] }]
    const unsupported = createDeps()
    await expect(
      validateExternalResourceConnector(unsupported, resourceUrl, 'connector-1', authorizationDetails),
    ).rejects.toThrow('does not support every configured authorization detail type')

    const missingPar = createDeps({
      connector: connector({
        providerMetadata: providerMetadata({ authorization_details_types_supported: ['project_access'] }),
      }),
    })
    await expect(
      validateExternalResourceConnector(missingPar, resourceUrl, 'connector-1', authorizationDetails),
    ).rejects.toThrow('require RFC 9126 pushed authorization requests')

    const complete = createDeps({
      connector: connector({
        providerMetadata: providerMetadata({
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://idp.example.com/par',
        }),
      }),
    })
    await expect(
      validateExternalResourceConnector(complete, resourceUrl, 'connector-1', authorizationDetails),
    ).resolves.toMatchObject({ resource: resourceUrl })
  })

  it('[spec: agent-identity/external-resource-rar-without-catalog] treats the detail catalog as an optional paired extension', async () => {
    const authorizationDetails = [{ type: 'project_access', actions: ['read'] }]
    const withoutCatalog = createDeps({
      connector: connector({
        providerMetadata: providerMetadata({
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://idp.example.com/par',
        }),
      }),
    })
    await expect(
      validateExternalResourceConnector(withoutCatalog, resourceUrl, 'connector-1', authorizationDetails),
    ).resolves.toMatchObject({ resource: resourceUrl })

    const incompleteCatalog = createDeps({
      connector: connector({
        providerMetadata: providerMetadata({
          authorization_details_types_supported: ['project_access'],
          pushed_authorization_request_endpoint: 'https://idp.example.com/par',
          authorization_details_catalog_endpoint: 'https://idp.example.com/authorization-details',
          authorization_details_catalog_version: 1,
        }),
      }),
    })
    await expect(
      validateExternalResourceConnector(incompleteCatalog, resourceUrl, 'connector-1', authorizationDetails),
    ).rejects.toThrow('must provide a valid endpoint, scope, and version 1 together')
  })
})

describe('connector-backed native resource connector validation', () => {
  const completeNativeMetadata = {
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
  }

  it.each([
    ['missing connector', null, 'Provider Connector was not found'],
    ['unsupported driver', connector({ providerType: 'social' }), 'does not support resource authorization'],
    ['disabled connector', connector({ enabled: false }), 'must be enabled'],
    ['missing endpoint', connector({ revocationEndpoint: null }), 'complete resource authorization credentials'],
    [
      'missing refresh grant',
      connector({
        providerMetadata: {
          ...completeNativeMetadata,
          grant_types_supported: ['authorization_code'],
        },
      }),
      'must support authorization_code and refresh_token',
    ],
    [
      'missing S256',
      connector({
        providerMetadata: {
          ...completeNativeMetadata,
          code_challenge_methods_supported: ['plain'],
        },
      }),
      'must support S256 PKCE',
    ],
    [
      'unsupported client authentication',
      connector({
        providerMetadata: {
          ...completeNativeMetadata,
          token_endpoint_auth_methods_supported: ['private_key_jwt'],
        },
      }),
      'must support client_secret_basic or client_secret_post',
    ],
  ])('rejects %s', async (_label, connectorValue, message) => {
    const deps = createDeps({ connector: connectorValue })

    await expect(validateConnectorBackedNativeResource(deps, 'connector-1', [])).rejects.toThrow(message)
  })

  it('enforces the Connector OAuth scope allowlist and accepts exact scopes', async () => {
    const deps = createDeps({
      connector: connector({
        registeredScopes: ['openid', 'offline_access', 'projects:read'],
        providerMetadata: completeNativeMetadata,
      }),
    })

    await expect(validateConnectorBackedNativeResource(deps, 'connector-1', ['projects:write'])).rejects.toThrow(
      'scope allowlist',
    )
    await expect(validateConnectorBackedNativeResource(deps, 'connector-1', ['projects:read'])).resolves.toBeUndefined()
  })
})

function createDeps({
  connector: connectorValue = connector(),
  metadata = protectedMetadata(),
  metadataStatus = 200,
}: {
  connector?: ConnectorRow | null
  metadata?: unknown
  metadataStatus?: number
} = {}) {
  const fetch = vi.fn(async (request: Request) => {
    if (request.url === resourceUrl) {
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    if (request.url === 'https://api.example.com/openapi.json') {
      return Response.json({ openapi: '3.1.0', paths: {} })
    }
    if (request.url === 'https://api.example.com/.well-known/oauth-protected-resource/v1?tenant=acme') {
      if (metadata === 'invalid-json') {
        return new Response('not json', {
          status: metadataStatus,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (metadataStatus >= 400) return new Response(null, { status: metadataStatus })
      return Response.json(metadata, { status: metadataStatus })
    }
    throw new Error(`Unexpected request: ${request.url}`)
  })
  return {
    connectors: { findById: vi.fn().mockResolvedValue(connectorValue) },
    externalHttp: { fetch },
  } as unknown as Deps
}

function protectedMetadata(overrides: Record<string, unknown> = {}) {
  return {
    resource: resourceUrl,
    authorization_servers: [issuer],
    scopes_supported: ['projects:read'],
    ...overrides,
  }
}

function providerMetadata(overrides: Record<string, unknown> = {}) {
  return {
    grant_types_supported: ['authorization_code', 'refresh_token', jwtBearerGrant, tokenExchangeGrant],
    dpop_signing_alg_values_supported: ['ES256'],
    ...overrides,
  }
}

function connector(overrides: Partial<ConnectorRow> = {}): ConnectorRow {
  const now = new Date('2026-07-30T00:00:00.000Z')
  return {
    id: 'connector-1',
    slug: 'projects',
    providerType: 'generic_oauth',
    providerId: 'projects',
    displayName: 'Projects',
    enabled: true,
    authenticationEnabled: false,
    clientId: 'client-1',
    clientSecret: 'secret-1',
    clientSecretContext: null,
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    userInfoEndpoint: `${issuer}/userinfo`,
    jwksEndpoint: `${issuer}/jwks`,
    registrationEndpoint: `${issuer}/register`,
    revocationEndpoint: `${issuer}/revoke`,
    registrationMode: 'manual',
    registrationClientUri: null,
    registrationAccessToken: null,
    registrationAccessTokenContext: null,
    registeredScopes: null,
    clientGeneration: 1,
    retiredClientGenerations: null,
    scopes: ['openid'],
    attributeMapping: null,
    providerMetadata: providerMetadata(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
