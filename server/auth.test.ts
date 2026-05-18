import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { createAuth } from './auth'
import type { Database } from './db/client'

describe('createAuth OAuth Provider metadata', () => {
  it('serves OIDC discovery from the mounted Better Auth issuer', async () => {
    const auth = createAuth({} as Database, '01234567890123456789012345678901', 'https://auth.example.com', [
      'https://auth.example.com',
    ])

    const response = await createApp(auth).request('/api/auth/.well-known/openid-configuration')

    expect(response.status).toBe(200)
    const metadata = (await response.json()) as {
      token_endpoint_auth_methods_supported: string[]
    }

    expect(metadata).toMatchObject({
      issuer: 'https://auth.example.com/api/auth',
      authorization_endpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    })
    expect(metadata.token_endpoint_auth_methods_supported).not.toContain('none')
  })
})
