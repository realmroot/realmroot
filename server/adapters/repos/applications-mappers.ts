import type { ApplicationAggregate, ConsentRecord } from '@server/usecases/ports'
import {
  type ApplicationOidcClaims,
  defaultApplicationOidcClaims,
  deviceCodeGrantType,
  tokenExchangeGrantType,
} from '../../../shared/api/applications'
import type { application, applicationConsent, oauthClient } from '../../db/schema'

type ApplicationRow = typeof application.$inferSelect
type OAuthClientRow = typeof oauthClient.$inferSelect
const corsOriginsMetadataKey = 'corsOrigins'
const customDataMetadataKey = 'customData'
const iconUrlMetadataKey = 'iconUrl'
const oidcClaimsMetadataKey = 'oidcClaims'
const systemManagedMetadataKey = 'systemManaged'

export function toApplicationInsert(input: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>, now: Date) {
  return {
    id: input.id,
    oauthClientId: input.clientId,
    slug: input.slug,
    name: input.name,
    description: input.description,
    homepageUrl: input.homepageUrl,
    firstParty: input.firstParty,
    trusted: input.trusted,
    disabled: input.disabled,
    disabledReason: input.disabledReason,
    metadata: writeApplicationMetadata(null, {
      iconUrl: input.iconUrl,
      corsOrigins: input.corsOrigins.length > 0 ? input.corsOrigins : undefined,
      customData: Object.keys(input.customData).length > 0 ? input.customData : undefined,
      oidcClaims: input.oidcClaims,
      systemManaged: input.systemManaged,
    }),
    createdAt: now,
    updatedAt: now,
  }
}

export function toOAuthClientInsert(
  input: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>,
  clientSecret: string | null,
  now: Date,
) {
  return {
    id: `oauth_${crypto.randomUUID().replaceAll('-', '')}`,
    clientId: input.clientId,
    clientSecret,
    disabled: input.disabled,
    skipConsent: input.trusted,
    enableEndSession: true,
    name: input.name,
    uri: input.homepageUrl,
    icon: input.iconUrl,
    redirectUris: serializeList(input.redirectUris),
    postLogoutRedirectUris: serializeList(input.postLogoutRedirectUris),
    tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
    grantTypes: serializeList(input.allowedGrantTypes),
    responseTypes: serializeList(['code']),
    public: input.public,
    type: input.clientType,
    requirePKCE: input.requirePkce,
    scopes: serializeList(input.allowedScopes),
    metadata: JSON.stringify({ applicationId: input.id, oidcClaims: input.oidcClaims }),
    createdAt: now,
    updatedAt: now,
  }
}

export function toAggregate(app: ApplicationRow, client: OAuthClientRow): ApplicationAggregate {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    homepageUrl: app.homepageUrl,
    iconUrl: client.icon ?? readIconUrl(app.metadata),
    clientId: client.clientId,
    clientType: toClientType(client.type),
    public: client.public ?? false,
    firstParty: app.firstParty,
    trusted: app.trusted,
    systemManaged: readSystemManaged(app.metadata),
    disabled: app.disabled || !!client.disabled,
    disabledReason: app.disabledReason,
    redirectUris: parseList(client.redirectUris),
    postLogoutRedirectUris: parseList(client.postLogoutRedirectUris),
    corsOrigins: readCorsOrigins(app.metadata),
    customData: readCustomData(app.metadata),
    oidcClaims: readOidcClaims(app.metadata),
    allowedGrantTypes: parseList(client.grantTypes).filter(isGrantType),
    allowedScopes: parseList(client.scopes).filter(isScope),
    requirePkce: client.requirePKCE ?? false,
    tokenEndpointAuthMethod: toTokenEndpointAuthMethod(client.tokenEndpointAuthMethod),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  }
}

export function toConsent(row: typeof applicationConsent.$inferSelect): ConsentRecord {
  return {
    id: row.id,
    scopes: row.scopes.filter(isScope),
    grantedAt: row.grantedAt,
  }
}

export function toPaginationMetadata(pagination: { limit: number; offset: number }, total: number) {
  const nextOffset = pagination.offset + pagination.limit < total ? pagination.offset + pagination.limit : null

  return {
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    hasMore: nextOffset !== null,
    nextOffset,
  }
}

export function serializeList(values: readonly string[]) {
  return JSON.stringify(values)
}

