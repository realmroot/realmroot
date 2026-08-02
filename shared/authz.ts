export const resourceAccess = {
  applications: {
    routePrefixes: ['applications', 'application-authorizations'],
    capabilities: { read: 'applications:read', write: 'applications:write' },
  },
  users: {
    routePrefixes: ['users'],
    capabilities: { read: 'users:read', write: 'users:write' },
  },
  organizations: {
    routePrefixes: ['organizations'],
    capabilities: { read: 'organizations:read', write: 'organizations:write' },
  },
  roles: {
    routePrefixes: ['roles', 'role-assignments'],
    capabilities: { read: 'roles:read', write: 'roles:write' },
  },
  apiResources: {
    routePrefixes: ['api-resources'],
    capabilities: { read: 'api-resources:read', write: 'api-resources:write' },
  },
  connectors: {
    routePrefixes: ['connectors'],
    capabilities: { read: 'connectors:read', write: 'connectors:write' },
  },
  settings: {
    routePrefixes: [
      'sign-in-settings',
      'branding-settings',
      'account-center-settings',
      'organization-creation-policy',
      'developer-console-access-policy',
      'email-delivery-configuration',
      'realm',
      'branding',
    ],
    capabilities: { read: 'settings:read', write: 'settings:write' },
  },
  security: {
    routePrefixes: ['security'],
    capabilities: { read: 'security:read', write: 'security:write' },
  },
  webhooks: {
    routePrefixes: ['webhooks'],
    capabilities: { read: 'webhooks:read', write: 'webhooks:write' },
  },
  agents: {
    routePrefixes: ['agents', 'agent-access-requests', 'agent-access-grants'],
    capabilities: { read: 'agents:read', write: 'agents:write' },
  },
  auditEvents: {
    routePrefixes: ['audit-events'],
    capabilities: { read: 'audit-events:read' },
  },
  readiness: {
    routePrefixes: ['readiness'],
    capabilities: { read: 'readiness:read' },
  },
} as const

export type ProtectedResource = keyof typeof resourceAccess

export const protectedResourceCapabilityNames = Object.values(resourceAccess).flatMap(({ capabilities }) =>
  'write' in capabilities ? [capabilities.read, capabilities.write] : [capabilities.read],
)

export type ProtectedResourceCapability = (typeof protectedResourceCapabilityNames)[number]

export function isProtectedResourceCapability(value: string): value is ProtectedResourceCapability {
  return protectedResourceCapabilityNames.includes(value as ProtectedResourceCapability)
}

export const resourceByRoutePrefix = Object.fromEntries(
  Object.entries(resourceAccess).flatMap(([resource, definition]) =>
    definition.routePrefixes.map((prefix) => [prefix, resource]),
  ),
) as Record<string, ProtectedResource>

export function protectedResourceForPath(path: string): ProtectedResource | null {
  const prefix = path.replace(/^\/+/, '').split('/')[0]
  return prefix ? (resourceByRoutePrefix[prefix] ?? null) : null
}

export function requiredProtectedCapability(method: string, path: string): ProtectedResourceCapability | null {
  const resource = protectedResourceForPath(path)
  if (!resource) return null
  return requiredResourceCapability(method, resource)
}

export function requiredResourceCapability(
  method: string,
  resource: ProtectedResource,
): ProtectedResourceCapability | null {
  const capabilities = resourceAccess[resource].capabilities
  if (method === 'GET' || method === 'HEAD') return capabilities.read
  return 'write' in capabilities ? capabilities.write : null
}
