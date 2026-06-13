import { connectorTemplates, isSupportedProvider } from '@server/domain/connectors/provider-templates'
import { badRequest, notFound } from '@server/domain/errors'
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

export async function createConnector(deps: Deps, input: CreateConnectorRequest) {
  assertSupportedProvider(input.providerType, input.providerId)
  await assertProviderAvailable(deps.connectors, input.providerId)
  const now = new Date()
  const candidate = {
    id: `idp_${crypto.randomUUID().replaceAll('-', '')}`,
    slug: input.slug ?? input.providerId,
    providerType: input.providerType,
    providerId: input.providerId,
    displayName: input.displayName,
    enabled: input.enabled ?? true,
    clientId: input.clientId ?? null,
    clientSecret: input.clientSecret ?? null,
    issuer: input.issuer ?? null,
    authorizationEndpoint: input.authorizationEndpoint ?? null,
    tokenEndpoint: input.tokenEndpoint ?? null,
    userInfoEndpoint: input.userInfoEndpoint ?? null,
    jwksEndpoint: input.jwksEndpoint ?? null,
    scopes: input.scopes ?? null,
    attributeMapping: null,
    providerMetadata: input.providerMetadata ?? null,
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
  await deps.connectors.delete(id)
}

export async function loadAuthConnectorConfig(repository: ConnectorRepository): Promise<AuthConnectorConfig> {
  const connectors = await repository.listEnabled()
  const socialProviders: Record<string, Record<string, unknown>> = {}
  const genericOAuthProviders: GenericOAuthProviderConfig[] = []
  const trustedProviders: string[] = []

  for (const connector of connectors) {
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
      discoveryUrl: connector.issuer
        ? `${connector.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
        : undefined,
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
  if (connector.issuer && hasAnyExplicitEndpoint(connector)) {
    throw badRequest('Enabled generic OAuth connector uses either issuer discovery or explicit endpoints, not both.')
  }
  if (!connector.issuer && !connector.authorizationEndpoint) {
    throw badRequest('Enabled generic OAuth connector requires issuer or authorizationEndpoint.')
  }
  if (!connector.issuer && !connector.tokenEndpoint) {
    throw badRequest('Enabled generic OAuth connector requires tokenEndpoint when issuer is not provided.')
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
  if (connector.issuer && hasAnyExplicitEndpoint(connector)) return false
  if (!connector.issuer && !connector.authorizationEndpoint) return false
  return Boolean(connector.issuer || connector.tokenEndpoint)
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
    const hasExplicitEndpoint = hasAnyExplicitEndpoint(connector)
    const requiredEndpointsConfigured = Boolean(connector.authorizationEndpoint && connector.tokenEndpoint)
    checks.push({
      key: 'oauthEndpoints',
      label: 'OAuth endpoints configured',
      ok: connector.issuer ? !hasExplicitEndpoint : requiredEndpointsConfigured,
      message: connector.issuer
        ? hasExplicitEndpoint
          ? 'Use issuer discovery or explicit endpoints, not both.'
          : 'Issuer discovery is configured.'
        : requiredEndpointsConfigured
          ? 'Explicit authorization and token endpoints are configured.'
          : 'Configure issuer discovery or explicit authorization and token endpoints.',
    })
  }

  return checks
}

function hasAnyExplicitEndpoint(connector: ConnectorRecord): boolean {
  return Boolean(
    connector.authorizationEndpoint || connector.tokenEndpoint || connector.userInfoEndpoint || connector.jwksEndpoint,
  )
}

function toResponse(row: ConnectorRecord): ConnectorResponse {
  return {
    id: row.id,
    slug: row.slug,
    providerType: row.providerType as ConnectorProviderType,
    providerId: row.providerId,
    displayName: row.displayName,
    enabled: row.enabled,
    clientId: row.clientId,
    clientSecretConfigured: Boolean(row.clientSecret),
    issuer: row.issuer,
    authorizationEndpoint: row.authorizationEndpoint,
    tokenEndpoint: row.tokenEndpoint,
    userInfoEndpoint: row.userInfoEndpoint,
    jwksEndpoint: row.jwksEndpoint,
    scopes: row.scopes ?? [],
    providerMetadata: row.providerMetadata ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
