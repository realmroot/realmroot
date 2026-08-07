import { createTestDeps } from '@server/http/test-deps'
import {
  extractProtectedOperations,
  extractResourceScopes,
  readResourceContract,
  readResourceContractDocument,
  validateRequestedScopes,
  validateResourceUrl,
} from '@server/usecases/resource-openapi'
import { describe, expect, it, vi } from 'vitest'

async function readScopes(deps: ReturnType<typeof createTestDeps>, resourceUrl: string) {
  return (await readResourceContract(deps, resourceUrl))!.scopes
}

describe('business resource OpenAPI scope annotations', () => {
  it('reads a known OpenAPI document without repeating service discovery', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValueOnce(
      Response.json({
        openapi: '3.1.0',
        components: { securitySchemes: { dpop: { type: 'http', scheme: 'DPoP' } } },
        paths: {
          '/organizations': {
            get: { operationId: 'listOrganizations', security: [{ dpop: ['organizations:read'] }] },
          },
        },
      }),
    )

    await expect(
      readResourceContractDocument(deps, 'https://auth.example.com/api/openapi.json'),
    ).resolves.toMatchObject({
      sourceUrl: 'https://auth.example.com/api/openapi.json',
      scopes: [],
      operations: [
        {
          method: 'GET',
          path: '/organizations',
          operationId: 'listOrganizations',
          requiredScopeSets: [['organizations:read']],
        },
      ],
    })
    expect(deps.externalHttp.fetch).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.externalHttp.fetch).mock.calls[0]![0].url).toBe('https://auth.example.com/api/openapi.json')
  })

  it('returns protected operations and exact alternative scope sets [spec: admin-console/admin-create-api-resource]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { link: '</openapi.json>; rel="service-desc"' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          openapi: '3.1.0',
          components: {
            securitySchemes: {
              oauth: {
                type: 'oauth2',
                flows: {
                  clientCredentials: {
                    tokenUrl: 'https://orders.example.com/token',
                    scopes: {
                      'orders:read': 'Read orders',
                      'orders:manage': 'Manage orders',
                      'orders:admin': 'Administer orders',
                    },
                  },
                },
              },
            },
          },
          paths: {
            '/orders/{id}': {
              get: {
                operationId: 'getOrder',
                summary: 'Get an order',
                description: 'Returns one order.',
                security: [{ oauth: ['orders:read', 'orders:manage'] }, { oauth: ['orders:admin'] }],
                responses: {},
              },
              parameters: [],
            },
            '/health': {
              get: { security: [], responses: {} },
            },
            '/status': {
              get: { security: [{ oauth: [] }], responses: {} },
            },
          },
        }),
      )

    await expect(readResourceContract(deps, 'https://orders.example.com/')).resolves.toMatchObject({
      sourceUrl: 'https://orders.example.com/openapi.json',
      etag: null,
      documentHash: expect.any(String),
      scopes: [
        { value: 'orders:admin', description: 'Administer orders' },
        { value: 'orders:manage', description: 'Manage orders' },
        { value: 'orders:read', description: 'Read orders' },
      ],
      operations: [
        {
          method: 'GET',
          path: '/orders/{id}',
          operationId: 'getOrder',
          summary: 'Get an order',
          description: 'Returns one order.',
          requiredScopeSets: [['orders:manage', 'orders:read'], ['orders:admin']],
        },
        {
          method: 'GET',
          path: '/status',
          operationId: null,
          summary: null,
          description: null,
          requiredScopeSets: [[]],
        },
      ],
    })
  })

  it('validates requested scopes against the synchronized resource scope registry', () => {
    const registry = {
      discovery: {
        sourceUrl: 'https://orders.example.com/.well-known/oauth-protected-resource',
        etag: null,
        documentHash: 'registry',
        syncedAt: new Date().toISOString(),
        lastError: null,
      },
      scopes: ['orders:read', 'orders:write'].map((value) => ({
        value,
        description: null,
        grantMode: 'assigned' as const,
      })),
    }
    expect(() => validateRequestedScopes(registry, ['orders:read', 'orders:write'])).not.toThrow()
    expect(() => validateRequestedScopes(registry, ['orders:delete'])).toThrow(
      'Requested scope is not declared by the Resource Server scope registry.',
    )
  })

  it('does not treat non-OAuth security requirement values as scopes', () => {
    expect(
      extractResourceScopes({
        openapi: '3.1.0',
        components: {
          securitySchemes: {
            agentKey: { type: 'apiKey', in: 'header', name: 'Authorization' },
            oidc: {
              type: 'openIdConnect',
              openIdConnectUrl: 'https://issuer.example.com/.well-known/openid-configuration',
            },
          },
        },
        paths: {
          '/projects': {
            get: {
              security: [{ agentKey: ['admin'], oidc: ['projects:read'] }],
            },
          },
        },
      }),
    ).toEqual([])
  })

  it('skips discovery when no scopes are requested', async () => {
    expect(() => validateRequestedScopes(null, [])).not.toThrow()
  })

  it.each([
    [null, 'Business resource must advertise its OpenAPI document'],
    ['</openapi.json>; rel="alternate"', 'Business resource must advertise its OpenAPI document'],
  ])('requires a service-desc link (%s)', async (link, message) => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response(null, { headers: link ? { link } : undefined }))

    await expect(readScopes(deps, 'https://orders.example.com/api')).rejects.toThrow(message)
  })

  it('resolves an unquoted service-desc relation and relative document URL', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { link: '</other>; rel=alternate, <openapi.json>; rel=service-desc' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            openapi: '3.0.3',
            components: {
              securitySchemes: {
                oauth: {
                  $ref: '#/components/securitySchemes/oauthDefinition',
                },
                oauthDefinition: {
                  type: 'oauth2',
                  flows: {
                    clientCredentials: {
                      scopes: { 'orders:read': '  Read orders  ', 'orders:empty': ' ' },
                    },
                  },
                },
              },
            },
            security: [{ oauth: ['orders:read', '', 42] }],
            paths: {
              '/orders': {
                get: { responses: {} },
                post: { security: [], responses: {} },
                parameters: [],
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )

    await expect(readScopes(deps, 'https://orders.example.com/api/')).resolves.toEqual([
      { value: 'orders:empty', description: null },
      { value: 'orders:read', description: 'Read orders' },
    ])
    expect(vi.mocked(deps.externalHttp.fetch).mock.calls[1]![0].url).toBe('https://orders.example.com/api/openapi.json')
  })

  it('requires a successful response from the exact resource URL [spec: agent-identity/api-resource-contract-validation]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      new Response(null, {
        status: 404,
        headers: { link: '</openapi.json>; rel="service-desc"' },
      }),
    )

    await expect(readScopes(deps, 'https://orders.example.com/api')).rejects.toThrow(
      'Business resource discovery failed.',
    )
    expect(deps.externalHttp.fetch).toHaveBeenCalledTimes(1)
  })

  it('identifies which OpenAPI discovery request lost its network connection [spec: agent-identity/api-resource-contract-validation]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockRejectedValueOnce(new Error('Network connection lost.'))

    await expect(readScopes(deps, 'https://orders.example.com/api')).rejects.toMatchObject({
      status: 502,
      code: 'bad_gateway',
      message: 'Business resource could not be reached during OpenAPI discovery.',
      details: {
        stage: 'resource',
        url: 'https://orders.example.com/api',
      },
    })

    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { link: '</openapi.json>; rel="service-desc"' },
        }),
      )
      .mockRejectedValueOnce(new Error('Network connection lost.'))

    await expect(readScopes(deps, 'https://orders.example.com/api')).rejects.toMatchObject({
      status: 502,
      code: 'bad_gateway',
      message: 'Business resource OpenAPI document could not be reached.',
      details: {
        stage: 'openapi_document',
        url: 'https://orders.example.com/openapi.json',
      },
    })
  })

  it('bounds an unresponsive Resource Server discovery request', async () => {
    vi.useFakeTimers()
    try {
      const deps = createTestDeps()
      vi.mocked(deps.externalHttp.fetch).mockReturnValue(new Promise<Response>(() => {}))

      const result = readScopes(deps, 'https://orders.example.com/api')
      const rejection = expect(result).rejects.toMatchObject({
        status: 502,
        code: 'bad_gateway',
        details: { stage: 'resource', url: 'https://orders.example.com/api' },
      })
      await vi.advanceTimersByTimeAsync(5_000)

      await rejection
      expect(vi.mocked(deps.externalHttp.fetch).mock.calls[0]?.[0].signal.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['https://api.example.com', true],
    ['http://localhost:4100/api', true],
    ['http://127.0.0.1:4100/api', true],
    ['http://[::1]:4100/api', true],
    ['http://api.example.com', false],
    ['ftp://api.example.com', false],
    ['https://user:password@api.example.com', false],
    ['https://api.example.com/resource#fragment', false],
  ])('validates protected resource URL boundaries (%s)', (resourceUrl, valid) => {
    const validate = () => validateResourceUrl(resourceUrl)
    if (valid) expect(validate).not.toThrow()
    else expect(validate).toThrow('Resource URL must use HTTPS')
  })

  it('surfaces document fetch and parsing failures', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(
        new Response(null, { headers: { link: '</openapi.json>; rel="service-desc documentation"' } }),
      )
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))

    await expect(readScopes(deps, 'https://orders.example.com/')).rejects.toThrow(
      'Business resource OpenAPI discovery failed.',
    )

    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } }))
      .mockResolvedValueOnce(new Response('{', { headers: { 'content-type': 'application/json' } }))

    await expect(readScopes(deps, 'https://orders.example.com/')).rejects.toThrow(
      'Business resource OpenAPI document is invalid.',
    )
  })

  it.each([
    [null, 'Business resource OpenAPI document is invalid.'],
    [[], 'Business resource OpenAPI document is invalid.'],
    [{}, 'Business resource must publish an OpenAPI 3.x document.'],
    [{ openapi: '2.0', paths: {} }, 'Business resource must publish an OpenAPI 3.x document.'],
  ])('rejects invalid OpenAPI roots', (document, message) => {
    expect(() => extractResourceScopes(document)).toThrow(message)
  })

  it('ignores invalid schemes, references, operations, and security values', () => {
    expect(
      extractResourceScopes({
        openapi: '3.1.0',
        components: {
          securitySchemes: {
            missing: { $ref: '#/components/securitySchemes/not-there' },
            external: { $ref: 'https://example.com/security.json' },
            malformed: null,
            oauth: {
              type: 'oauth2',
              flows: {
                clientCredentials: { scopes: { valid: 'Valid', blank: '' } },
                invalid: null,
              },
            },
          },
        },
        security: 'invalid',
        paths: {
          '/ignored': null,
          '/items': {
            get: null,
            post: { security: [{ oauth: 'valid' }, null, { oauth: [null, 'valid', ' '] }] },
          },
        },
      }),
    ).toEqual([
      { value: 'blank', description: null },
      { value: 'valid', description: 'Valid' },
    ])
  })

  it('rejects malformed and inconsistent OAuth scope declarations', () => {
    const document = (scopes: Record<string, unknown>) => ({
      openapi: '3.1.0',
      components: {
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            flows: { authorizationCode: { scopes }, clientCredentials: { scopes } },
          },
        },
      },
    })

    expect(() => extractResourceScopes(document({ '': 'Empty' }))).toThrow('non-empty scope names')
    expect(() => extractResourceScopes(document({ 'items:read': 42 }))).toThrow('string descriptions')
    expect(() =>
      extractResourceScopes({
        openapi: '3.1.0',
        components: {
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: {
                authorizationCode: { scopes: { 'items:read': 'Read items' } },
                clientCredentials: { scopes: { 'items:read': 'Read all items' } },
              },
            },
          },
        },
      }),
    ).toThrow('inconsistent descriptions')
  })

  it('ignores non-operation path item fields when extracting protected operations', () => {
    expect(
      extractProtectedOperations({
        openapi: '3.0.3',
        components: { securitySchemes: {} },
        paths: { '/items': { parameters: [], summary: 'Items' } },
      }),
    ).toEqual([])
  })

  it('rejects malformed and inconsistent OAuth scope declarations', () => {
    const doc = (scopes: Record<string, unknown>) => ({
      openapi: '3.1.0',
      components: {
        securitySchemes: {
          oauth: { type: 'oauth2', flows: { authorizationCode: { scopes } } },
        },
      },
    })
    expect(() => extractResourceScopes(doc({ '': 'Empty' }))).toThrow('non-empty scope names')
    expect(() => extractResourceScopes(doc({ read: 42 }))).toThrow('string descriptions')
    expect(() =>
      extractResourceScopes({
        openapi: '3.1.0',
        components: {
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: { a: { scopes: { read: 'Read' } }, b: { scopes: { read: 'Read all' } } },
            },
          },
        },
      }),
    ).toThrow('inconsistent descriptions')
  })

  it('supports OpenID Connect operations and conditional YAML discovery', async () => {
    expect(
      extractProtectedOperations({
        openapi: '3.1.0',
        components: { securitySchemes: { oidc: { type: 'openIdConnect' } } },
        paths: {
          '/items': { get: { security: [{ oidc: ['read'] }], responses: {} } },
        },
      }),
    ).toHaveLength(1)
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(new Response(null, { headers: { link: '</openapi.yaml>; rel=service-desc alternate' } }))
      .mockImplementationOnce(async (request) => {
        expect(request.headers.get('if-none-match')).toBe('"v1"')
        return new Response(null, { status: 304 })
      })
    await expect(
      readResourceContract(deps, 'https://orders.example.com/', {
        discovery: {
          sourceUrl: 'https://orders.example.com/openapi.yaml',
          etag: '"v1"',
          documentHash: 'x',
          syncedAt: '2026-08-01T00:00:00.000Z',
          lastError: null,
        },
        scopes: [],
      }),
    ).resolves.toBeNull()
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(new Response(null, { headers: { link: '</openapi.yaml>; rel=service-desc' } }))
      .mockResolvedValueOnce(
        new Response('openapi: 3.1.0\npaths: {}\n', { headers: { 'content-type': 'application/yaml' } }),
      )
    await expect(readResourceContract(deps, 'https://orders.example.com/')).resolves.toMatchObject({ operations: [] })
  })

  it('requires protected-operation documents to use OpenAPI 3.x', () => {
    expect(() => extractProtectedOperations({})).toThrow('must publish an OpenAPI 3.x document')
    expect(() => extractProtectedOperations({ openapi: '2.0', paths: {} })).toThrow(
      'must publish an OpenAPI 3.x document',
    )
  })

  it('ignores non-scope security requirements while retaining empty OAuth requirements', () => {
    expect(
      extractProtectedOperations({
        openapi: '3.1.0',
        components: { securitySchemes: { oauth: { type: 'oauth2' } } },
        security: [{ unknown: [] }, { oauth: 'invalid' }, { oauth: [] }],
        paths: { '/items': { get: { responses: {} } } },
      }),
    ).toEqual([
      { method: 'GET', path: '/items', operationId: null, summary: null, description: null, requiredScopeSets: [[]] },
    ])
  })

  it('supports OpenID Connect operations and conditional YAML discovery', async () => {
    expect(
      extractProtectedOperations({
        openapi: '3.1.0',
        components: { securitySchemes: { oidc: { type: 'openIdConnect' } } },
        paths: { '/items': { get: { security: [{ oidc: ['items:read'] }], responses: {} } } },
      }),
    ).toEqual([
      {
        method: 'GET',
        path: '/items',
        operationId: null,
        summary: null,
        description: null,
        requiredScopeSets: [['items:read']],
      },
    ])

    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(new Response(null, { headers: { link: '</openapi.yaml>; rel=service-desc alternate' } }))
      .mockImplementationOnce(async (request) => {
        expect(request.headers.get('if-none-match')).toBe('"v1"')
        return new Response(null, { status: 304 })
      })
    await expect(
      readResourceContract(deps, 'https://orders.example.com/', {
        discovery: {
          sourceUrl: 'https://orders.example.com/openapi.yaml',
          etag: '"v1"',
          documentHash: 'hash',
          syncedAt: '2026-08-01T00:00:00.000Z',
          lastError: null,
        },
        scopes: [],
      }),
    ).resolves.toBeNull()

    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(new Response(null, { headers: { link: '</openapi.yaml>; rel=service-desc' } }))
      .mockResolvedValueOnce(
        new Response('openapi: 3.1.0\npaths: {}\n', { headers: { 'content-type': 'application/yaml' } }),
      )
    await expect(readResourceContract(deps, 'https://orders.example.com/')).resolves.toMatchObject({ operations: [] })
  })
})
