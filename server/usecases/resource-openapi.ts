import { badGateway, badRequest } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { ResourceScopeRegistry } from '@shared/api/authorization'
import { parse as parseYaml } from 'yaml'

const operationMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
const discoveryTimeoutMs = 5_000

export interface ResourceScopeDefinition {
  value: string
  description: string | null
}

export interface ResourceOperationDefinition {
  method: string
  path: string
  operationId: string | null
  summary: string | null
  description: string | null
  requiredScopeSets: string[][]
}

export interface ResourceContractDefinition {
  sourceUrl: string
  etag: string | null
  documentHash: string
  scopes: ResourceScopeDefinition[]
  operations: ResourceOperationDefinition[]
}

export function validateResourceUrl(resourceUrl: string) {
  const url = new URL(resourceUrl)
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]'
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password) {
    throw badRequest('Resource URL must use HTTPS, except for loopback development URLs, and contain no userinfo.')
  }
}

export async function validateResourceContract(deps: Deps, resourceUrl: string) {
  validateResourceUrl(resourceUrl)
  await readResourceContract(deps, resourceUrl)
}

export function validateRequestedScopes(registry: ResourceScopeRegistry | null, requestedScopes: string[]) {
  if (requestedScopes.length === 0) return
  const declaredScopes = new Set(registry?.scopes.map((scope) => scope.value) ?? [])
  if (requestedScopes.some((scope) => !declaredScopes.has(scope))) {
    throw badRequest('Requested scope is not declared by the Resource Server scope registry.')
  }
}

export async function readResourceContract(
  deps: Deps,
  resourceUrl: string,
  previousRegistry?: ResourceScopeRegistry | null,
): Promise<ResourceContractDefinition | null> {
  const resourceResponse = await fetchForDiscovery(
    deps,
    new Request(resourceUrl, {
      headers: { accept: 'application/json, application/problem+json, */*' },
    }),
    'resource',
    'Business resource could not be reached during OpenAPI discovery.',
  )
  if (!resourceResponse.ok) throw badRequest('Business resource discovery failed.')
  const documentUrl = serviceDescriptionUrl(resourceResponse.headers.get('link'), resourceUrl)
  const documentResponse = await fetchForDiscovery(
    deps,
    new Request(documentUrl, {
      headers: {
        accept: 'application/openapi+json, application/json, application/yaml, text/yaml',
        ...(previousRegistry?.discovery.etag && previousRegistry.discovery.sourceUrl === documentUrl
          ? { 'if-none-match': previousRegistry.discovery.etag }
          : {}),
      },
    }),
    'openapi_document',
    'Business resource OpenAPI document could not be reached.',
  )
  if (documentResponse.status === 304) return null
  if (!documentResponse.ok) throw badRequest('Business resource OpenAPI discovery failed.')

  const source = await documentResponse.text()
  const document = parseDocument(source, documentResponse.headers.get('content-type'))
  const scopes = extractResourceScopes(document)
  const operations = extractProtectedOperations(document)
  return {
    sourceUrl: documentUrl,
    etag: documentResponse.headers.get('etag'),
    documentHash: await hashDiscoveryData(scopes),
    scopes,
    operations,
  }
}

export async function synchronizeResourceScopeRegistry(
  deps: Deps,
  resourceUrl: string,
  previousRegistry: ResourceScopeRegistry | null,
  now = new Date(),
): Promise<ResourceScopeRegistry> {
  const contract = await readResourceContract(deps, resourceUrl, previousRegistry)
  if (!contract) {
    if (!previousRegistry) throw badRequest('Resource Server scope registry has not been synchronized.')
    return {
      ...previousRegistry,
      discovery: { ...previousRegistry.discovery, syncedAt: now.toISOString(), lastError: null },
    }
  }
  const previousModes = new Map(previousRegistry?.scopes.map((scope) => [scope.value, scope.grantMode]))
  return {
    discovery: {
      sourceUrl: contract.sourceUrl,
      etag: contract.etag,
      documentHash: contract.documentHash,
      syncedAt: now.toISOString(),
      lastError: null,
    },
    scopes: contract.scopes.map((scope) => ({
      ...scope,
      grantMode: previousModes.get(scope.value) ?? 'assigned',
    })),
  }
}

async function fetchForDiscovery(
  deps: Deps,
  request: Request,
  stage: 'resource' | 'openapi_document',
  message: string,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), discoveryTimeoutMs)
  try {
    return await Promise.race([
      deps.externalHttp.fetch(new Request(request, { signal: controller.signal })),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('discovery timeout')), { once: true })
      }),
    ])
  } catch {
    throw badGateway(message, { stage, url: request.url })
  } finally {
    clearTimeout(timeout)
  }
}

export function extractResourceScopes(document: unknown): ResourceScopeDefinition[] {
  const root = objectValue(document, 'Business resource OpenAPI document is invalid.')
  if (typeof root.openapi !== 'string' || !root.openapi.startsWith('3.')) {
    throw badRequest('Business resource must publish an OpenAPI 3.x document.')
  }

  const securitySchemes = objectValueOrEmpty(objectValueOrEmpty(root.components).securitySchemes)
  const scopeDescriptions = new Map<string, string | null>()
  for (const [name, candidate] of Object.entries(securitySchemes)) {
    const scheme = resolveSecurityScheme(candidate, securitySchemes)
    if (!scheme || scheme.type !== 'oauth2') continue
    void name
    for (const flow of Object.values(objectValueOrEmpty(scheme.flows))) {
      for (const [scope, description] of Object.entries(objectValueOrEmpty(objectValueOrEmpty(flow).scopes))) {
        if (!scope.trim() || typeof description !== 'string') {
          throw badRequest('OAuth scope declarations must use non-empty scope names and string descriptions.')
        }
        const normalizedDescription = description.trim() || null
        if (scopeDescriptions.has(scope) && scopeDescriptions.get(scope) !== normalizedDescription) {
          throw badRequest(`OAuth scope "${scope}" has inconsistent descriptions across flows.`)
        }
        scopeDescriptions.set(scope, normalizedDescription)
      }
    }
  }
  validateOperationScopeReferences(root, securitySchemes, new Set(scopeDescriptions.keys()))
  return [...scopeDescriptions]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, description]) => ({
      value,
      description,
    }))
}

