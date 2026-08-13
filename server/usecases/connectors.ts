import {
  connectorCapabilities,
  connectorTemplates,
  isSupportedProvider,
} from '@server/domain/connectors/provider-templates'
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
    items: result.items.map(toResponse),
    pagination: paginationMetadata({ ...page, total: result.total }),
  }
}

export function listConnectorTemplates() {
  return { items: connectorTemplates }
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
  const authenticationEnabled = input.authenticationEnabled ?? true
  const resourceAuthorization =
    input.resourceAuthorization ?? legacyResourceAuthorizationInput(input, authenticationEnabled)
  assertResourceAuthorizationCapability(input.providerType, input.providerId, resourceAuthorization)
  const oidc =
    input.providerType === 'generic_oauth' && authenticationEnabled
      ? await prepareOidcConnector(deps, input, callbackOrigin, 'authentication')
      : null
  const resourceOidc = resourceAuthorization
    ? await prepareOidcConnector(
        deps,
        {
          ...resourceAuthorization,
          providerId: input.providerId,
          displayName: input.displayName,
        },
        callbackOrigin,
        'resourceAuthorization',
      )
    : null
  const now = new Date()
  const candidate = {
    id: deps.ids.generate(),
    slug: input.slug ?? input.providerId,
    providerType: input.providerType,
    providerId: input.providerId,
    displayName: input.displayName,
    enabled: input.enabled ?? true,
    authenticationEnabled,
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
    resourceAuthorizationEnabled: resourceAuthorization?.enabled ?? false,
    resourceClientId: resourceOidc?.clientId ?? null,
    resourceClientSecret: resourceOidc?.clientSecret ?? null,
    resourceClientSecretContext: null,
    resourceIssuer: resourceOidc?.issuer ?? null,
    resourceAuthorizationEndpoint: resourceOidc?.authorizationEndpoint ?? null,
    resourceTokenEndpoint: resourceOidc?.tokenEndpoint ?? null,
    resourceUserInfoEndpoint: resourceOidc?.userInfoEndpoint ?? null,
    resourceJwksEndpoint: resourceOidc?.jwksEndpoint ?? null,
    resourceRegistrationEndpoint: resourceOidc?.registrationEndpoint ?? null,
    resourceRevocationEndpoint: resourceOidc?.revocationEndpoint ?? null,
    resourceRegistrationMode: resourceAuthorization?.registrationMode ?? null,
    resourceRegistrationClientUri: resourceOidc?.registrationClientUri ?? null,
    resourceRegistrationAccessToken: resourceOidc?.registrationAccessToken ?? null,
    resourceRegistrationAccessTokenContext: null,
    resourceRegisteredScopes: resourceOidc?.registeredScopes ?? null,
    resourceClientGeneration: 1,
    resourceRetiredClientGenerations: null,
    resourceProviderMetadata: resourceOidc?.metadata ?? null,
    createdAt: now,
    updatedAt: now,
  }
  assertComplete(candidate)
  const connector = await deps.connectors.create(candidate)
  assertComplete(connector)
  return toResponse(connector)
}

