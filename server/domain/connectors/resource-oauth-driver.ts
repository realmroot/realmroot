import type { AuthorizationDetail } from '@shared/api/authorization-details'

export interface ResourceOAuthConnector {
  resourceAuthorizationEnabled: boolean
  resourceAuthorizationEndpoint: string | null
  resourceTokenEndpoint: string | null
  resourceUserInfoEndpoint: string | null
  resourceRevocationEndpoint: string | null
  resourceProviderMetadata: Record<string, unknown> | null
}

export interface ResourceOAuthProfile {
  externalSubject: string
  displayName: string
}

export interface ResourceOAuthDriver {
  authorizationEndpoint: string
  tokenEndpoint: string
  userInfoEndpoint: string
  revocationEndpoint: string
  tokenEndpointAuthentication: 'basic' | 'post'
  revocationAuthentication: 'basic' | 'post' | 'none'
  authorizationDetailsMode: 'provider' | 'connection'
  revokeAccessToken: boolean
  normalizeScopes(scopes: string[]): string[]
  authorizationParameters: Record<string, string>
  scopeSeparator: string
  profileRequest(accessToken: string): Request
  parseProfile(profile: Record<string, unknown>): ResourceOAuthProfile
  authorizationDetails?(profile: ResourceOAuthProfile): AuthorizationDetail[]
}

export function resourceOAuthDriver(connector: ResourceOAuthConnector): ResourceOAuthDriver | null {
  return connector.resourceAuthorizationEnabled ? genericOidcDriver(connector) : null
}

function genericOidcDriver(connector: ResourceOAuthConnector): ResourceOAuthDriver | null {
  if (
    !connector.resourceAuthorizationEndpoint ||
    !connector.resourceTokenEndpoint ||
    !connector.resourceUserInfoEndpoint ||
    !connector.resourceRevocationEndpoint
  ) {
    return null
  }
  return {
    authorizationEndpoint: connector.resourceAuthorizationEndpoint,
    tokenEndpoint: connector.resourceTokenEndpoint,
    userInfoEndpoint: connector.resourceUserInfoEndpoint,
    revocationEndpoint: connector.resourceRevocationEndpoint,
    tokenEndpointAuthentication: genericTokenEndpointAuthentication(connector),
    revocationAuthentication: genericTokenEndpointAuthentication(connector),
    authorizationDetailsMode: 'provider',
    revokeAccessToken: true,
    normalizeScopes: (scopes) => [...new Set([...scopes, 'openid', 'offline_access'])].sort(),
    authorizationParameters: { prompt: 'consent' },
    scopeSeparator: ' ',
    profileRequest: (accessToken) =>
      new Request(connector.resourceUserInfoEndpoint!, { headers: { authorization: `Bearer ${accessToken}` } }),
    parseProfile(profile) {
      const externalSubject = requiredNestedString(profile, ['sub'], 'OIDC userinfo response')
      return {
        externalSubject,
        displayName:
          optionalNestedString(profile, ['name']) ??
          optionalNestedString(profile, ['preferred_username']) ??
          externalSubject,
      }
    },
  }
}

function genericTokenEndpointAuthentication(connector: ResourceOAuthConnector): 'basic' | 'post' {
  const methods = connector.resourceProviderMetadata?.token_endpoint_auth_methods_supported
  return Array.isArray(methods) && methods.includes('client_secret_post') && !methods.includes('client_secret_basic')
    ? 'post'
    : 'basic'
}

function optionalNestedString(value: unknown, path: string[]) {
  let current = value
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' && current ? current : null
}

function requiredNestedString(value: unknown, path: string[], label: string) {
  const result = optionalNestedString(value, path)
  if (!result) throw new Error(`${label} is missing ${path.join('.')}.`)
  return result
}