export function parseList(value: string | null): string[] {
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

export function readIconUrl(metadata: unknown) {
  return typeof metadata === 'object' &&
    metadata !== null &&
    iconUrlMetadataKey in metadata &&
    typeof metadata[iconUrlMetadataKey] === 'string'
    ? metadata[iconUrlMetadataKey]
    : null
}

export function readCorsOrigins(metadata: unknown) {
  return readStringListMetadata(metadata, corsOriginsMetadataKey)
}

export function readCustomData(metadata: unknown) {
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    customDataMetadataKey in metadata &&
    typeof metadata[customDataMetadataKey] === 'object' &&
    metadata[customDataMetadataKey] !== null &&
    !Array.isArray(metadata[customDataMetadataKey])
  ) {
    return metadata[customDataMetadataKey] as Record<string, unknown>
  }
  return {}
}

export function readOidcClaims(metadata: unknown): ApplicationOidcClaims {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !(oidcClaimsMetadataKey in metadata) ||
    typeof metadata[oidcClaimsMetadataKey] !== 'object' ||
    metadata[oidcClaimsMetadataKey] === null ||
    Array.isArray(metadata[oidcClaimsMetadataKey])
  ) {
    return defaultApplicationOidcClaims
  }
  const value = metadata[oidcClaimsMetadataKey] as Record<string, unknown>
  return {
    accessToken: readClaimSelection(value.accessToken),
    idToken: readClaimSelection(value.idToken),
    userInfo: readClaimSelection(value.userInfo),
  }
}

export function readSystemManaged(metadata: unknown) {
  return Boolean(
    typeof metadata === 'object' &&
      metadata !== null &&
      systemManagedMetadataKey in metadata &&
      metadata[systemManagedMetadataKey] === true,
  )
}

export function readClaimSelection(value: unknown): ApplicationOidcClaims['accessToken'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return {
    ...(input.authorization === true ? { authorization: true } : {}),
    ...(input.scopes === true ? { scopes: true } : {}),
    ...(input.roles === true ? { roles: true } : {}),
    ...(input.permissions === true ? { permissions: true } : {}),
    ...(input.organizationId === true ? { organizationId: true } : {}),
    ...(input.organizationName === true ? { organizationName: true } : {}),
  }
}

export function readStringListMetadata(metadata: unknown, key: string) {
  if (typeof metadata !== 'object' || metadata === null || !(key in metadata)) return []
  const value = (metadata as Record<string, unknown>)[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function writeApplicationMetadata(
  current: Record<string, unknown> | null,
  patch: {
    iconUrl?: string | null
    corsOrigins?: string[]
    customData?: Record<string, unknown>
    oidcClaims?: ApplicationOidcClaims
    systemManaged?: boolean
  },
) {
  const next = { ...(current ?? {}) }
  if (patch.iconUrl !== undefined) {
    if (patch.iconUrl) next[iconUrlMetadataKey] = patch.iconUrl
    else delete next[iconUrlMetadataKey]
  }
  if (patch.corsOrigins !== undefined) next[corsOriginsMetadataKey] = patch.corsOrigins
  if (patch.customData !== undefined) next[customDataMetadataKey] = patch.customData
  if (patch.oidcClaims !== undefined) next[oidcClaimsMetadataKey] = patch.oidcClaims
  if (patch.systemManaged !== undefined) {
    if (patch.systemManaged) next[systemManagedMetadataKey] = true
    else delete next[systemManagedMetadataKey]
  }
  return Object.keys(next).length ? next : null
}

export function toClientType(value: string | null): ApplicationAggregate['clientType'] {
  if (value === 'public_spa' || value === 'public_native' || value === 'confidential_web') return value
  return 'confidential_web'
}

export function toTokenEndpointAuthMethod(value: string | null): ApplicationAggregate['tokenEndpointAuthMethod'] {
  if (value === 'none' || value === 'client_secret_basic' || value === 'client_secret_post') return value
  return 'client_secret_basic'
}

export function isGrantType(value: string): value is ApplicationAggregate['allowedGrantTypes'][number] {
  return (
    value === 'authorization_code' ||
    value === 'refresh_token' ||
    value === 'client_credentials' ||
    value === deviceCodeGrantType ||
    value === tokenExchangeGrantType
  )
}

export function isScope(value: string): value is ApplicationAggregate['allowedScopes'][number] {
  return (
    value === 'openid' ||
    value === 'profile' ||
    value === 'email' ||
    value === 'offline_access' ||
    value === 'management:read' ||
    value === 'management:write' ||
    /^[A-Za-z0-9._-]+:[A-Za-z0-9:._-]{1,119}$/.test(value)
  )
}
