import { badRequest } from '@server/domain/errors'
import type { ClientSecretRecord } from '@server/usecases/ports'
import {
  type ApplicationResponse,
  applicationGrantTypes,
  applicationScopeSchema,
  deviceCodeGrantType,
  managementApplicationScopes,
  type PaginationQuery,
} from '@shared/api/applications'

export function buildDeniedAuthorizationUrl(redirectUri: string, state: string | undefined) {
  const url = new URL(redirectUri)
  url.searchParams.set('error', 'access_denied')
  url.searchParams.set('error_description', 'The user denied the authorization request.')
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

export function normalizeClientSettings(
  clientType: ApplicationResponse['clientType'],
  redirectUris: string[],
  grantTypes: ApplicationResponse['allowedGrantTypes'] = ['authorization_code', 'refresh_token'],
  scopes: ApplicationResponse['allowedScopes'] = ['openid', 'profile', 'email'],
  options: { allowManagementScopes?: boolean } = {},
) {
  const normalizedGrantTypes = dedupe(grantTypes)
  const normalizedScopes = dedupe(scopes)
  const normalizedRedirectUris = dedupe(redirectUris)

  if (clientType !== 'confidential_web' && normalizedGrantTypes.includes('client_credentials')) {
    throw badRequest('Public clients cannot use the client_credentials grant.')
  }
  if (normalizedGrantTypes.includes(deviceCodeGrantType) && clientType !== 'public_native') {
    throw badRequest('Only public native clients can use the device-code grant.')
  }
  if (
    normalizedGrantTypes.includes('urn:ietf:params:oauth:grant-type:token-exchange') &&
    clientType !== 'confidential_web'
  ) {
    throw badRequest('Only confidential clients can use the token-exchange grant.')
  }
  if (normalizedGrantTypes.includes('refresh_token') && !normalizedScopes.includes('offline_access')) {
    normalizedScopes.push('offline_access')
  }
  for (const scope of normalizedScopes) {
    if (!applicationScopeSchema.safeParse(scope).success) {
      throw badRequest(`Unsupported scope: ${scope}`)
    }
    if (
      !options.allowManagementScopes &&
      managementApplicationScopes.includes(scope as (typeof managementApplicationScopes)[number])
    ) {
      throw badRequest('Management scopes are reserved for the system CLI client.')
    }
  }
  for (const grantType of normalizedGrantTypes) {
    if (!applicationGrantTypes.includes(grantType)) {
      throw badRequest(`Unsupported grant type: ${grantType}`)
    }
  }
  for (const redirectUri of normalizedRedirectUris) {
    validateRedirectUri(clientType, redirectUri)
  }

  return {
    redirectUris: normalizedRedirectUris,
    allowedGrantTypes: normalizedGrantTypes,
    allowedScopes: normalizedScopes,
  }
}

export function normalizePostLogoutRedirectUris(clientType: ApplicationResponse['clientType'], values: string[]) {
  const redirectUris = dedupe(values)
  for (const redirectUri of redirectUris) {
    validateRedirectUri(clientType, redirectUri, 'Post sign-out redirect URIs')
  }
  return redirectUris
}

export function normalizeCorsOrigins(values: string[]) {
  const origins = dedupe(values)
  for (const origin of origins) {
    validateCorsOrigin(origin)
  }
  return origins
}

export function defaultPagination(): PaginationQuery {
  return { limit: 50, offset: 0 }
}

export function normalizeRequestedScopes(
  scope: string | undefined,
  allowedScopes: ApplicationResponse['allowedScopes'],
) {
  const requestedScopes = dedupe(
    (scope || 'openid').split(/\s+/).filter(Boolean) as ApplicationResponse['allowedScopes'],
  )
  for (const requestedScope of requestedScopes) {
    if (!allowedScopes.includes(requestedScope)) {
      throw badRequest(`Scope is not allowed for this client: ${requestedScope}`)
    }
  }
  return requestedScopes
}

export function validateRedirectUri(
  clientType: ApplicationResponse['clientType'],
  value: string,
  label = 'Redirect URIs',
) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw badRequest(`${label} must be absolute URLs.`)
  }

  if (url.hash) {
    throw badRequest(`${label} must not include fragments.`)
  }
  if (clientType === 'public_native' && url.protocol !== 'https:' && url.protocol !== 'http:') {
    validateNativeRedirectScheme(url.protocol)
    return
  }

  const localhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]'
  if (url.protocol === 'https:' || (localhost && url.protocol === 'http:')) {
    return
  }

  throw badRequest(`${label} must use HTTPS except localhost development URLs.`)
}

export function validateCorsOrigin(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw badRequest('CORS origins must be absolute origins.')
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw badRequest('CORS origins must include scheme, host, and optional port only.')
  }

  const localhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]'
  if (url.protocol === 'https:' || (localhost && url.protocol === 'http:')) {
    return
  }

  throw badRequest('CORS origins must use HTTPS except localhost development origins.')
}

export function validateNativeRedirectScheme(protocol: string) {
  const scheme = protocol.slice(0, -1).toLowerCase()
  if (['javascript', 'data', 'vbscript', 'file', 'about', 'blob'].includes(scheme)) {
    throw badRequest('Native redirect URI schemes are not allowed to be executable or local-resource schemes.')
  }
  if (!/^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+$/.test(scheme)) {
    throw badRequest('Native redirect URI schemes must use a reverse-domain private-use scheme.')
  }
}

export function toSecretMetadata(secret: ClientSecretRecord) {
  return {
    id: secret.id,
    version: secret.version,
    prefix: secret.secretPrefix,
    status: secret.status,
    createdAt: secret.createdAt.toISOString(),
    expiresAt: secret.expiresAt?.toISOString() ?? null,
    revokedAt: secret.revokedAt?.toISOString() ?? null,
  }
}

export function dedupe<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function createClientSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `fas_${base64Url(bytes)}`
}

export async function hashProviderSecret(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return base64Url(new Uint8Array(digest))
}

export function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) {
    value += String.fromCharCode(byte)
  }
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
