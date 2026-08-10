export const realmrootScopeRegistry = {
  'applications:read': { resource: 'application', action: 'read', organization: true },
  'applications:write': { resource: 'application', action: 'write', organization: true },
  'users:read': { resource: 'member', action: 'read', organization: true },
  'users:write': { resource: 'user', action: 'write', organization: true },
  'organizations:read': { resource: 'organization', action: 'read', organization: true },
  'organizations:write': { resource: 'organization', action: 'write', organization: true },
  'organizations:delete': { resource: 'organization', action: 'delete', organization: true },
  'roles:read': { resource: 'role', action: 'read', organization: true },
  'roles:write': { resource: 'role', action: 'write', organization: true },
  'role-assignments:read': { resource: 'role', action: 'read-assignment', organization: true },
  'role-assignments:write': { resource: 'role', action: 'write-assignment', organization: true },
  'resource-servers:read': { resource: 'resource-server', action: 'read', organization: true },
  'resource-servers:write': { resource: 'resource-server', action: 'write', organization: true },
  'connection-events:write': { resource: 'connection-event', action: 'write', organization: true },
  'connectors:read': { resource: 'connector', action: 'read', organization: true },
  'connectors:write': { resource: 'connector', action: 'write', organization: true },
  'settings:read': { resource: 'realm', action: 'read', organization: true },
  'settings:write': { resource: 'realm', action: 'write', organization: true },
  'security:read': { resource: 'security', action: 'read', organization: true },
  'security:write': { resource: 'security', action: 'write', organization: true },
  'readiness:read': { resource: 'readiness', action: 'read', organization: true },
  'webhooks:read': { resource: 'webhook', action: 'read', organization: true },
  'webhooks:write': { resource: 'webhook', action: 'write', organization: true },
  'agents:read': { resource: 'agent', action: 'read', organization: true },
  'agents:write': { resource: 'agent', action: 'write', organization: true },
  'permissions:read': { resource: 'permission', action: 'read', organization: true },
  'permissions:write': { resource: 'permission', action: 'write', organization: true },
  'audit-events:read': { resource: 'audit-event', action: 'read', organization: true },
} as const

export type RealmrootOrganizationScope = keyof typeof realmrootScopeRegistry

export const realmrootManagementScopes = Object.keys(realmrootScopeRegistry) as RealmrootOrganizationScope[]
export const realmrootOrganizationScopes = realmrootManagementScopes.filter(
  (scope) => realmrootScopeRegistry[scope].organization,
)
