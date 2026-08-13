import { connectorCapabilities } from '@server/domain/connectors/provider-templates'
import { resourceOAuthDriver } from '@server/domain/connectors/resource-oauth-driver'
import { badRequest, notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { type ProtectedResourceMetadata, readProtectedResourceMetadata } from '@server/usecases/resource-metadata'
import type { AuthorizationDetail } from '@shared/api/authorization-details'

const tokenExchangeGrantType = 'urn:ietf:params:oauth:grant-type:token-exchange'
const jwtBearerGrantType = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

export async function validateExternalResourceConnector(
  deps: Deps,
  resourceUrlInput: string,
  connectorId: string,
  authorizationDetails: AuthorizationDetail[] = [],
  discoveredMetadata?: ProtectedResourceMetadata,
): Promise<ProtectedResourceMetadata> {
  const connector = await deps.connectors.findById(connectorId)
  if (!connector) {
    throw notFound('Provider Connector was not found.')
  }
  if (
    !connectorCapabilities(connector.providerType as 'social' | 'generic_oauth', connector.providerId)
      .resourceAuthorization
  ) {
    throw badRequest('Connector driver does not support resource authorization.')
  }
  if (
    !connector.enabled ||
    !connector.resourceAuthorizationEnabled ||
    !connector.resourceClientId ||
    !connector.resourceClientSecret ||
    !connector.resourceIssuer ||
    !connector.resourceJwksEndpoint ||
    !resourceOAuthDriver(connector)
  ) {
    throw badRequest('Provider Connector must have complete resource authorization credentials.')
  }

  requireNetworkUrl(resourceUrlInput, 'resource URL')
  const resourceUrl = resourceUrlInput
  const protectedMetadata = discoveredMetadata ?? (await readProtectedResourceMetadata(deps, resourceUrl))
  const authorizationServers = protectedMetadata.authorizationServers
  if (authorizationServers.length !== 1) {
    throw badRequest('External API resource must advertise exactly one authorization server.')
  }
  const issuer = requireNetworkUrl(authorizationServers[0]!, 'authorization server issuer').replace(/\/$/, '')
  if (issuer !== connector.resourceIssuer.replace(/\/$/, '')) {
    throw badRequest('External API resource authorization server does not match the selected Provider Connector.')
  }

  const grants = stringArray(connector.resourceProviderMetadata?.grant_types_supported)
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
  if (stringArray(connector.resourceProviderMetadata?.dpop_signing_alg_values_supported).length === 0) {
    throw badRequest('OIDC connector must advertise RFC 9449 DPoP support for external API access.')
  }
  if (authorizationDetails.length === 0) return protectedMetadata
  const supportedTypes = stringArray(connector.resourceProviderMetadata?.authorization_details_types_supported)
  if (authorizationDetails.some((detail) => !supportedTypes.includes(detail.type))) {
    throw badRequest('OIDC connector does not support every configured authorization detail type.')
  }
  const pushedAuthorizationRequestEndpoint = connector.resourceProviderMetadata?.pushed_authorization_request_endpoint
  if (pushedAuthorizationRequestEndpoint !== undefined) {
    if (typeof pushedAuthorizationRequestEndpoint !== 'string') {
      throw badRequest('Pushed authorization request endpoint must be a URL when advertised.')
    }
    requireNetworkUrl(pushedAuthorizationRequestEndpoint, 'pushed authorization request endpoint')
  }
  const catalogEndpoint = connector.resourceProviderMetadata?.authorization_details_catalog_endpoint
  const catalogScope = connector.resourceProviderMetadata?.authorization_details_catalog_scope
  const catalogVersion = connector.resourceProviderMetadata?.authorization_details_catalog_version
  if (catalogEndpoint === undefined && catalogScope === undefined && catalogVersion === undefined) {
    return protectedMetadata
  }
  if (
    typeof catalogEndpoint !== 'string' ||
    typeof catalogScope !== 'string' ||
    !catalogScope ||
    /\s/.test(catalogScope) ||
    catalogVersion !== 1
  ) {
    throw badRequest(
      'Authorization detail catalog metadata must provide a valid endpoint, scope, and version 1 together.',
    )
  }
  requireNetworkUrl(catalogEndpoint, 'authorization detail catalog endpoint')
  return protectedMetadata
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
