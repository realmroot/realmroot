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

  requireNetworkUrl(resourceUrlInput, 'resource URL')
  const resourceUrl = resourceUrlInput
  const protectedMetadata = discoveredMetadata ?? (await readProtectedResourceMetadata(deps, resourceUrl))
  const authorizationServers = protectedMetadata.authorizationServers
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
  if (authorizationDetails.length === 0) return protectedMetadata
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
  const catalogVersion = connector.providerMetadata?.authorization_details_catalog_version
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

export async function validateConnectorBackedNativeResource(
  deps: Deps,
  connectorId: string,
  resourceScopes: string[],
  authorizationDetails: AuthorizationDetail[] = [],
  supportedAuthorizationDetailTypes: string[] = [],
) {
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
  if (!connector.enabled || !connector.clientId || !connector.clientSecret || !resourceOAuthDriver(connector)) {
    throw badRequest('Provider Connector must be enabled and have complete resource authorization credentials.')
  }
  if (authorizationDetails.some((detail) => !supportedAuthorizationDetailTypes.includes(detail.type))) {
    throw badRequest('Resource Server does not support every configured authorization detail type.')
  }

  if (connector.providerType !== 'generic_oauth') return

  const grants = stringArray(connector.providerMetadata?.grant_types_supported)
  if (!grants.includes('authorization_code') || !grants.includes('refresh_token')) {
    throw badRequest('OIDC connector must support authorization_code and refresh_token.')
  }
  const codeChallengeMethods = stringArray(connector.providerMetadata?.code_challenge_methods_supported)
  if (!codeChallengeMethods.includes('S256')) {
    throw badRequest('OIDC connector must support S256 PKCE.')
  }
  const authenticationMethods = stringArray(connector.providerMetadata?.token_endpoint_auth_methods_supported)
  if (
    authenticationMethods.length > 0 &&
    !authenticationMethods.includes('client_secret_basic') &&
    !authenticationMethods.includes('client_secret_post')
  ) {
    throw badRequest('OIDC connector must support client_secret_basic or client_secret_post authentication.')
  }

  const allowedScopes = new Set(connector.registeredScopes ?? connector.scopes ?? [])
  const unsupportedScopes = resourceScopes.filter((scope) => !allowedScopes.has(scope))
  if (unsupportedScopes.length > 0) {
    throw badRequest('Resource Server scopes exceed the selected Connector OAuth client scope allowlist.')
  }
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
