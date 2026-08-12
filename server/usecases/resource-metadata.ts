import { badGateway, badRequest } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { readResourceContract } from '@server/usecases/resource-openapi'
import { brokeredAccountConnectionSchema, type ResourceScopeRegistry } from '@shared/api/authorization'

const discoveryTimeoutMs = 5_000

export interface ProtectedResourceMetadata {
  sourceUrl: string
  resource: string
  authorizationServers: string[]
  scopesSupported: string[]
  accountConnection: {
    mode: 'brokered'
    authorizationEndpoint: string
    tokenEndpoint: string
    revocationEndpoint?: string | null
    authorizationDetailsEndpoint?: string | null
  } | null
  etag: string | null
}

export async function readProtectedResourceMetadata(
  deps: Deps,
  resourceUrl: string,
): Promise<ProtectedResourceMetadata> {
  const sourceUrl = protectedResourceMetadataUrl(resourceUrl)
  const response = await fetchMetadata(deps, sourceUrl)
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (response.status !== 200 || mediaType !== 'application/json') {
    throw badGateway('Protected resource metadata returned an invalid response.', {
      stage: 'protected_resource_metadata',
      url: sourceUrl,
      status: response.status,
    })
  }
  const metadata = await response.json().catch(() => null)
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw badGateway('Protected resource metadata returned an invalid response.', {
      stage: 'protected_resource_metadata',
      url: sourceUrl,
      status: response.status,
    })
  }
  const values = metadata as Record<string, unknown>
  if (values.resource !== resourceUrl) {
    throw badRequest('Protected resource metadata does not match the configured resource URL.')
  }
  const scopesSupported = scopeArray(values.scopes_supported)
  if (!scopesSupported) {
    throw badRequest('Protected resource metadata must advertise at least one valid scope.')
  }
  return {
    sourceUrl,
    resource: resourceUrl,
    authorizationServers: stringArray(values.authorization_servers),
    scopesSupported,
    accountConnection: readAccountConnection(values),
    etag: response.headers.get('etag'),
  }
}

export async function synchronizeResourceDiscovery(
  deps: Deps,
  resourceUrl: string,
  previousRegistry: ResourceScopeRegistry | null,
  protectedMetadata?: ProtectedResourceMetadata,
  now = new Date(),
): Promise<{ name: string; description: string | null; scopeRegistry: ResourceScopeRegistry }> {
  const metadata = protectedMetadata ?? (await readProtectedResourceMetadata(deps, resourceUrl))
  const contract = await readResourceContract(deps, resourceUrl)
  if (!contract) throw new Error('Unconditional Resource Server contract read returned no document.')

  const descriptions = new Map(contract.scopes.map((scope) => [scope.value, scope.description]))
  const previousModes = new Map(previousRegistry?.scopes.map((scope) => [scope.value, scope.grantMode]))
  const scopes = metadata.scopesSupported.map((value) => ({
    value,
    description: descriptions.get(value) ?? null,
    grantMode: previousModes.get(value) ?? ('assigned' as const),
  }))
  return {
    name: contract.name,
    description: contract.description,
    scopeRegistry: {
      discovery: {
        sourceUrl: metadata.sourceUrl,
        etag: metadata.etag,
        documentHash: await hashScopeRegistry(scopes.map(({ value, description }) => ({ value, description }))),
        syncedAt: now.toISOString(),
        lastError: null,
      },
      scopes,
      accountConnection: metadata.accountConnection,
    },
  }
}

function readAccountConnection(values: Record<string, unknown>) {
  const modes = stringArray(values.account_connection_modes_supported)
  const authorizationEndpoint = values.account_connection_authorization_endpoint
  const tokenEndpoint = values.account_connection_token_endpoint
  const revocationEndpoint = values.account_connection_revocation_endpoint
  const authorizationDetailsEndpoint = values.account_connection_authorization_details_endpoint
  if (
    modes.length === 0 &&
    authorizationEndpoint === undefined &&
    tokenEndpoint === undefined &&
    revocationEndpoint === undefined &&
    authorizationDetailsEndpoint === undefined
  ) {
    return null
  }
  if (!modes.includes('brokered') || typeof authorizationEndpoint !== 'string' || typeof tokenEndpoint !== 'string') {
    throw badRequest('Brokered account connection metadata is incomplete.')
  }
  if (revocationEndpoint !== undefined && typeof revocationEndpoint !== 'string') {
    throw badRequest('Brokered account connection revocation endpoint is invalid.')
  }
  if (authorizationDetailsEndpoint !== undefined && typeof authorizationDetailsEndpoint !== 'string') {
    throw badRequest('Brokered account connection authorization details endpoint is invalid.')
  }
  return brokeredAccountConnectionSchema.parse({
    mode: 'brokered',
    authorizationEndpoint: brokerEndpoint(authorizationEndpoint),
    tokenEndpoint: brokerEndpoint(tokenEndpoint),
    revocationEndpoint: revocationEndpoint ? brokerEndpoint(revocationEndpoint) : null,
    authorizationDetailsEndpoint: authorizationDetailsEndpoint ? brokerEndpoint(authorizationDetailsEndpoint) : null,
  })
}

function brokerEndpoint(value: string) {
  if (!URL.canParse(value)) throw badRequest('Brokered account connection endpoint is invalid.')
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password) {
    throw badRequest('Brokered account connection endpoints must use HTTPS or loopback HTTP and contain no userinfo.')
  }
  return url.toString()
}

export function protectedResourceMetadataUrl(resourceUrl: string) {
  const resource = new URL(resourceUrl)
  const path = resource.pathname === '/' ? '' : resource.pathname
  const metadata = new URL(`/.well-known/oauth-protected-resource${path}`, resource.origin)
  metadata.search = resource.search
  return metadata.toString()
}

async function fetchMetadata(deps: Deps, url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), discoveryTimeoutMs)
  try {
    return await Promise.race([
      deps.externalHttp.fetch(new Request(url, { headers: { accept: 'application/json' }, signal: controller.signal })),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('discovery timeout')), { once: true })
      }),
    ])
  } catch {
    throw badGateway('Protected resource metadata could not be reached.', {
      stage: 'protected_resource_metadata',
      url,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function scopeArray(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((scope) => typeof scope !== 'string' || !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope))
  ) {
    return null
  }
  return [...new Set(value)].sort()
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}

async function hashScopeRegistry(scopes: Array<{ value: string; description: string | null }>) {
  const bytes = new TextEncoder().encode(JSON.stringify(scopes))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
