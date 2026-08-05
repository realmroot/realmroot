const resourceRoutePrefixes = {
  applications: ['applications'],
  users: ['users'],
  organizations: ['organizations'],
  roles: [],
  apiResources: ['resource-servers'],
  connectors: ['connectors'],
  settings: ['realm'],
  security: [],
  webhooks: ['webhooks'],
  agents: ['agents', 'access'],
  auditEvents: [],
  readiness: [],
} as const

export type ProtectedResource = keyof typeof resourceRoutePrefixes

export const protectedResourceScopes = [
  'applications:read',
  'applications:write',
  'users:read',
  'users:write',
  'organizations:read',
  'organizations:write',
  'roles:read',
  'roles:write',
  'resource-servers:read',
  'resource-servers:write',
  'connectors:read',
  'connectors:write',
  'settings:read',
  'settings:write',
  'security:read',
  'security:write',
  'webhooks:read',
  'webhooks:write',
  'agents:read',
  'agents:write',
  'audit-events:read',
  'readiness:read',
] as const

export type ProtectedResourceScope = (typeof protectedResourceScopes)[number]

export function isProtectedResourceScope(value: string): value is ProtectedResourceScope {
  return protectedResourceScopes.includes(value as ProtectedResourceScope)
}

export const resourceByRoutePrefix = Object.fromEntries(
  Object.entries(resourceRoutePrefixes).flatMap(([resource, prefixes]) => prefixes.map((prefix) => [prefix, resource])),
) as Record<string, ProtectedResource>

export function protectedResourceForPath(path: string): ProtectedResource | null {
  const [prefix, child] = path.replace(/^\/+/, '').split('/')
  if (prefix === 'access') {
    if (child === 'consents') return 'applications'
    if (child === 'roles' || child === 'assignments') return 'roles'
    if (child === 'requests' || child === 'authorizations') return 'agents'
  }
  if (prefix === 'realm') {
    if (child === 'security-policy') return 'security'
    if (child === 'audit-events') return 'auditEvents'
    if (child === 'configuration-status') return 'readiness'
    return 'settings'
  }
  return prefix ? (resourceByRoutePrefix[prefix] ?? null) : null
}

export const agentBootstrapScopes = [
  'agent:read',
  'resource-servers:read',
  'resources:read',
  'connection-requests:read',
  'connection-requests:write',
  'access-requests:read',
  'access-requests:write',
  'access-authorizations:read',
  'access-authorizations:issue',
] as const

export type AgentBootstrapScope = (typeof agentBootstrapScopes)[number]

export const realmrootOAuthScopes = [...new Set([...agentBootstrapScopes, ...protectedResourceScopes])]

export type RealmrootAuthorityKind = 'realm' | 'organization' | 'account'

export function requiredAgentSelfServiceScope(method: string, path: string): AgentBootstrapScope | null {
  const normalized = path.replace(/^\/api\/?/, '')
  if (normalized === 'agent/status' && method === 'GET') return 'agent:read'
  if (/^agent\/resource-servers(?:\/[^/]+)?$/.test(normalized) && (method === 'GET' || method === 'HEAD')) {
    return 'resource-servers:read'
  }
  if (
    /^agent\/resource-servers\/[^/]+\/resources(?:\/[^/]+)?$/.test(normalized) &&
    (method === 'GET' || method === 'HEAD')
  ) {
    return 'resources:read'
  }
  if (/^agent\/resource-servers\/[^/]+\/connection-requests$/.test(normalized) && method === 'POST') {
    return 'connection-requests:write'
  }
  if (/^agent\/resource-servers\/[^/]+\/connection-requests\/[^/]+$/.test(normalized) && method === 'GET') {
    return 'connection-requests:read'
  }
  if (normalized === 'agent/access-requests') {
    if (method === 'GET') return 'access-requests:read'
    if (method === 'POST') return 'access-requests:write'
  }
  if (/^agent\/access-requests\/[^/]+$/.test(normalized) && method === 'GET') return 'access-requests:read'
  if (/^agent\/access-authorizations(?:\/[^/]+)?$/.test(normalized) && method === 'GET') {
    return 'access-authorizations:read'
  }
  if (/^agent\/access-authorizations\/[^/]+\/credentials$/.test(normalized) && method === 'POST') {
    return 'access-authorizations:issue'
  }
  return null
}
