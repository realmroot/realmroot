import { connectorTemplates, isSupportedProvider } from '@server/domain/connectors/provider-templates'
import { badRequest, notFound, resourceInUse } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { ConnectorRecord, ConnectorRepository } from '@server/usecases/ports'
import type {
  ConnectorProviderType,
  ConnectorReadinessResponse,
  ConnectorResponse,
  CreateConnectorRequest,
  UpdateConnectorRequest,
} from '@shared/api/connectors'
import { paginationMetadata } from '@shared/api/pagination'

const oidcClientBaseScopes = ['openid', 'profile', 'email', 'offline_access']

/**
 * Minimal mirror of better-auth's GenericOAuthProviderConfig, capturing only the
 * fields this usecase populates. Kept framework-free so usecases stay clear of
 * better-auth; the values remain structurally assignable to better-auth's type
 * at the server/auth.ts boundary.
 */
export interface GenericOAuthProviderConfig {
  providerId: string
  clientId: string
  clientSecret?: string
  issuer?: string
  discoveryUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  scopes?: string[]
}

export interface AuthConnectorConfig {
  trustedProviders: string[]
  socialProviders: Record<string, Record<string, unknown>>
  genericOAuthProviders: GenericOAuthProviderConfig[]
  cacheKey: string
}

export async function listConnectors(deps: Deps, page: { limit: number; offset: number }) {
  const result = await deps.connectors.list(page)
  return {
    connectors: result.items.map(toResponse),
    pagination: paginationMetadata({ ...page, total: result.total }),
  }
}

export function listConnectorTemplates() {
  return { templates: connectorTemplates }
}

export async function getConnector(deps: Deps, id: string) {
  const connector = await deps.connectors.findById(id)
  if (!connector) throw notFound('Connector not found.')
  return toResponse(connector)
}

export async function connectorReadiness(deps: Deps, id: string): Promise<ConnectorReadinessResponse> {
  const connector = await deps.connectors.findById(id)
  if (!connector) throw notFound('Connector not found.')

  const checks = connectorReadinessChecks(connector)
  return {
    connectorId: connector.id,
    ready: checks.every((check) => check.ok),
    checks,
  }
}

export async function createConnector(deps: Deps, input: CreateConnectorRequest, callbackOrigin?: string) {
  assertSupportedProvider(input.providerType, input.providerId)
  await assertProviderAvailable(deps.connectors, input.providerId)
  const oidc = input.providerType === 'generic_oauth' ? await prepareOidcConnector(deps, input, callbackOrigin) : null
  const now = new Date()
  const candidate = {
    id: `idp_${crypto.randomUUID().replaceAll('-', '')}`,
    slug: input.slug ?? input.providerId,
    providerType: input.providerType,
    providerId: input.providerId,
    displayName: input.displayName,
    enabled: input.enabled ?? true,
    loginEnabled: input.loginEnabled ?? input.providerType === 'social',
    clientId: oidc?.clientId ?? input.clientId ?? null,
    clientSecret: oidc?.clientSecret ?? input.clientSecret ?? null,
    clientSecretContext: null,
    issuer: oidc?.issuer ?? input.issuer ?? null,
    authorizationEndpoint: oidc?.authorizationEndpoint ?? input.authorizationEndpoint ?? null,
    tokenEndpoint: oidc?.tokenEndpoint ?? input.tokenEndpoint ?? null,
    userInfoEndpoint: oidc?.userInfoEndpoint ?? input.userInfoEndpoint ?? null,
    jwksEndpoint: oidc?.jwksEndpoint ?? input.jwksEndpoint ?? null,
    registrationEndpoint: oidc?.registrationEndpoint ?? null,
    revocationEndpoint: oidc?.revocationEndpoint ?? null,
    registrationMode: input.providerType === 'generic_oauth' ? (input.registrationMode ?? 'manual') : null,
    registrationClientUri: oidc?.registrationClientUri ?? null,
    registrationAccessToken: oidc?.registrationAccessToken ?? null,
    registrationAccessTokenContext: null,
    registeredScopes: oidc?.registeredScopes ?? null,
    clientGeneration: 1,
    retiredClientGenerations: null,
    scopes: input.scopes ?? null,
    attributeMapping: null,
    providerMetadata: oidc?.metadata ?? input.providerMetadata ?? null,
    createdAt: now,
    updatedAt: now,
  }
  assertComplete(candidate)
  const connector = await deps.connectors.create(candidate)
  assertComplete(connector)
  return toResponse(connector)
}

