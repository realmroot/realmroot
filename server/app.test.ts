import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'

describe('createApp', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves health status', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth).request('/api/health')

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'flareauth',
    })
  })

  it('serves OAuth authorization server metadata at the issuer-path well-known route', async () => {
    const getOAuthServerConfig = vi.fn().mockResolvedValue({
      issuer: 'https://auth.example.com/api/auth',
      authorization_endpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    })
    const auth = {
      api: {
        getOAuthServerConfig,
        getOpenIdConfig: vi.fn(),
        getSession: vi.fn().mockResolvedValue(null),
      },
      handler: async () => new Response(null, { status: 204 }),
    }

    const response = await createApp(auth).request('/.well-known/oauth-authorization-server/api/auth')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      issuer: 'https://auth.example.com/api/auth',
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      code_challenge_methods_supported: ['S256'],
    })
    expect(getOAuthServerConfig).toHaveBeenCalledWith({
      request: expect.any(Request),
      asResponse: false,
    })
  })

  it('returns consistent JSON errors from the boundary', async () => {
    const response = await createApp(createAuthMock()).request('/api/missing', {
      headers: {
        'cf-ray': 'request-1',
      },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_found',
        message: 'Resource not found.',
        requestId: 'request-1',
      },
    })
  })

  it('rejects untrusted API origins before handlers run', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, { trustedOrigins: ['https://tenant.example.com'] }).request('/api/health', {
      headers: {
        origin: 'https://evil.example.com',
      },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Origin is not trusted for this issuer.',
      },
    })
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('allows trusted API origins and emits CORS response headers', async () => {
    const response = await createApp(createAuthMock(), { trustedOrigins: ['https://tenant.example.com'] }).request(
      '/api/health',
      {
        headers: {
          origin: 'https://tenant.example.com',
        },
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://tenant.example.com')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('mounts admin authorization routes behind the admin auth boundary', async () => {
    const app = createApp(createAuthMock())

    const organizations = await app.request('/api/admin/organizations')
    const resources = await app.request('/api/admin/api-resources')
    const roles = await app.request('/api/admin/roles')

    expect(organizations.status).toBe(401)
    expect(resources.status).toBe(401)
    expect(roles.status).toBe(401)
  })
})

function createAuthMock() {
  return {
    api: {
      getOAuthServerConfig: vi.fn(),
      getOpenIdConfig: vi.fn(),
      getSession: vi.fn().mockResolvedValue(null),
    },
    handler: async () => new Response(null, { status: 204 }),
  }
}
