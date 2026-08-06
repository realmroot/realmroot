import { realmrootManagementScopes } from './scope-registry'

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

export const protectedResourceScopes = realmrootManagementScopes

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
    if (child === 'requests') return 'agents'
  }
  if (prefix === 'realm') {
    if (child === 'security-policy') return 'security'
    if (child === 'audit-events') return 'auditEvents'
    if (child === 'configuration-status') return 'readiness'
    return 'settings'
  }
  return prefix ? (resourceByRoutePrefix[prefix] ?? null) : null
}

export function requiredProtectedScope(method: string, path: string): string | null {
  const normalized = path.replace(/^\/api\/?/, '')
  if (/^organizations\/[^/]+\/roles(?:\/[^/]+)?$/.test(normalized)) {
    return method === 'GET' || method === 'HEAD' ? 'roles:read' : 'roles:write'
  }
  if (/^organizations\/[^/]+\/members\/[^/]+\/roles$/.test(normalized)) {
    return method === 'GET' || method === 'HEAD' ? 'role-assignments:read' : 'role-assignments:write'
  }
  if (/^organizations\/[^/]+$/.test(normalized) && method === 'DELETE') return 'organizations:delete'
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
  'access-grants:read',
  'access-grants:issue',
] as const

export type AgentBootstrapScope = (typeof agentBootstrapScopes)[number]

export const realmrootOAuthScopes = [...new Set([...agentBootstrapScopes, ...protectedResourceScopes])]