export async function updateConnector(deps: Deps, id: string, input: UpdateConnectorRequest) {
  const current = await deps.connectors.findById(id)
  if (!current) throw notFound('Connector not found.')

  const candidate = {
    ...current,
    ...input,
    updatedAt: new Date(),
  }
  assertComplete(candidate)

  const updated = await deps.connectors.update(id, {
    ...input,
    updatedAt: candidate.updatedAt,
  })
  if (!updated) throw notFound('Connector not found.')
  assertComplete(updated)
  return toResponse(updated)
}

export async function deleteConnector(deps: Deps, id: string) {
  const current = await deps.connectors.findById(id)
  if (!current) throw notFound('Connector not found.')
  const resourceCount = await deps.connectors.countResourceReferences(id)
  if (resourceCount > 0) {
    throw resourceInUse('OIDC connector is associated with API resources and cannot be deleted.', {
      apiResources: resourceCount,
    })
  }
  await deps.connectors.delete(id)
}

export async function loadAuthConnectorConfig(repository: ConnectorRepository): Promise<AuthConnectorConfig> {
  const connectors = await repository.listEnabled()
  const socialProviders: Record<string, Record<string, unknown>> = {}
  const genericOAuthProviders: GenericOAuthProviderConfig[] = []
  const trustedProviders: string[] = []

  for (const connector of connectors) {
    if (!connector.loginEnabled) continue
    const clientId = connector.clientId
    const clientSecret = connector.clientSecret
    if (!canLoadAuthConnector(connector) || !clientId || !clientSecret) continue
    trustedProviders.push(connector.providerId)

    if (connector.providerType === 'social') {
      socialProviders[connector.providerId] = {
        ...signupEnabledMetadata(connector.providerMetadata),
        clientId,
        clientSecret,
        scope: connector.scopes ?? undefined,
        issuer: connector.issuer ?? undefined,
      }
      continue
    }

    genericOAuthProviders.push({
      ...signupEnabledMetadata(connector.providerMetadata),
      providerId: connector.providerId,
      clientId,
      clientSecret,
      issuer: connector.issuer ?? undefined,
      discoveryUrl: connector.issuer ? oidcDiscoveryUrl(connector.issuer) : undefined,
      authorizationUrl: connector.authorizationEndpoint ?? undefined,
      tokenUrl: connector.tokenEndpoint ?? undefined,
      userInfoUrl: connector.userInfoEndpoint ?? undefined,
      scopes: connector.scopes ?? undefined,
    })
  }

  return {
    trustedProviders,
    socialProviders,
    genericOAuthProviders,
    cacheKey: JSON.stringify(
      connectors.map((connector) => ({
        id: connector.id,
        updatedAt: connector.updatedAt.toISOString(),
        enabled: connector.enabled,
        clientSecretConfigured: Boolean(connector.clientSecret),
      })),
    ),
  }
}

function signupEnabledMetadata(metadata: Record<string, unknown> | null) {
  const sanitized = { ...(metadata ?? {}) }
  delete sanitized.disableSignUp
  delete sanitized.disableSignup
  delete sanitized.disableImplicitSignUp
  delete sanitized.allowUsersWithoutEmail
  return sanitized
}

function assertSupportedProvider(providerType: ConnectorProviderType, providerId: string) {
  if (!isSupportedProvider(providerType, providerId)) {
    throw badRequest('Unsupported social provider.')
  }
}

