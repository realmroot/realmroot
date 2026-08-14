import { badGateway, badRequest } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { readResourceContract } from '@server/usecases/resource-openapi'
import type { ResourceScopeRegistry } from '@shared/api/authorization'

const discoveryTimeoutMs = 5_000

export interface ProtectedResourceMetadata {
  sourceUrl: string
  resource: string
  authorizationServers: string[]
  scopesSupported: string[]
  authorizationDetailsTypesSupported: string[]
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
    authorizationDetailsTypesSupported: stringArray(values.authorization_details_types_supported),
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
    },
  }
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
