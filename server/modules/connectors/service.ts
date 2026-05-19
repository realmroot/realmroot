import type { GenericOAuthConfig } from 'better-auth/plugins'
import type {
  ConnectorProviderType,
  ConnectorReadinessResponse,
  ConnectorResponse,
  CreateConnectorRequest,
  UpdateConnectorRequest,
} from '../../../shared/api/connectors'
import { paginationMetadata } from '../../../shared/api/pagination'
import type { Env } from '../../../shared/env'
import { badRequest, notFound } from '../../lib/errors'
import { connectorTemplates, isSupportedProvider } from './provider-templates'
import type { ConnectorRepository, ConnectorRow } from './repository'

export interface AuthConnectorConfig {
  trustedProviders: string[]
  socialProviders: Record<string, Record<string, unknown>>
  genericOAuthProviders: GenericOAuthConfig[]
  cacheKey: string
}

export class ConnectorService {
  constructor(private readonly repository: ConnectorRepository) {}

  async list(page: { limit: number; offset: number }) {
    const result = await this.repository.list(page)
    return {
      connectors: result.items.map(toResponse),
      pagination: paginationMetadata({ ...page, total: result.total }),
    }
  }

  listTemplates() {
    return { templates: connectorTemplates }
  }

  async get(id: string) {
    const connector = await this.repository.findById(id)
    if (!connector) throw notFound('Connector not found.')
    return toResponse(connector)
  }

  async readiness(id: string, env: Env): Promise<ConnectorReadinessResponse> {
    const connector = await this.repository.findById(id)
    if (!connector) throw notFound('Connector not found.')

    const checks = connectorReadinessChecks(connector, env)
    return {
      connectorId: connector.id,
      ready: checks.every((check) => check.ok),
      checks,
    }
  }

  async create(input: CreateConnectorRequest) {
    assertSupportedProvider(input.providerType, input.providerId)
    await assertProviderAvailable(this.repository, input.providerId)
    const now = new Date()
    const candidate = {
      id: `idp_${crypto.randomUUID().replaceAll('-', '')}`,
      slug: input.slug ?? input.providerId,
      providerType: input.providerType,
      providerId: input.providerId,
      displayName: input.displayName,
      enabled: input.enabled ?? true,
      clientId: input.clientId ?? null,
      clientSecretBinding: input.clientSecretBinding ?? null,
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
    const connector = await this.repository.create(candidate)
    assertComplete(connector)
    return toResponse(connector)
  }

  async update(id: string, input: UpdateConnectorRequest) {
    const current = await this.repository.findById(id)
    if (!current) throw notFound('Connector not found.')

    const candidate = {
      ...current,
      ...input,
      updatedAt: new Date(),
    }
    assertComplete(candidate)

    const updated = await this.repository.update(id, {
      ...input,
      updatedAt: candidate.updatedAt,
    })
    if (!updated) throw notFound('Connector not found.')
    assertComplete(updated)
    return toResponse(updated)
  }

  async delete(id: string) {
    const current = await this.repository.findById(id)
    if (!current) throw notFound('Connector not found.')
    await this.repository.delete(id)
  }
}

export async function loadAuthConnectorConfig(repository: ConnectorRepository, env: Env): Promise<AuthConnectorConfig> {
  const connectors = await repository.listEnabled()
  const socialProviders: Record<string, Record<string, unknown>> = {}
  const genericOAuthProviders: GenericOAuthConfig[] = []
  const trustedProviders: string[] = []

  for (const connector of connectors) {
    assertSupportedProvider(connector.providerType as ConnectorProviderType, connector.providerId)
    assertComplete(connector)
    const clientId = connector.clientId
    if (!clientId) throw badRequest('Enabled connector requires clientId.')
    const clientSecret = readSecret(env, connector.clientSecretBinding)
    trustedProviders.push(connector.providerId)

    if (connector.providerType === 'social') {
      socialProviders[connector.providerId] = {
        ...connector.providerMetadata,
        clientId,
        clientSecret,
        scope: connector.scopes ?? undefined,
        issuer: connector.issuer ?? undefined,
      }
      continue
    }

    genericOAuthProviders.push({
      ...connector.providerMetadata,
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
        secretBinding: connector.clientSecretBinding,
      })),
    ),
  }
}

function assertSupportedProvider(providerType: ConnectorProviderType, providerId: string) {
  if (!isSupportedProvider(providerType, providerId)) {
    throw badRequest('Unsupported social provider.')
  }
}

function assertComplete(connector: ConnectorRow) {
  if (!connector.enabled) return
  if (!connector.clientId) throw badRequest('Enabled connector requires clientId.')
  if (!connector.clientSecretBinding) throw badRequest('Enabled connector requires clientSecretBinding.')
  assertSupportedProvider(connector.providerType as ConnectorProviderType, connector.providerId)
  if (connector.providerType === 'social') assertSocialProviderComplete(connector)
  if (connector.providerType === 'generic_oauth') assertGenericOAuthComplete(connector)
}

async function assertProviderAvailable(repository: ConnectorRepository, providerId: string) {
  const existing = await repository.findByProviderId(providerId)
  if (existing) throw badRequest('Connector provider is already configured.')
}

function assertSocialProviderComplete(connector: ConnectorRow) {
  if (connector.providerId !== 'cognito') return

  const metadata = connector.providerMetadata ?? {}
  for (const field of ['domain', 'region', 'userPoolId']) {
    if (typeof metadata[field] !== 'string' || metadata[field].length === 0) {
      throw badRequest(`Enabled Cognito connector requires providerMetadata.${field}.`)
    }
  }
}

function assertGenericOAuthComplete(connector: ConnectorRow) {
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

function connectorReadinessChecks(connector: ConnectorRow, env: Env) {
  const secretValue = connector.clientSecretBinding ? env[connector.clientSecretBinding] : undefined
  const secretAvailable = typeof secretValue === 'string' && secretValue.length > 0
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
      key: 'clientSecretBinding',
      label: 'Secret binding configured',
      ok: Boolean(connector.clientSecretBinding),
      message: connector.clientSecretBinding
        ? 'Secret binding name is configured.'
        : 'Client secret binding name is missing.',
    },
    {
      key: 'clientSecretAvailable',
      label: 'Secret binding available',
      ok: secretAvailable,
      message:
        connector.clientSecretBinding && secretAvailable
          ? 'Secret binding is available in the runtime.'
          : 'Secret binding is not available in the runtime.',
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

function hasAnyExplicitEndpoint(connector: ConnectorRow): boolean {
  return Boolean(
    connector.authorizationEndpoint || connector.tokenEndpoint || connector.userInfoEndpoint || connector.jwksEndpoint,
  )
}

function readSecret(env: Env, binding: string | null): string {
  if (!binding) throw badRequest('Enabled connector requires clientSecretBinding.')
  const value = env[binding]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`OAuth connector secret binding is not configured: ${binding}`)
  }
  return value
}

function toResponse(row: ConnectorRow): ConnectorResponse {
  return {
    id: row.id,
    slug: row.slug,
    providerType: row.providerType as ConnectorProviderType,
    providerId: row.providerId,
    displayName: row.displayName,
    enabled: row.enabled,
    clientId: row.clientId,
    clientSecretBinding: row.clientSecretBinding,
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