function assertComplete(connector: ConnectorRecord) {
  if (!connector.enabled) return
  if (!connector.clientId) throw badRequest('Enabled connector requires clientId.')
  if (!connector.clientSecret) throw badRequest('Enabled connector requires clientSecret.')
  assertSupportedProvider(connector.providerType as ConnectorProviderType, connector.providerId)
  if (connector.providerType === 'social') assertSocialProviderComplete(connector)
  if (connector.providerType === 'generic_oauth') assertGenericOAuthComplete(connector)
}

async function assertProviderAvailable(repository: ConnectorRepository, providerId: string) {
  const existing = await repository.findByProviderId(providerId)
  if (existing) throw badRequest('Connector provider is already configured.')
}

function assertSocialProviderComplete(connector: ConnectorRecord) {
  if (connector.providerId !== 'cognito') return

  const metadata = connector.providerMetadata ?? {}
  for (const field of ['domain', 'region', 'userPoolId']) {
    if (typeof metadata[field] !== 'string' || metadata[field].length === 0) {
      throw badRequest(`Enabled Cognito connector requires providerMetadata.${field}.`)
    }
  }
}

function assertGenericOAuthComplete(connector: ConnectorRecord) {
  if (!connector.issuer) throw badRequest('Enabled OIDC connector requires issuer discovery.')
  if (!connector.authorizationEndpoint || !connector.tokenEndpoint || !connector.userInfoEndpoint) {
    throw badRequest('Enabled OIDC connector requires discovered authorization, token, and userinfo endpoints.')
  }
}

function canLoadAuthConnector(connector: ConnectorRecord) {
  if (connector.providerType !== 'social' && connector.providerType !== 'generic_oauth') return false
  const providerType = connector.providerType
  if (!isSupportedProvider(providerType, connector.providerId)) return false
  if (!connector.clientId || !connector.clientSecret) return false
  if (providerType === 'social') return canLoadSocialProvider(connector)
  return canLoadGenericOAuth(connector)
}

function canLoadSocialProvider(connector: ConnectorRecord) {
  if (connector.providerId !== 'cognito') return true

  const metadata = connector.providerMetadata ?? {}
  return ['domain', 'region', 'userPoolId'].every(
    (field) => typeof metadata[field] === 'string' && metadata[field].length > 0,
  )
}

function canLoadGenericOAuth(connector: ConnectorRecord) {
  return Boolean(connector.issuer && connector.authorizationEndpoint && connector.tokenEndpoint)
}

function connectorReadinessChecks(connector: ConnectorRecord) {
  const checks = [
    {
      key: 'enabled',
      label: 'Connector enabled',
      ok: connector.enabled,
      message: connector.enabled ? 'Connector is enabled.' : 'Connector is disabled.',
    },
    {
      key: 'clientId',
      label: 'Client ID configured',
      ok: Boolean(connector.clientId),
      message: connector.clientId ? 'Client ID is configured.' : 'Client ID is missing.',
    },
    {
      key: 'clientSecret',
      label: 'Client secret configured',
      ok: Boolean(connector.clientSecret),
      message: connector.clientSecret ? 'Client secret is configured.' : 'Client secret is missing.',
    },
  ]

  if (connector.providerType === 'generic_oauth') {
    const discoveryConfigured = Boolean(
      connector.issuer &&
        connector.authorizationEndpoint &&
        connector.tokenEndpoint &&
        connector.userInfoEndpoint &&
        connector.jwksEndpoint,
    )
    checks.push({
      key: 'oauthEndpoints',
      label: 'OIDC discovery configured',
      ok: discoveryConfigured,
      message: discoveryConfigured
        ? 'OIDC issuer and discovered endpoints are configured.'
        : 'OIDC issuer or required discovered endpoints are missing.',
    })
  }

  return checks
}

