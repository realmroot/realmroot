import { badRequest, notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { validateResourceContract } from '@server/usecases/resource-openapi'
import type { AuthorizationDetail } from '@shared/api/authorization-details'

const tokenExchangeGrantType = 'urn:ietf:params:oauth:grant-type:token-exchange'
const jwtBearerGrantType = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

export async function validateExternalResourceConnector(
  deps: Deps,
  resourceUrlInput: string,
  connectorId: string,
  authorizationDetails: AuthorizationDetail[] = [],
) {
  const connector = await deps.connectors.findById(connectorId)
  if (!connector || connector.providerType !== 'generic_oauth') {
    throw notFound('OIDC connector was not found.')
  }
  if (!connector.enabled || !connector.clientId || !connector.clientSecret || !connector.issuer) {
    throw badRequest('OIDC connector must be enabled and have complete client credentials.')
  }
  if (
    !connector.authorizationEndpoint ||
    !connector.tokenEndpoint ||
    !connector.userInfoEndpoint ||
    !connector.jwksEndpoint ||
    !connector.revocationEndpoint
  ) {
    throw badRequest('OIDC connector is missing endpoints required for external API access.')
  }

  const resourceUrl = requireNetworkUrl(resourceUrlInput, 'resource URL')
  await validateResourceContract(deps, resourceUrl)
  const protectedMetadata = await fetchObject(
    deps,
    protectedResourceMetadataUrl(resourceUrl),
    'Protected resource metadata discovery failed.',
  )
  if (protectedMetadata.resource !== resourceUrl) {
    throw badRequest('Protected resource metadata does not match the configured resource URL.')
  }
  const authorizationServers = stringArray(protectedMetadata.authorization_servers)
  if (authorizationServers.length !== 1) {
    throw badRequest('External API resource must advertise exactly one authorization server.')
  }
  const issuer = requireNetworkUrl(authorizationServers[0]!, 'authorization server issuer').replace(/\/$/, '')
  if (issuer !== connector.issuer.replace(/\/$/, '')) {
    throw badRequest('External API resource authorization server does not match the selected OIDC connector.')
  }

  const grants = stringArray(connector.providerMetadata?.grant_types_supported)
  if (
    !grants.includes('authorization_code') ||
    !grants.includes('refresh_token') ||
    !grants.includes(jwtBearerGrantType) ||
    !grants.includes(tokenExchangeGrantType)
  ) {
    throw badRequest(
      'OIDC connector must support authorization_code, refresh_token, the RFC 7523 JWT bearer grant, and RFC 8693 token exchange.',
    )
  }
  if (stringArray(connector.providerMetadata?.dpop_signing_alg_values_supported).length === 0) {
    throw badRequest('OIDC connector must advertise RFC 9449 DPoP support for external API access.')
  }
  if (authorizationDetails.length === 0) return
  const supportedTypes = stringArray(connector.providerMetadata?.authorization_details_types_supported)
  if (authorizationDetails.some((detail) => !supportedTypes.includes(detail.type))) {
    throw badRequest('OIDC connector does not support every configured authorization detail type.')
  }
  const pushedAuthorizationRequestEndpoint = connector.providerMetadata?.pushed_authorization_request_endpoint
  if (typeof pushedAuthorizationRequestEndpoint !== 'string') {
    throw badRequest('RAR-enabled external API resources require RFC 9126 pushed authorization requests.')
  }
  requireNetworkUrl(pushedAuthorizationRequestEndpoint, 'pushed authorization request endpoint')
  const catalogEndpoint = connector.providerMetadata?.authorization_details_catalog_endpoint
  const catalogScope = connector.providerMetadata?.authorization_details_catalog_scope
  if (
    typeof catalogEndpoint !== 'string' ||
    typeof catalogScope !== 'string' ||
    !catalogScope ||
    /\s/.test(catalogScope)
  ) {
    throw badRequest('RAR-enabled external API resources require an authorization detail catalog endpoint and scope.')
  }
  requireNetworkUrl(catalogEndpoint, 'authorization detail catalog endpoint')
}

async function fetchObject(deps: Deps, url: string, message: string) {
  const response = await deps.externalHttp.fetch(new Request(url, { headers: { accept: 'application/json' } }))
  if (!response.ok) throw badRequest(message)
  const value = await response.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(message)
  return value as Record<string, unknown>
}

function protectedResourceMetadataUrl(resourceUrl: string) {
  const resource = new URL(resourceUrl)
  const path = resource.pathname === '/' ? '' : resource.pathname
  const metadata = new URL(`/.well-known/oauth-protected-resource${path}`, resource.origin)
  metadata.search = resource.search
  return metadata.toString()
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
