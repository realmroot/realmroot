import { badRequest, notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { type ProtectedResourceMetadata, readProtectedResourceMetadata } from '@server/usecases/resource-metadata'
import type { AuthorizationDetail } from '@shared/api/authorization-details'
import type { ResourceServerConformanceCheck } from '@shared/api/management'

const tokenExchangeGrantType = 'urn:ietf:params:oauth:grant-type:token-exchange'
const jwtBearerGrantType = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

export async function validateExternalResourceConnector(
  deps: Deps,
  resourceUrlInput: string,
  connectorId: string,
  authorizationDetails: AuthorizationDetail[] = [],
  discoveredMetadata?: ProtectedResourceMetadata,
): Promise<ProtectedResourceMetadata> {
  const protectedMetadata = discoveredMetadata ?? (await readProtectedResourceMetadata(deps, resourceUrlInput))
  const checks = await inspectExternalResourceConnector(deps, connectorId, authorizationDetails, protectedMetadata)
  if (checks.length) throw badRequest(checks[0]!.message)
  return protectedMetadata
}

export async function inspectExternalResourceConnector(
  deps: Deps,
  connectorId: string,
  authorizationDetails: AuthorizationDetail[],
  protectedMetadata: ProtectedResourceMetadata | null,
): Promise<ResourceServerConformanceCheck[]> {
  const checks: ResourceServerConformanceCheck[] = []
  const fail = (requirement: ResourceServerConformanceCheck['requirement'], message: string) =>
    checks.push({ requirement, status: 'failed', message })
  const block = (requirement: ResourceServerConformanceCheck['requirement'], message: string) =>
    checks.push({ requirement, status: 'blocked', message })
  const connector = await deps.connectors.findById(connectorId)
  if (!connector || connector.providerType !== 'generic_oauth') {
    throw notFound('OIDC connector was not found.')
  }
  if (!connector.enabled) fail('OIDC-CONNECTION', 'OIDC connector must be enabled.')
  if (!connector.clientId) fail('OIDC-CONNECTION', 'OIDC connector is missing its client ID.')
  if (!connector.clientSecret) fail('OIDC-CONNECTION', 'OIDC connector is missing its client secret.')
  if (!connector.issuer) fail('AS-METADATA', 'OIDC connector is missing its issuer.')
  if (!connector.authorizationEndpoint) fail('AS-METADATA', 'OIDC connector is missing its authorization endpoint.')
  if (!connector.tokenEndpoint) fail('AS-METADATA', 'OIDC connector is missing its token endpoint.')
  if (!connector.userInfoEndpoint) fail('OIDC-CONNECTION', 'OIDC connector is missing its UserInfo endpoint.')
  if (!connector.jwksEndpoint) fail('AS-METADATA', 'OIDC connector is missing its JWKS endpoint.')
  if (!protectedMetadata) {
    block('AS-METADATA', 'Authorization server validation is blocked until RESOURCE-METADATA passes.')
  } else if (protectedMetadata.authorizationServers.length !== 1) {
    fail('AS-METADATA', 'External API resource must advertise exactly one authorization server.')
  } else {
    try {
      const issuer = requireNetworkUrl(
        protectedMetadata.authorizationServers[0]!,
        'authorization server issuer',
      ).replace(/\/$/, '')
      if (connector.issuer && issuer !== connector.issuer.replace(/\/$/, '')) {
        fail('AS-METADATA', 'External API resource authorization server does not match the selected OIDC connector.')
      }
    } catch (error) {
      fail('AS-METADATA', error instanceof Error ? error.message : 'Authorization server issuer is invalid.')
    }
  }

  const grants = stringArray(connector.providerMetadata?.grant_types_supported)
  if (!grants.includes('authorization_code')) fail('OAUTH-CODE', 'OIDC connector must support authorization_code.')
  if (!grants.includes('refresh_token')) fail('OAUTH-REFRESH', 'OIDC connector must support refresh_token.')
  if (!grants.includes(jwtBearerGrantType)) {
    fail('ACTOR-ASSERTION', 'OIDC connector must support the RFC 7523 JWT bearer grant.')
  }
  if (!grants.includes(tokenExchangeGrantType)) {
    fail('TOKEN-EXCHANGE', 'OIDC connector must support RFC 8693 token exchange.')
  }
  if (!stringArray(connector.providerMetadata?.code_challenge_methods_supported).includes('S256')) {
    fail('OAUTH-PKCE', 'OIDC connector must advertise S256 PKCE support.')
  }
  if (!stringArray(connector.providerMetadata?.token_endpoint_auth_methods_supported).includes('client_secret_basic')) {
    fail('OIDC-CONNECTION', 'OIDC connector must advertise client_secret_basic token endpoint authentication.')
  }
  if (!stringArray(connector.providerMetadata?.dpop_signing_alg_values_supported).includes('ES256')) {
    fail('DPOP', 'OIDC connector must advertise ES256 for RFC 9449 DPoP.')
  }
  if (!connector.revocationEndpoint) {
    fail('TOKEN-REVOCATION', 'OIDC connector must advertise a token revocation endpoint.')
  }
  if (authorizationDetails.length === 0) return checks
  const supportedTypes = stringArray(connector.providerMetadata?.authorization_details_types_supported)
  if (authorizationDetails.some((detail) => !supportedTypes.includes(detail.type))) {
    fail('RICH-AUTHORIZATION', 'OIDC connector does not support every configured authorization detail type.')
  }
  const pushedAuthorizationRequestEndpoint = connector.providerMetadata?.pushed_authorization_request_endpoint
  if (typeof pushedAuthorizationRequestEndpoint !== 'string') {
    fail('PUSHED-AUTHORIZATION', 'RAR-enabled external API resources require RFC 9126 pushed authorization requests.')
  } else {
    try {
      requireNetworkUrl(pushedAuthorizationRequestEndpoint, 'pushed authorization request endpoint')
    } catch (error) {
      fail('PUSHED-AUTHORIZATION', error instanceof Error ? error.message : 'PAR endpoint is invalid.')
    }
  }
  const catalogEndpoint = connector.providerMetadata?.authorization_details_catalog_endpoint
  const catalogScope = connector.providerMetadata?.authorization_details_catalog_scope
  const catalogVersion = connector.providerMetadata?.authorization_details_catalog_version
  if (catalogEndpoint === undefined && catalogScope === undefined && catalogVersion === undefined) {
    return checks
  }
  if (
    typeof catalogEndpoint !== 'string' ||
    typeof catalogScope !== 'string' ||
    !catalogScope ||
    /\s/.test(catalogScope) ||
    catalogVersion !== 1
  ) {
    fail(
      'AUTHORIZATION-CATALOG',
      'Authorization detail catalog metadata must provide a valid endpoint, scope, and version 1 together.',
    )
  } else {
    try {
      requireNetworkUrl(catalogEndpoint, 'authorization detail catalog endpoint')
    } catch (error) {
      fail('AUTHORIZATION-CATALOG', error instanceof Error ? error.message : 'Authorization catalog is invalid.')
    }
  }
  return checks
}

function requireNetworkUrl(value: string, label: string) {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password) {
    throw badRequest(`${label} must use HTTPS, except for loopback development URLs, and contain no userinfo.`)
  }
  return url.toString()
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}
