import type { AuthorizationDetail } from '@shared/api/authorization-details'

export interface ResourceOAuthConnector {
  providerType: string
  providerId: string
  authorizationEndpoint: string | null
  tokenEndpoint: string | null
  userInfoEndpoint: string | null
  revocationEndpoint: string | null
  providerMetadata: Record<string, unknown> | null
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
  if (connector.providerType === 'generic_oauth') return genericOidcDriver(connector)
  if (connector.providerType === 'social' && connector.providerId === 'linear') return linearDriver()
  return null
}

function genericOidcDriver(connector: ResourceOAuthConnector): ResourceOAuthDriver | null {
  if (
    !connector.authorizationEndpoint ||
    !connector.tokenEndpoint ||
    !connector.userInfoEndpoint ||
    !connector.revocationEndpoint
  ) {
    return null
  }
  return {
    authorizationEndpoint: connector.authorizationEndpoint,
    tokenEndpoint: connector.tokenEndpoint,
    userInfoEndpoint: connector.userInfoEndpoint,
    revocationEndpoint: connector.revocationEndpoint,
    tokenEndpointAuthentication: genericTokenEndpointAuthentication(connector),
    revocationAuthentication: genericTokenEndpointAuthentication(connector),
    authorizationDetailsMode: 'provider',
    revokeAccessToken: true,
    normalizeScopes: (scopes) => [...new Set([...scopes, 'openid', 'offline_access'])].sort(),
    authorizationParameters: { prompt: 'consent' },
    scopeSeparator: ' ',
    profileRequest: (accessToken) =>
      new Request(connector.userInfoEndpoint!, { headers: { authorization: `Bearer ${accessToken}` } }),
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

function linearDriver(): ResourceOAuthDriver {
  const graphqlEndpoint = 'https://api.linear.app/graphql'
  return {
    authorizationEndpoint: 'https://linear.app/oauth/authorize',
    tokenEndpoint: 'https://api.linear.app/oauth/token',
    userInfoEndpoint: graphqlEndpoint,
    revocationEndpoint: 'https://api.linear.app/oauth/revoke',
    tokenEndpointAuthentication: 'post',
    revocationAuthentication: 'none',
    authorizationDetailsMode: 'connection',
    revokeAccessToken: false,
    normalizeScopes: (scopes) => [...new Set(scopes)].sort(),
    authorizationParameters: { actor: 'app', prompt: 'consent' },
    scopeSeparator: ',',
    profileRequest: (accessToken) =>
      new Request(graphqlEndpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'query RealmrootProviderConnection { viewer { id name } organization { id name } }',
        }),
      }),
    parseProfile(profile) {
      return {
        externalSubject: requiredNestedString(profile, ['data', 'organization', 'id'], 'Linear workspace response'),
        displayName: requiredNestedString(profile, ['data', 'organization', 'name'], 'Linear workspace response'),
      }
    },
    authorizationDetails(profile) {
      return [
        {
          type: 'linear_workspace',
          workspace_id: profile.externalSubject,
          workspace_name: profile.displayName,
        },
      ]
    },
  }
}

function genericTokenEndpointAuthentication(connector: ResourceOAuthConnector): 'basic' | 'post' {
  const methods = connector.providerMetadata?.token_endpoint_auth_methods_supported
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
