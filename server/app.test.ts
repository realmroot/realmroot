import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app'

describe('createApp', () => {
  it('serves health status', async () => {
    const auth = {
      api: {
        getOAuthServerConfig: vi.fn(),
        getOpenIdConfig: vi.fn(),
      },
      handler: async () => new Response(null, { status: 204 }),
    }
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
})
