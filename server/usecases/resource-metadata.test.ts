import { createTestDeps } from '@server/http/test-deps'
import { readProtectedResourceMetadata, synchronizeResourceDiscovery } from '@server/usecases/resource-metadata'
import { describe, expect, it, vi } from 'vitest'

const resourceUrl = 'https://orders.example.com/api'
const metadataUrl = 'https://orders.example.com/.well-known/oauth-protected-resource/api'

describe('protected resource scope discovery', () => {
  it('[spec: agent-identity/brokered-native-account-connection] discovers complete brokered connection endpoints', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      Response.json({
        resource: resourceUrl,
        scopes_supported: ['orders:read'],
        account_connection_modes_supported: ['brokered'],
        account_connection_authorization_endpoint: 'https://orders.example.com/api/account-connection-authorizations',
        account_connection_token_endpoint: 'https://orders.example.com/api/account-connection-credentials',
      }),
    )

    await expect(readProtectedResourceMetadata(deps, resourceUrl)).resolves.toMatchObject({
      accountConnection: {
        mode: 'brokered',
        authorizationEndpoint: 'https://orders.example.com/api/account-connection-authorizations',
        tokenEndpoint: 'https://orders.example.com/api/account-connection-credentials',
      },
    })
  })

  it('rejects incomplete brokered connection metadata', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      Response.json({
        resource: resourceUrl,
        scopes_supported: ['orders:read'],
        account_connection_modes_supported: ['brokered'],
        account_connection_authorization_endpoint: 'https://orders.example.com/api/account-connection-authorizations',
      }),
    )
    await expect(readProtectedResourceMetadata(deps, resourceUrl)).rejects.toThrow(
      'Brokered account connection metadata is incomplete.',
    )
  })

  it('[spec: admin-console/admin-create-api-resource] uses RFC 9728 scopes as authority and OpenAPI only for descriptions', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockImplementation(
      resourceDiscoveryFetch({
        advertisedScopes: ['orders:archive', 'orders:read'],
        documentedScopes: {
          'orders:read': 'Read orders',
          'orders:write': 'Write orders',
        },
      }),
    )

    await expect(synchronizeResourceDiscovery(deps, resourceUrl, null)).resolves.toMatchObject({
      name: 'Orders API',
      description: 'Manage orders',
      scopeRegistry: {
        discovery: {
          sourceUrl: metadataUrl,
          etag: '"metadata-v1"',
          documentHash: expect.any(String),
          lastError: null,
        },
        scopes: [
          { value: 'orders:archive', description: null, grantMode: 'assigned' },
          { value: 'orders:read', description: 'Read orders', grantMode: 'assigned' },
        ],
      },
    })
  })

  it('preserves grant modes while synchronizing the advertised scope set', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockImplementation(
      resourceDiscoveryFetch({ advertisedScopes: ['orders:read', 'orders:write'] }),
    )
    const previous = {
      discovery: {
        sourceUrl: metadataUrl,
        etag: null,
        documentHash: 'previous',
        syncedAt: new Date('2026-08-01T00:00:00.000Z').toISOString(),
        lastError: null,
      },
      scopes: [
        { value: 'orders:read', description: null, grantMode: 'automatic' as const },
        { value: 'orders:removed', description: null, grantMode: 'assigned' as const },
      ],
    }

    await expect(synchronizeResourceDiscovery(deps, resourceUrl, previous)).resolves.toMatchObject({
      scopeRegistry: {
        scopes: [
          { value: 'orders:read', grantMode: 'automatic' },
          { value: 'orders:write', grantMode: 'assigned' },
        ],
      },
    })
  })

  it('accepts an operation mapping whose scope is absent from OAuth flow descriptions', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockImplementation(
      resourceDiscoveryFetch({ advertisedScopes: ['orders:read'], operationScopes: ['orders:read'] }),
    )

    await expect(synchronizeResourceDiscovery(deps, resourceUrl, null)).resolves.toMatchObject({
      scopeRegistry: { scopes: [{ value: 'orders:read', description: null }] },
    })
  })

  it.each([
    ['is missing', undefined],
    ['is empty', []],
    ['contains an empty scope', ['orders:read', '']],
    ['contains a scope with whitespace', ['orders:read write']],
    ['contains a double quote', ['orders:"read']],
    ['contains a backslash', ['orders:\\read']],
    ['contains Unicode', ['订单:read']],
    ['is not a string array', ['orders:read', 42]],
  ])('rejects metadata when scopes_supported %s', async (_label, scopesSupported) => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      Response.json({ resource: resourceUrl, scopes_supported: scopesSupported }),
    )

    await expect(readProtectedResourceMetadata(deps, resourceUrl)).rejects.toThrow(
      'Protected resource metadata must advertise at least one valid scope.',
    )
  })

  it.each([
    ['an HTTP failure', new Response(null, { status: 503 })],
    ['the wrong media type', new Response('{}', { headers: { 'content-type': 'text/application/json-evil' } })],
    ['malformed JSON', new Response('{', { headers: { 'content-type': 'application/json' } })],
  ])('classifies %s as an upstream discovery failure', async (_label, response) => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(response)

    await expect(readProtectedResourceMetadata(deps, resourceUrl)).rejects.toMatchObject({
      status: 502,
      code: 'bad_gateway',
      details: { stage: 'protected_resource_metadata', url: metadataUrl, status: response.status },
    })
  })

  it('times out even when the HTTP gateway ignores the abort signal', async () => {
    vi.useFakeTimers()
    try {
      const deps = createTestDeps()
      vi.mocked(deps.externalHttp.fetch).mockReturnValue(new Promise<Response>(() => {}))

      const result = readProtectedResourceMetadata(deps, resourceUrl)
      const rejection = expect(result).rejects.toMatchObject({ status: 502, code: 'bad_gateway' })
      await vi.advanceTimersByTimeAsync(5_000)

      await rejection
      expect(vi.mocked(deps.externalHttp.fetch).mock.calls[0]?.[0].signal.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores OpenAPI operations outside the RFC 9728 resource scope boundary', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockImplementation(
      resourceDiscoveryFetch({
        advertisedScopes: ['orders:read'],
        documentedScopes: { 'orders:read': 'Read orders', 'orders:write': 'Write orders' },
        operationScopes: ['orders:write'],
      }),
    )

    await expect(synchronizeResourceDiscovery(deps, resourceUrl, null)).resolves.toMatchObject({
      scopeRegistry: { scopes: [{ value: 'orders:read', description: 'Read orders' }] },
    })
  })
})

function resourceDiscoveryFetch({
  advertisedScopes,
  documentedScopes = {},
  operationScopes = [],
}: {
  advertisedScopes: string[]
  documentedScopes?: Record<string, string>
  operationScopes?: string[]
}) {
  return async (request: Request) => {
    if (request.url === metadataUrl) {
      return Response.json(
        { resource: resourceUrl, scopes_supported: advertisedScopes },
        { headers: { etag: '"metadata-v1"' } },
      )
    }
    if (request.url === resourceUrl) {
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    if (request.url === 'https://orders.example.com/openapi.json') {
      return Response.json({
        openapi: '3.1.0',
        info: { title: ' Orders API ', description: ' Manage orders ', version: '1.0.0' },
        components: {
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: { clientCredentials: { scopes: documentedScopes } },
            },
          },
        },
        paths: {
          '/orders': {
            get: { security: [{ oauth: operationScopes }], responses: {} },
          },
        },
      })
    }
    throw new Error(`Unexpected request: ${request.url}`)
  }
}