export async function updateConnector(deps: Deps, id: string, input: UpdateConnectorRequest, callbackOrigin?: string) {
  const current = await deps.connectors.findById(id)
  if (!current) throw notFound('Connector not found.')

  assertResourceAuthorizationCapability(
    current.providerType as ConnectorProviderType,
    current.providerId,
    input.resourceAuthorization,
  )
  const resourceOidc = input.resourceAuthorization
    ? await prepareOidcConnector(
        deps,
        {
          ...input.resourceAuthorization,
          clientId: input.resourceAuthorization.clientId ?? current.resourceClientId ?? undefined,
          clientSecret: input.resourceAuthorization.clientSecret ?? current.resourceClientSecret ?? undefined,
          providerId: current.providerId,
          displayName: input.displayName ?? current.displayName,
        },
        callbackOrigin,
        'resourceAuthorization',
      )
    : null
  const resourcePatch =
    input.resourceAuthorization === undefined
      ? {}
      : {
          resourceAuthorizationEnabled: input.resourceAuthorization?.enabled ?? false,
          resourceClientId: resourceOidc?.clientId ?? null,
          resourceClientSecret: resourceOidc?.clientSecret ?? null,
          resourceIssuer: resourceOidc?.issuer ?? null,
          resourceAuthorizationEndpoint: resourceOidc?.authorizationEndpoint ?? null,
          resourceTokenEndpoint: resourceOidc?.tokenEndpoint ?? null,
          resourceUserInfoEndpoint: resourceOidc?.userInfoEndpoint ?? null,
          resourceJwksEndpoint: resourceOidc?.jwksEndpoint ?? null,
          resourceRegistrationEndpoint: resourceOidc?.registrationEndpoint ?? null,
          resourceRevocationEndpoint: resourceOidc?.revocationEndpoint ?? null,
          resourceRegistrationMode: input.resourceAuthorization?.registrationMode ?? null,
          resourceRegistrationClientUri: resourceOidc?.registrationClientUri ?? null,
          resourceRegistrationAccessToken: resourceOidc?.registrationAccessToken ?? null,
          resourceRegisteredScopes: resourceOidc?.registeredScopes ?? null,
          resourceClientGeneration: 1,
          resourceRetiredClientGenerations: null,
          resourceProviderMetadata: resourceOidc?.metadata ?? null,
        }
  const { resourceAuthorization: _, ...connectorInput } = input

  const candidate = {
    ...current,
    ...connectorInput,
    ...resourcePatch,
    updatedAt: new Date(),
  }
  assertComplete(candidate)

  const updated = await deps.connectors.update(id, {
    ...connectorInput,
    ...resourcePatch,
    updatedAt: candidate.updatedAt,
  })
  if (!updated) throw notFound('Connector not found.')
  if (input.resourceAuthorization !== undefined) {
    await deps.externalResources.revokeResourceAuthorizationsByConnector(id, candidate.updatedAt)
  }
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
    if (!connector.authenticationEnabled) continue
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

function assertResourceAuthorizationCapability(
  providerType: ConnectorProviderType,
  providerId: string,
  input: CreateConnectorRequest['resourceAuthorization'] | UpdateConnectorRequest['resourceAuthorization'],
) {
  if (input?.enabled && !connectorCapabilities(providerType, providerId).resourceAuthorization) {
    throw badRequest('Connector driver does not support resource authorization.')
  }
}

function legacyResourceAuthorizationInput(input: CreateConnectorRequest, authenticationEnabled: boolean) {
  if (input.providerType !== 'generic_oauth' || authenticationEnabled || !input.issuer) return null
  return {
    enabled: true,
    registrationMode: input.registrationMode ?? 'manual',
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    issuer: input.issuer,
  }
}

function assertComplete(connector: ConnectorRecord) {
  if (!connector.enabled) return
  assertSupportedProvider(connector.providerType as ConnectorProviderType, connector.providerId)
  if (connector.authenticationEnabled) {
    if (!connector.clientId) throw badRequest('Enabled authentication requires clientId.')
    if (!connector.clientSecret) throw badRequest('Enabled authentication requires clientSecret.')
    if (connector.providerType === 'social') assertSocialProviderComplete(connector)
    if (connector.providerType === 'generic_oauth') assertGenericOAuthComplete(connector)
  }
  if (connector.resourceAuthorizationEnabled) assertResourceAuthorizationComplete(connector)
}

function assertResourceAuthorizationComplete(connector: ConnectorRecord) {
  if (
    !connector.resourceClientId ||
    !connector.resourceClientSecret ||
    !connector.resourceIssuer ||
    !connector.resourceAuthorizationEndpoint ||
    !connector.resourceTokenEndpoint ||
    !connector.resourceUserInfoEndpoint ||
    !connector.resourceJwksEndpoint ||
    !connector.resourceRevocationEndpoint
  ) {
    throw badRequest('Enabled resource authorization requires a complete external OAuth client.')
  }
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
    authenticationEnabled: row.authenticationEnabled,
    capabilities: connectorCapabilities(row.providerType as ConnectorProviderType, row.providerId),
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
    resourceAuthorization: row.resourceIssuer
      ? {
          enabled: row.resourceAuthorizationEnabled,
          clientId: row.resourceClientId,
          clientSecretConfigured: Boolean(row.resourceClientSecret),
          issuer: row.resourceIssuer,
          authorizationEndpoint: row.resourceAuthorizationEndpoint,
          tokenEndpoint: row.resourceTokenEndpoint,
          userInfoEndpoint: row.resourceUserInfoEndpoint,
          jwksEndpoint: row.resourceJwksEndpoint,
          registrationEndpoint: row.resourceRegistrationEndpoint,
          revocationEndpoint: row.resourceRevocationEndpoint,
          registrationMode: row.resourceRegistrationMode as 'manual' | 'dynamic' | null,
          providerMetadata: row.resourceProviderMetadata ?? {},
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

type OidcConnectorInput = {
  issuer?: string
  registrationMode?: 'manual' | 'dynamic'
  clientId?: string
  clientSecret?: string
  providerId: string
  displayName: string
}

async function prepareOidcConnector(
  deps: Deps,
  input: OidcConnectorInput,
  callbackOrigin: string | undefined,
  purpose: 'authentication' | 'resourceAuthorization',
) {
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
    purpose,
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
  purpose: 'authentication' | 'resourceAuthorization',
) {
  const response = await deps.externalHttp.fetch(
    new Request(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(
        registrationRequest(origin, providerId, displayName, authorizationDetailsTypes, scopes, purpose),
      ),
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
  const generation = connector.resourceClientGeneration
  if (connector.resourceRegistrationMode !== 'dynamic') return generation
  if (
    !connector.resourceIssuer ||
    !connector.resourceRegistrationEndpoint ||
    !connector.resourceClientId ||
    !connector.resourceClientSecret
  ) {
    throw badRequest('Dynamic resource authorization client is incomplete.')
  }
  if (requiredScopes.every((scope) => connector.resourceRegisteredScopes?.includes(scope))) {
    if (!connector.resourceRegistrationClientUri || !connector.resourceRegistrationAccessToken) return generation
    const cachedRegistrationRequest = registrationRequest(
      callbackOrigin.replace(/\/$/, ''),
      connector.providerId,
      connector.displayName,
      optionalStringArray(
        connector.resourceProviderMetadata ?? {},
        'authorization_details_types_supported',
        'OIDC discovery response',
      ),
      connector.resourceRegisteredScopes ?? requiredScopes,
      'resourceAuthorization',
    )
    const response = await deps.externalHttp.fetch(
      new Request(requireNetworkUrl(connector.resourceRegistrationClientUri, 'registration client URI'), {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${connector.resourceRegistrationAccessToken}`,
        },
      }),
    )
    if (response.ok) {
      const body = await readObject(response, 'Dynamic OIDC client registration response is invalid.')
      if (
        requiredString(body, 'client_id', 'Dynamic OIDC client registration response') !== connector.resourceClientId
      ) {
        throw badRequest('Dynamic OIDC registration management changed the client identifier.')
      }
      const remoteScopes = typeof body.scope === 'string' ? scopeString(body.scope) : null
      if (
        remoteScopes &&
        requiredScopes.every((scope) => remoteScopes.includes(scope)) &&
        registrationMetadataMatches(body, cachedRegistrationRequest)
      ) {
        return generation
      }
    } else if (![401, 404, 405, 501].includes(response.status)) {
      throw badRequest('Dynamic OIDC client registration read failed.')
    }
  }

  const metadata = await fetchOidcMetadata(deps, connector.resourceIssuer)
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
    'resourceAuthorization',
  )

  if (connector.resourceRegistrationClientUri && connector.resourceRegistrationAccessToken) {
    const response = await deps.externalHttp.fetch(
      new Request(requireNetworkUrl(connector.resourceRegistrationClientUri, 'registration client URI'), {
        method: 'PUT',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${connector.resourceRegistrationAccessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ client_id: connector.resourceClientId, ...requestBody }),
      }),
    )
    if (response.ok) {
      const updated = registrationResponse(
        await readObject(response, 'Dynamic OIDC client registration update response is invalid.'),
        desiredScopes,
        {
          clientSecret: connector.resourceClientSecret,
          registrationClientUri: connector.resourceRegistrationClientUri,
          registrationAccessToken: connector.resourceRegistrationAccessToken,
        },
      )
      if (updated.clientId !== connector.resourceClientId) {
        throw badRequest('Dynamic OIDC registration management changed the client identifier.')
      }
      await deps.connectors.update(connector.id, {
        resourceClientSecret: updated.clientSecret,
        resourceRegistrationClientUri: updated.registrationClientUri,
        resourceRegistrationAccessToken: updated.registrationAccessToken,
        resourceRegisteredScopes: updated.registeredScopes,
        resourceProviderMetadata: metadata,
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
    connector.resourceRegistrationEndpoint,
    origin,
    connector.providerId,
    connector.displayName,
    authorizationDetailsTypes,
    desiredScopes,
    'resourceAuthorization',
  )
  const retired = {
    generation,
    clientId: connector.resourceClientId,
    encryptedClientSecret: await deps.secrets.seal(
      connector.resourceClientSecret,
      retiredResourceClientSecretContext(connector.id, generation),
    ),
    clientSecretContext: retiredResourceClientSecretContext(connector.id, generation),
    registrationClientUri: connector.resourceRegistrationClientUri ?? null,
    encryptedRegistrationAccessToken: connector.resourceRegistrationAccessToken
      ? await deps.secrets.seal(
          connector.resourceRegistrationAccessToken,
          retiredResourceRegistrationTokenContext(connector.id, generation),
        )
      : null,
    registrationAccessTokenContext: connector.resourceRegistrationAccessToken
      ? retiredResourceRegistrationTokenContext(connector.id, generation)
      : null,
    registeredScopes: connector.resourceRegisteredScopes ?? oidcClientBaseScopes,
  }
  const nextGeneration = generation + 1
  const rotated = await deps.connectors.rotateResourceClientGeneration(connector.id, generation, {
    resourceClientId: replacement.clientId,
    resourceClientSecret: replacement.clientSecret,
    resourceRegistrationClientUri: replacement.registrationClientUri,
    resourceRegistrationAccessToken: replacement.registrationAccessToken,
    resourceRegisteredScopes: replacement.registeredScopes,
    resourceClientGeneration: nextGeneration,
    resourceRetiredClientGenerations: [...(connector.resourceRetiredClientGenerations ?? []), retired],
    resourceProviderMetadata: metadata,
    updatedAt: new Date(),
  })
  if (!rotated) {
    const winner = await deps.connectors.findById(connector.id)
    if (
      winner &&
      winner.resourceClientGeneration > generation &&
      requiredScopes.every((scope) => winner.resourceRegisteredScopes?.includes(scope))
    ) {
      return winner.resourceClientGeneration
    }
    throw badRequest('Dynamic OIDC client registration changed concurrently; retry the authorization request.')
  }
  return nextGeneration
}

export async function refreshDynamicConnectorMetadata(deps: Deps, connectorId: string) {
  const connector = await deps.connectors.findById(connectorId)
  if (!connector) throw notFound('Connector not found.')
  if (connector.resourceRegistrationMode !== 'dynamic') return
  if (!connector.resourceIssuer) throw badRequest('Dynamic resource authorization client is incomplete.')

  const metadata = await fetchOidcMetadata(deps, connector.resourceIssuer)
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

  await deps.connectors.update(connector.id, {
    resourceAuthorizationEndpoint: authorizationEndpoint,
    resourceTokenEndpoint: tokenEndpoint,
    resourceUserInfoEndpoint: userInfoEndpoint,
    resourceJwksEndpoint: jwksEndpoint,
    resourceRegistrationEndpoint: registrationEndpoint,
    resourceRevocationEndpoint: revocationEndpoint,
    resourceProviderMetadata: metadata,
    updatedAt: new Date(),
  })
}

function registrationMetadataMatches(
  actual: Record<string, unknown>,
  expected: ReturnType<typeof registrationRequest>,
) {
  return (
    actual.client_name === expected.client_name &&
    actual.token_endpoint_auth_method === expected.token_endpoint_auth_method &&
    actual.jwks_uri === expected.jwks_uri &&
    sameStringSet(actual.redirect_uris, expected.redirect_uris) &&
    sameStringSet(actual.grant_types, expected.grant_types) &&
    sameStringSet(actual.response_types, expected.response_types) &&
    sameStringSet(
      actual.authorization_details_types,
      'authorization_details_types' in expected ? expected.authorization_details_types : undefined,
    )
  )
}

function sameStringSet(actual: unknown, expected: string[] | undefined) {
  if (expected === undefined) return actual === undefined
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== 'string')) return false
  const left = [...new Set(actual as string[])].sort()
  const right = [...new Set(expected)].sort()
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function registrationRequest(
  origin: string,
  providerId: string,
  displayName: string,
  authorizationDetailsTypes: string[],
  scopes: string[],
  purpose: 'authentication' | 'resourceAuthorization',
) {
  const resourceAuthorization = purpose === 'resourceAuthorization'
  return {
    client_name: `Realmroot ${displayName}`,
    redirect_uris: [
      resourceAuthorization
        ? `${origin}/oauth/account-connection/callback`
        : `${origin}/api/auth/callback/${encodeURIComponent(providerId)}`,
    ],
    grant_types: resourceAuthorization
      ? [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
          'urn:ietf:params:oauth:grant-type:token-exchange',
        ]
      : ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_basic',
    scope: scopes.join(' '),
    ...(resourceAuthorization ? { jwks_uri: `${origin}/api/auth/jwks` } : {}),
    ...(resourceAuthorization && authorizationDetailsTypes.length > 0
      ? { authorization_details_types: authorizationDetailsTypes }
      : {}),
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
  const version =
    metadata.authorization_details_catalog_version === undefined ? null : metadata.authorization_details_catalog_version
  if (Boolean(endpoint) !== Boolean(scope) || Boolean(endpoint) !== Boolean(version)) {
    throw badRequest(
      'OIDC discovery response must advertise authorization_details_catalog_endpoint, authorization_details_catalog_scope, and authorization_details_catalog_version together.',
    )
  }
  if (version !== null && version !== 1) {
    throw badRequest('OIDC discovery response advertises an unsupported authorization_details_catalog_version.')
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

function retiredResourceClientSecretContext(connectorId: string, generation: number) {
  return `connector:${connectorId}:resource-client-generation:${generation}:client-secret`
}

function retiredResourceRegistrationTokenContext(connectorId: string, generation: number) {
  return `connector:${connectorId}:resource-client-generation:${generation}:registration-token`
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
