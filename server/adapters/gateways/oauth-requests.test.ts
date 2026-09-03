import { createOAuthRequestGateway } from '@server/adapters/gateways/oauth-requests'
import { describe, expect, it } from 'vitest'

describe('OAuth request gateway', () => {
  it('builds PKCE authorization-code requests with the selected client authentication', async () => {
    const gateway = createOAuthRequestGateway()

    await expect(gateway.generateCodeChallenge('pkce-verifier')).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/)
    await expect(
      gateway.createAuthorizationCodeRequest({
        code: 'authorization-code',
        codeVerifier: 'pkce-verifier',
        redirectUri: 'https://auth.example.com/callback',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        authentication: 'basic',
      }),
    ).resolves.toEqual({
      body: {
        grant_type: 'authorization_code',
        code: 'authorization-code',
        code_verifier: 'pkce-verifier',
        redirect_uri: 'https://auth.example.com/callback',
      },
      headers: {
        accept: 'application/json',
        authorization: `Basic ${btoa('client-id:client-secret')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
    })
  })

  it('builds refresh requests with post authentication and provider parameters', async () => {
    const gateway = createOAuthRequestGateway()

    await expect(
      gateway.createRefreshTokenRequest({
        refreshToken: 'refresh-token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        authentication: 'post',
        extraParams: { authorization_details: '[{"type":"project_access"}]' },
      }),
    ).resolves.toEqual({
      body: {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
        client_id: 'client-id',
        client_secret: 'client-secret',
        authorization_details: '[{"type":"project_access"}]',
      },
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
    })
  })
})
