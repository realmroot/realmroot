export const resourceAccess = {
  applications: {
    routePrefixes: ['applications'],
    scopes: { read: 'applications:read', write: 'applications:write' },
  },
  users: {
    routePrefixes: ['users'],
    scopes: { read: 'users:read', write: 'users:write' },
  },
  organizations: {
    routePrefixes: ['organizations'],
    scopes: { read: 'organizations:read', write: 'organizations:write' },
  },
  roles: {
    routePrefixes: [],
    scopes: { read: 'roles:read', write: 'roles:write' },
  },
  apiResources: {
    routePrefixes: ['resource-servers'],
    scopes: { read: 'resource-servers:read', write: 'resource-servers:write' },
  },
  connectors: {
    routePrefixes: ['connectors'],
    scopes: { read: 'connectors:read', write: 'connectors:write' },
  },
  settings: {
    routePrefixes: ['realm'],
    scopes: { read: 'settings:read', write: 'settings:write' },
  },
  security: {
    routePrefixes: [],
    scopes: { read: 'security:read', write: 'security:write' },
  },
  webhooks: {
    routePrefixes: ['webhooks'],
    scopes: { read: 'webhooks:read', write: 'webhooks:write' },
  },
  agents: {
    routePrefixes: ['agents', 'access'],
    scopes: { read: 'agents:read', write: 'agents:write' },
  },
  auditEvents: {
    routePrefixes: [],
    scopes: { read: 'audit-events:read' },
  },
  readiness: {
    routePrefixes: [],
    scopes: { read: 'readiness:read' },
  },
} as const

export type ProtectedResource = keyof typeof resourceAccess

export const protectedResourceScopes = Object.values(resourceAccess).flatMap(({ scopes }) =>
  'write' in scopes ? [scopes.read, scopes.write] : [scopes.read],
)

export type ProtectedResourceScope = (typeof protectedResourceScopes)[number]

export function isProtectedResourceScope(value: string): value is ProtectedResourceScope {
  return protectedResourceScopes.includes(value as ProtectedResourceScope)
}

export const resourceByRoutePrefix = Object.fromEntries(
  Object.entries(resourceAccess).flatMap(([resource, definition]) =>
    definition.routePrefixes.map((prefix) => [prefix, resource]),
  ),
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

export function requiredProtectedScope(method: string, path: string): ProtectedResourceScope | null {
  const resource = protectedResourceForPath(path)
  if (!resource) return null
  return requiredResourceScope(method, resource)
}

export function requiredResourceScope(method: string, resource: ProtectedResource): ProtectedResourceScope | null {
  const scopes = resourceAccess[resource].scopes
  if (method === 'GET' || method === 'HEAD') return scopes.read
  return 'write' in scopes ? scopes.write : null
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

export function requiredAgentSelfServiceScope(method: string, path: string): AgentBootstrapScope | null {
  const normalized = path.replace(/^\/api\/?/, '')
  if (normalized === 'agent/status' && method === 'GET') return 'agent:read'
  if (/^resource-servers(?:\/[^/]+)?$/.test(normalized) && (method === 'GET' || method === 'HEAD')) {
    return 'resource-servers:read'
  }
  if (/^resource-servers\/[^/]+\/resources(?:\/[^/]+)?$/.test(normalized) && (method === 'GET' || method === 'HEAD')) {
    return 'resources:read'
  }
  if (/^resource-servers\/[^/]+\/connection-requests$/.test(normalized) && method === 'POST') {
    return 'connection-requests:write'
  }
  if (/^resource-servers\/[^/]+\/connection-requests\/[^/]+$/.test(normalized) && method === 'GET') {
    return 'connection-requests:read'
  }
  if (normalized === 'access/requests') {
    if (method === 'GET') return 'access-requests:read'
    if (method === 'POST') return 'access-requests:write'
  }
  if (/^access\/requests\/[^/]+$/.test(normalized) && method === 'GET') return 'access-requests:read'
  if (/^access\/authorizations(?:\/[^/]+)?$/.test(normalized) && method === 'GET') {
    return 'access-authorizations:read'
  }
  if (/^access\/authorizations\/[^/]+\/credentials$/.test(normalized) && method === 'POST') {
    return 'access-authorizations:issue'
  }
  return null
}