export function extractProtectedOperations(document: unknown): ResourceOperationDefinition[] {
  const root = objectValue(document, 'Business resource OpenAPI document is invalid.')
  if (typeof root.openapi !== 'string' || !root.openapi.startsWith('3.')) {
    throw badRequest('Business resource must publish an OpenAPI 3.x document.')
  }

  const securitySchemes = objectValueOrEmpty(objectValueOrEmpty(root.components).securitySchemes)
  const scopeSchemeNames = new Set<string>()
  for (const [name, candidate] of Object.entries(securitySchemes)) {
    const scheme = resolveSecurityScheme(candidate, securitySchemes)
    if (scheme && (scheme.type === 'oauth2' || scheme.type === 'openIdConnect')) scopeSchemeNames.add(name)
  }

  const documentSecurity = securityRequirements(root.security)
  const operations: ResourceOperationDefinition[] = []
  for (const [pathName, candidate] of Object.entries(objectValueOrEmpty(root.paths))) {
    const path = objectValueOrEmpty(candidate)
    for (const method of operationMethods) {
      const operation = objectValueOrEmpty(path[method])
      if (Object.keys(operation).length === 0) continue
      const requirements = 'security' in operation ? securityRequirements(operation.security) : documentSecurity
      const requiredScopeSets = operationScopeSets(requirements, scopeSchemeNames)
      if (requiredScopeSets.length === 0) continue
      operations.push({
        method: method.toUpperCase(),
        path: pathName,
        operationId: stringValue(operation.operationId),
        summary: stringValue(operation.summary),
        description: stringValue(operation.description),
        requiredScopeSets,
      })
    }
  }
  return operations
}

function validateOperationScopeReferences(
  root: Record<string, unknown>,
  securitySchemes: Record<string, unknown>,
  declaredScopes: Set<string>,
) {
  const oauthSchemeNames = new Set(
    Object.entries(securitySchemes)
      .filter(([, candidate]) => resolveSecurityScheme(candidate, securitySchemes)?.type === 'oauth2')
      .map(([name]) => name),
  )
  const documentSecurity = securityRequirements(root.security)
  for (const pathItem of Object.values(objectValueOrEmpty(root.paths))) {
    const path = objectValueOrEmpty(pathItem)
    for (const method of operationMethods) {
      const operation = objectValueOrEmpty(path[method])
      if (Object.keys(operation).length === 0) continue
      const requirements = 'security' in operation ? securityRequirements(operation.security) : documentSecurity
      for (const requirement of requirements) {
        for (const [schemeName, values] of Object.entries(requirement)) {
          if (!oauthSchemeNames.has(schemeName) || !Array.isArray(values)) continue
          const undeclared = values.find(
            (value) => typeof value === 'string' && value.trim() && !declaredScopes.has(value),
          )
          if (undeclared) throw badRequest(`Operation security references undeclared OAuth scope "${undeclared}".`)
        }
      }
    }
  }
}

async function hashDiscoveryData(scopes: ResourceScopeDefinition[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(scopes))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function operationScopeSets(requirements: Record<string, unknown>[], schemeNames: Set<string>) {
  const unique = new Map<string, string[]>()
  for (const requirement of requirements) {
    const scopes = new Set<string>()
    let matchedScheme = false
    for (const [schemeName, values] of Object.entries(requirement)) {
      if (!schemeNames.has(schemeName) || !Array.isArray(values)) continue
      matchedScheme = true
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) scopes.add(value)
      }
    }
    const scopeSet = [...scopes].sort()
    if (matchedScheme) unique.set(scopeSet.join('\u0000'), scopeSet)
  }
  return [...unique.values()]
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function serviceDescriptionUrl(link: string | null, resourceUrl: string) {
  if (!link) throw badRequest('Business resource must advertise its OpenAPI document with a service-desc Link.')
  for (const match of link.matchAll(/<([^>]+)>([^,]*)/g)) {
    const parameters = match[2] ?? ''
    const relation = /;\s*rel\s*=\s*(?:"([^"]+)"|([^;\s,]+))/i.exec(parameters)
    const relations = (relation?.[1] ?? relation?.[2] ?? '').split(/\s+/)
    if (relations.includes('service-desc')) return new URL(match[1]!, resourceUrl).toString()
  }
  throw badRequest('Business resource must advertise its OpenAPI document with a service-desc Link.')
}

function parseDocument(source: string, contentType: string | null) {
  try {
    if (contentType?.includes('yaml') || contentType?.includes('yml')) return parseYaml(source)
    return JSON.parse(source)
  } catch {
    throw badRequest('Business resource OpenAPI document is invalid.')
  }
}

function resolveSecurityScheme(candidate: unknown, schemes: Record<string, unknown>) {
  const scheme = objectValueOrEmpty(candidate)
  if (typeof scheme.$ref !== 'string') return scheme
  const prefix = '#/components/securitySchemes/'
  if (!scheme.$ref.startsWith(prefix)) return null
  return objectValueOrEmpty(schemes[decodeURIComponent(scheme.$ref.slice(prefix.length))])
}

function securityRequirements(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(objectValueOrEmpty) : []
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(message)
  return value as Record<string, unknown>
}

function objectValueOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
