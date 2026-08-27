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
const tokenExchangeSourceResourceServerIdsMetadataKey = 'tokenExchangeSourceResourceServerIds'

export function toApplicationInsert(input: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>, now: Date) {
  return {
    id: input.id,
    oauthClientId: input.clientId,
    slug: input.slug,
    name: input.name,
    description: input.description,
    homepageUrl: input.homepageUrl,
    ownerOrganizationId: input.ownerOrganizationId,
    visibility: input.visibility,
    oidcScopes: input.oidcScopes,
    resourceScopes: input.resourceScopes,
    consentRequired: input.consentRequired,
    disabled: input.disabled,
    disabledReason: input.disabledReason,
    metadata: writeApplicationMetadata(null, {
      iconUrl: input.iconUrl,
      corsOrigins: input.corsOrigins.length > 0 ? input.corsOrigins : undefined,
      customData: Object.keys(input.customData).length > 0 ? input.customData : undefined,
      oidcClaims: input.oidcClaims,
      tokenExchangeSourceResourceServerIds:
        input.tokenExchangeSourceResourceServerIds && input.tokenExchangeSourceResourceServerIds.length > 0
          ? input.tokenExchangeSourceResourceServerIds
          : undefined,
    }),
    createdAt: now,
    updatedAt: now,
  }
}

export function toOAuthClientInsert(
  input: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>,
  clientSecret: string | null,
  now: Date,
  id: string,
) {
  return {
    id,
    clientId: input.clientId,
    clientSecret,
    disabled: input.disabled,
    skipConsent: !input.consentRequired,
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
    scopes: serializeList([
      ...input.oidcScopes,
      ...new Set(input.resourceScopes.flatMap((resource) => resource.scopes)),
    ]),
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
    visibility: app.visibility,
    consentRequired: app.consentRequired,
    disabled: app.disabled || !!client.disabled,
    disabledReason: app.disabledReason,
    ownerOrganizationId: app.ownerOrganizationId,
    redirectUris: parseList(client.redirectUris),
    postLogoutRedirectUris: parseList(client.postLogoutRedirectUris),
    corsOrigins: readCorsOrigins(app.metadata),
    customData: readCustomData(app.metadata),
    oidcClaims: readOidcClaims(app.metadata),
    allowedGrantTypes: parseList(client.grantTypes).filter(isGrantType),
    oidcScopes: app.oidcScopes,
    resourceScopes: app.resourceScopes,
    tokenExchangeSourceResourceServerIds: readTokenExchangeSourceResourceServerIds(app.metadata),
    requirePkce: client.requirePKCE ?? false,
    tokenEndpointAuthMethod: toTokenEndpointAuthMethod(client.tokenEndpointAuthMethod),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  }
}

export function toConsent(row: typeof applicationConsent.$inferSelect): ConsentRecord {
  return {
    id: row.id,
    resourceServerId: row.resourceServerId,
    scopes: row.scopes,
    authorizationSource: row.authorizationSource,
    grantedAt: row.grantedAt,
  }
}

function readTokenExchangeSourceResourceServerIds(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
  const value = (metadata as Record<string, unknown>)[tokenExchangeSourceResourceServerIdsMetadataKey]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
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

export function readClaimSelection(value: unknown): ApplicationOidcClaims['accessToken'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return {
    ...(input.authorization === true ? { authorization: true } : {}),
    ...(input.scopes === true ? { scopes: true } : {}),
    ...(input.groups === true ? { groups: true } : {}),
    ...(input.roles === true ? { roles: true } : {}),
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
    tokenExchangeSourceResourceServerIds?: string[]
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
  if (patch.tokenExchangeSourceResourceServerIds !== undefined) {
    next[tokenExchangeSourceResourceServerIdsMetadataKey] = patch.tokenExchangeSourceResourceServerIds
  }
  return Object.keys(next).length ? next : null
}

export function toClientType(value: string | null): ApplicationAggregate['clientType'] {
  if (value === 'public_spa' || value === 'public_native' || value === 'confidential_web' || value === 'machine') {
    return value
  }
  throw new Error(`Unsupported Application type: ${value ?? 'null'}`)
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
