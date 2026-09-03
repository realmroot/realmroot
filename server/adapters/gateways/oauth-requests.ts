import type { OAuthRequestGateway, OAuthTokenRequest } from '@server/usecases/ports'
import { authorizationCodeRequest, generateCodeChallenge, refreshAccessTokenRequest } from 'better-auth/oauth2'

function normalizeRequest(request: { body: URLSearchParams; headers: Record<string, unknown> }): OAuthTokenRequest {
  return {
    body: Object.fromEntries(request.body),
    headers: Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, String(value)])),
  }
}

export function createOAuthRequestGateway(): OAuthRequestGateway {
  return {
    generateCodeChallenge,
    async createAuthorizationCodeRequest(input) {
      return normalizeRequest(
        await authorizationCodeRequest({
          code: input.code,
          codeVerifier: input.codeVerifier,
          redirectURI: input.redirectUri,
          options: { clientId: input.clientId, clientSecret: input.clientSecret },
          authentication: input.authentication,
        }),
      )
    },
    async createRefreshTokenRequest(input) {
      return normalizeRequest(
        await refreshAccessTokenRequest({
          refreshToken: input.refreshToken,
          options: { clientId: input.clientId, clientSecret: input.clientSecret },
          authentication: input.authentication,
          extraParams: input.extraParams,
        }),
      )
    },
  }
}
