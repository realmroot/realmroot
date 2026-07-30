import { createTestDeps } from '@server/http/test-deps'
import { extractResourceScopes, validateRequestedScopes } from '@server/usecases/resource-openapi'
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
})