function toResponse(row: ConnectorRecord): ConnectorResponse {
  return {
    id: row.id,
    slug: row.slug,
    providerType: row.providerType as ConnectorProviderType,
    providerId: row.providerId,
    displayName: row.displayName,
    enabled: row.enabled,
    loginEnabled: row.loginEnabled,
    clientId: row.clientId,
    clientSecretConfigured: Boolean(row.clientSecret),
    issuer: row.issuer,
    authorizationEndpoint: row.authorizationEndpoint,
    tokenEndpoint: row.tokenEndpoint,
    userInfoEndpoint: row.userInfoEndpoint,
    jwksEndpoint: row.jwksEndpoint,
    registrationEndpoint: row.registrationEndpoint,
    revocationEndpoint: row.revocationEndpoint,
    registrationMode: row.registrationMode as 'manual' | 'dynamic' | null,
    scopes: row.scopes ?? [],
    providerMetadata: row.providerMetadata ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function prepareOidcConnector(deps: Deps, input: CreateConnectorRequest, callbackOrigin?: string) {
  if (!input.issuer) throw badRequest('OIDC connectors require an issuer.')
  const issuer = requireNetworkUrl(input.issuer, 'OIDC issuer').replace(/\/$/, '')
  const issuerUrl = new URL(issuer)
  if (issuerUrl.search || issuerUrl.hash) throw badRequest('OIDC issuer cannot contain a query or fragment.')
  let response = await deps.externalHttp.fetch(
    new Request(oidcDiscoveryUrl(issuer), {
      headers: { accept: 'application/json' },
    }),
  )
  if (!response.ok) {
    response = await deps.externalHttp.fetch(
      new Request(oauthAuthorizationServerDiscoveryUrl(issuer), {
        headers: { accept: 'application/json' },
      }),
    )
  }
  if (!response.ok) throw badRequest('OAuth authorization server discovery failed.')
  const metadata = await readObject(response, 'OIDC discovery response is invalid.')
  if (metadata.issuer !== issuer) throw badRequest('OIDC discovery issuer does not match the configured issuer.')

  const authorizationEndpoint = requiredMetadataUrl(metadata, 'authorization_endpoint')
  const tokenEndpoint = requiredMetadataUrl(metadata, 'token_endpoint')
  const userInfoEndpoint = requiredMetadataUrl(metadata, 'userinfo_endpoint')
  const jwksEndpoint = requiredMetadataUrl(metadata, 'jwks_uri')
  const registrationEndpoint =
    typeof metadata.registration_endpoint === 'string'
      ? requireNetworkUrl(metadata.registration_endpoint, 'registration endpoint')
      : null
  const revocationEndpoint =
    typeof metadata.revocation_endpoint === 'string'
      ? requireNetworkUrl(metadata.revocation_endpoint, 'revocation endpoint')
      : null
  const authorizationDetailsTypes = optionalStringArray(
    metadata,
    'authorization_details_types_supported',
    'OIDC discovery response',
  )
  const { scope: authorizationDetailsCatalogScope } = authorizationDetailsCatalogMetadata(metadata)
  const registeredScopes = registrationScopes(metadata, authorizationDetailsCatalogScope)

  if ((input.registrationMode ?? 'manual') === 'manual') {
    if (!input.clientId || !input.clientSecret)
      throw badRequest('Manual OIDC registration requires client credentials.')
    return {
      issuer,
      authorizationEndpoint,
      tokenEndpoint,
      userInfoEndpoint,
      jwksEndpoint,
      registrationEndpoint,
      revocationEndpoint,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      registrationAccessToken: null,
      registrationClientUri: null,
      registeredScopes: null,
      metadata,
    }
  }

  if (!registrationEndpoint) throw badRequest('OIDC provider does not support dynamic client registration.')
  if (!callbackOrigin) throw new Error('Dynamic OIDC registration requires the configured base URL.')
  const registration = await registerOidcClient(
    deps,
    registrationEndpoint,
    callbackOrigin.replace(/\/$/, ''),
    input.providerId,
    input.displayName,
    authorizationDetailsTypes,
    registeredScopes,
  )
  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    userInfoEndpoint,
    jwksEndpoint,
    registrationEndpoint,
    revocationEndpoint,
    ...registration,
    metadata,
  }
}

function oidcDiscoveryUrl(issuer: string) {
  const url = new URL(issuer)
  const issuerPath = url.pathname.replace(/\/$/, '')
  url.pathname = `/.well-known/openid-configuration${issuerPath === '' ? '' : issuerPath}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function oauthAuthorizationServerDiscoveryUrl(issuer: string) {
  const url = new URL(issuer)
  const issuerPath = url.pathname.replace(/\/$/, '')
  url.pathname = `/.well-known/oauth-authorization-server${issuerPath === '' ? '' : issuerPath}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function registerOidcClient(
  deps: Deps,
  endpoint: string,
  origin: string,
  providerId: string,
  displayName: string,
  authorizationDetailsTypes: string[],
  scopes: string[],
) {
  const response = await deps.externalHttp.fetch(
    new Request(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(registrationRequest(origin, providerId, displayName, authorizationDetailsTypes, scopes)),
    }),
  )
  if (!response.ok) throw badRequest('Dynamic OIDC client registration failed.')
  const body = await readObject(response, 'Dynamic OIDC client registration response is invalid.')
  return registrationResponse(body, scopes)
}

export async function ensureDynamicConnectorScopes(
  deps: Deps,
  connectorId: string,
  requiredScopes: string[],
  callbackOrigin: string,
) {
  const connector = await deps.connectors.findById(connectorId)
  if (!connector) throw notFound('Connector not found.')
  const generation = connector.clientGeneration ?? 1
  if (connector.registrationMode !== 'dynamic') return generation
  if (!connector.issuer || !connector.registrationEndpoint || !connector.clientId || !connector.clientSecret) {
    throw badRequest('Dynamic OIDC connector is incomplete.')
  }
  if (requiredScopes.every((scope) => connector.registeredScopes?.includes(scope))) {
    if (!connector.registrationClientUri || !connector.registrationAccessToken) return generation
    const response = await deps.externalHttp.fetch(
      new Request(requireNetworkUrl(connector.registrationClientUri, 'registration client URI'), {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${connector.registrationAccessToken}`,
        },
      }),
    )
    if (response.ok) {
      const body = await readObject(response, 'Dynamic OIDC client registration response is invalid.')
      if (requiredString(body, 'client_id', 'Dynamic OIDC client registration response') !== connector.clientId) {
        throw badRequest('Dynamic OIDC registration management changed the client identifier.')
      }
      const remoteScopes = typeof body.scope === 'string' ? scopeString(body.scope) : null
      if (remoteScopes && requiredScopes.every((scope) => remoteScopes.includes(scope))) return generation
    } else if (![401, 404, 405, 501].includes(response.status)) {
      throw badRequest('Dynamic OIDC client registration read failed.')
    }
  }

  const metadata = await fetchOidcMetadata(deps, connector.issuer)
  const { scope: authorizationDetailsCatalogScope } = authorizationDetailsCatalogMetadata(metadata)
  const desiredScopes = registrationScopes(metadata, authorizationDetailsCatalogScope)
  if (requiredScopes.some((scope) => !desiredScopes.includes(scope))) {
    throw badRequest('The authorization server does not advertise every requested scope.')
  }
  const authorizationDetailsTypes = optionalStringArray(
    metadata,
    'authorization_details_types_supported',
    'OIDC discovery response',
  )
  const origin = callbackOrigin.replace(/\/$/, '')
  const requestBody = registrationRequest(
    origin,
    connector.providerId,
    connector.displayName,
    authorizationDetailsTypes,
    desiredScopes,
  )

  if (connector.registrationClientUri && connector.registrationAccessToken) {
    const response = await deps.externalHttp.fetch(
      new Request(requireNetworkUrl(connector.registrationClientUri, 'registration client URI'), {
        method: 'PUT',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${connector.registrationAccessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ client_id: connector.clientId, ...requestBody }),
      }),
    )
    if (response.ok) {
      const updated = registrationResponse(
        await readObject(response, 'Dynamic OIDC client registration update response is invalid.'),
        desiredScopes,
        {
          clientSecret: connector.clientSecret,
          registrationClientUri: connector.registrationClientUri,
          registrationAccessToken: connector.registrationAccessToken,
        },
      )
      if (updated.clientId !== connector.clientId) {
        throw badRequest('Dynamic OIDC registration management changed the client identifier.')
      }
      await deps.connectors.update(connector.id, {
        clientSecret: updated.clientSecret,
        registrationClientUri: updated.registrationClientUri,
        registrationAccessToken: updated.registrationAccessToken,
        registeredScopes: updated.registeredScopes,
        providerMetadata: metadata,
        updatedAt: new Date(),
      })
      return generation
    }
    if (![401, 404, 405, 501].includes(response.status)) {
      throw badRequest('Dynamic OIDC client registration update failed.')
    }
  }

  const replacement = await registerOidcClient(
    deps,
    connector.registrationEndpoint,
    origin,
    connector.providerId,
    connector.displayName,
    authorizationDetailsTypes,
    desiredScopes,
  )
  const retired = {
    generation,
    clientId: connector.clientId,
    encryptedClientSecret: await deps.secrets.seal(
      connector.clientSecret,
      retiredClientSecretContext(connector.id, generation),
    ),
    clientSecretContext: retiredClientSecretContext(connector.id, generation),
    registrationClientUri: connector.registrationClientUri ?? null,
    encryptedRegistrationAccessToken: connector.registrationAccessToken
      ? await deps.secrets.seal(
          connector.registrationAccessToken,
          retiredRegistrationTokenContext(connector.id, generation),
        )
      : null,
    registrationAccessTokenContext: connector.registrationAccessToken
      ? retiredRegistrationTokenContext(connector.id, generation)
      : null,
    registeredScopes: connector.registeredScopes ?? oidcClientBaseScopes,
  }
  const nextGeneration = generation + 1
  const rotated = await deps.connectors.rotateClientGeneration(connector.id, generation, {
    clientId: replacement.clientId,
    clientSecret: replacement.clientSecret,
    registrationClientUri: replacement.registrationClientUri,
    registrationAccessToken: replacement.registrationAccessToken,
    registeredScopes: replacement.registeredScopes,
    clientGeneration: nextGeneration,
    retiredClientGenerations: [...(connector.retiredClientGenerations ?? []), retired],
    providerMetadata: metadata,
    updatedAt: new Date(),
  })
  if (!rotated) {
    const winner = await deps.connectors.findById(connector.id)
    if (
      winner &&
      (winner.clientGeneration ?? 1) > generation &&
      requiredScopes.every((scope) => winner.registeredScopes?.includes(scope))
    ) {
      return winner.clientGeneration ?? 1
    }
    throw badRequest('Dynamic OIDC client registration changed concurrently; retry the authorization request.')
  }
  return nextGeneration
}

function registrationRequest(
  origin: string,
  providerId: string,
  displayName: string,
  authorizationDetailsTypes: string[],
  scopes: string[],
) {
  return {
    client_name: `Realmroot ${displayName}`,
    redirect_uris: [
      `${origin}/api/auth/callback/${encodeURIComponent(providerId)}`,
      `${origin}/api/account-connections/oauth/callback`,
    ],
    grant_types: [
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_basic',
    scope: scopes.join(' '),
    jwks_uri: `${origin}/api/auth/jwks`,
    ...(authorizationDetailsTypes.length > 0 ? { authorization_details_types: authorizationDetailsTypes } : {}),
  }
}

function registrationResponse(
  body: Record<string, unknown>,
  requestedScopes: string[],
  previous?: { clientSecret: string; registrationClientUri: string; registrationAccessToken: string },
) {
  const returnedScopes = typeof body.scope === 'string' ? scopeString(body.scope) : null
  if (returnedScopes && requestedScopes.some((scope) => !returnedScopes.includes(scope))) {
    throw badRequest('Dynamic OIDC client registration omitted a requested scope.')
  }
  const registrationClientUri =
    typeof body.registration_client_uri === 'string'
      ? requireNetworkUrl(body.registration_client_uri, 'registration client URI')
      : (previous?.registrationClientUri ?? null)
  return {
    clientId: requiredString(body, 'client_id', 'Dynamic OIDC client registration response'),
    clientSecret:
      typeof body.client_secret === 'string' && body.client_secret.length > 0
        ? body.client_secret
        : (previous?.clientSecret ??
          requiredString(body, 'client_secret', 'Dynamic OIDC client registration response')),
    registrationClientUri,
    registrationAccessToken:
      typeof body.registration_access_token === 'string'
        ? body.registration_access_token
        : (previous?.registrationAccessToken ?? null),
    registeredScopes: returnedScopes ?? requestedScopes,
  }
}

async function fetchOidcMetadata(deps: Deps, issuer: string) {
  let response = await deps.externalHttp.fetch(
    new Request(oidcDiscoveryUrl(issuer), { headers: { accept: 'application/json' } }),
  )
  if (!response.ok) {
    response = await deps.externalHttp.fetch(
      new Request(oauthAuthorizationServerDiscoveryUrl(issuer), { headers: { accept: 'application/json' } }),
    )
  }
  if (!response.ok) throw badRequest('OAuth authorization server discovery failed.')
  const metadata = await readObject(response, 'OIDC discovery response is invalid.')
  if (metadata.issuer !== issuer) throw badRequest('OIDC discovery issuer does not match the configured issuer.')
  return metadata
}

function registrationScopes(metadata: Record<string, unknown>, authorizationDetailsCatalogScope: string | null) {
  return [
    ...new Set([
      ...oidcClientBaseScopes,
      ...optionalStringArray(metadata, 'scopes_supported', 'OIDC discovery response'),
      ...(authorizationDetailsCatalogScope ? [authorizationDetailsCatalogScope] : []),
    ]),
  ].sort()
}

function authorizationDetailsCatalogMetadata(metadata: Record<string, unknown>) {
  const endpoint =
    metadata.authorization_details_catalog_endpoint === undefined
      ? null
      : requireNetworkUrl(
          requiredString(metadata, 'authorization_details_catalog_endpoint', 'OIDC discovery response'),
          'authorization details catalog endpoint',
        )
  const scope =
    metadata.authorization_details_catalog_scope === undefined
      ? null
      : requiredString(metadata, 'authorization_details_catalog_scope', 'OIDC discovery response')
  if (Boolean(endpoint) !== Boolean(scope)) {
    throw badRequest(
      'OIDC discovery response must advertise authorization_details_catalog_endpoint and authorization_details_catalog_scope together.',
    )
  }
  if (scope?.match(/\s/)) {
    throw badRequest('OIDC discovery response has invalid authorization_details_catalog_scope.')
  }
  return { endpoint, scope }
}

function scopeString(value: string) {
  const scopes = value.split(/\s+/).filter(Boolean)
  return scopes.length > 0 ? [...new Set(scopes)].sort() : null
}

function retiredClientSecretContext(connectorId: string, generation: number) {
  return `connector:${connectorId}:client-generation:${generation}:client-secret`
}

function retiredRegistrationTokenContext(connectorId: string, generation: number) {
  return `connector:${connectorId}:client-generation:${generation}:registration-token`
}

async function readObject(response: Response, message: string) {
  const value = await response.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(message)
  return value as Record<string, unknown>
}

function requiredMetadataUrl(metadata: Record<string, unknown>, field: string) {
  return requireNetworkUrl(requiredString(metadata, field, 'OIDC discovery response'), field)
}

function requiredString(value: Record<string, unknown>, field: string, label: string) {
  const result = value[field]
  if (typeof result !== 'string' || result.length === 0) throw badRequest(`${label} requires ${field}.`)
  return result
}

function optionalStringArray(value: Record<string, unknown>, field: string, label: string) {
  const result = value[field]
  if (result === undefined) return []
  if (!Array.isArray(result) || result.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw badRequest(`${label} has invalid ${field}.`)
  }
  return [...new Set(result)]
}

function requireNetworkUrl(value: string, label: string) {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password) {
    throw badRequest(`${label} must use HTTPS, except for loopback development URLs, and contain no userinfo.`)
  }
  return url.toString().replace(/\/$/, '')
}
