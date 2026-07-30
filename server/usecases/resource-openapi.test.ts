import { createTestDeps } from '@server/http/test-deps'
import { extractResourceScopes, readDeclaredScopes, validateRequestedScopes } from '@server/usecases/resource-openapi'
import { describe, expect, it, vi } from 'vitest'

describe('business resource OpenAPI scope discovery', () => {
  it('derives native and external requestable scopes only from operation security [spec: agent-identity/native-api-resource-registration]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockImplementation(async (request) => {
      if (request.url === 'https://orders.example.com/') {
        return new Response(null, {
          status: 401,
          headers: {
            link: '</openapi.yaml>; rel="service-desc"; type="application/yaml"',
          },
        })
      }
      return new Response(
        `
openapi: 3.1.0
components:
  securitySchemes:
    businessOAuth:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://orders.example.com/token
          scopes:
            orders:read: Read orders
            orders:write: Write orders
security:
  - businessOAuth: [orders:read]
paths:
  /orders:
    get:
      responses: {}
    post:
      security:
        - businessOAuth: [orders:write]
      responses: {}
  /health:
    get:
      security: []
      responses: {}
`,
        { headers: { 'content-type': 'application/yaml' } },
      )
    })

    await expect(
      validateRequestedScopes(deps, 'https://orders.example.com/', ['orders:read', 'orders:write']),
    ).resolves.toBeUndefined()
    await expect(validateRequestedScopes(deps, 'https://orders.example.com/', ['orders:delete'])).rejects.toThrow(
      'Requested scope is not declared by the business resource OpenAPI document.',
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
    ).toEqual([{ value: 'projects:read', description: null }])
  })

  it('skips discovery when no scopes are requested', async () => {
    const deps = createTestDeps()

    await validateRequestedScopes(deps, 'https://orders.example.com/', [])

    expect(deps.externalHttp.fetch).not.toHaveBeenCalled()
  })

  it.each([
    [null, 'Business resource must advertise its OpenAPI document'],
    ['</openapi.json>; rel="alternate"', 'Business resource must advertise its OpenAPI document'],
  ])('requires a service-desc link (%s)', async (link, message) => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(
      new Response(null, { status: 401, headers: link ? { link } : undefined }),
    )

    await expect(readDeclaredScopes(deps, 'https://orders.example.com/api')).rejects.toThrow(message)
  })

  it('resolves an unquoted service-desc relation and relative document URL', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
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

    await expect(readDeclaredScopes(deps, 'https://orders.example.com/api/')).resolves.toEqual([
      { value: 'orders:read', description: '  Read orders  ' },
    ])
    expect(vi.mocked(deps.externalHttp.fetch).mock.calls[1]![0].url).toBe('https://orders.example.com/api/openapi.json')
  })

  it('surfaces document fetch and parsing failures', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(
        new Response(null, { headers: { link: '</openapi.json>; rel="service-desc documentation"' } }),
      )
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))

    await expect(readDeclaredScopes(deps, 'https://orders.example.com/')).rejects.toThrow(
      'Business resource OpenAPI discovery failed.',
    )

    vi.mocked(deps.externalHttp.fetch)
      .mockResolvedValueOnce(new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } }))
      .mockResolvedValueOnce(new Response('{', { headers: { 'content-type': 'application/json' } }))

    await expect(readDeclaredScopes(deps, 'https://orders.example.com/')).rejects.toThrow(
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
    ).toEqual([{ value: 'valid', description: 'Valid' }])
  })
})
