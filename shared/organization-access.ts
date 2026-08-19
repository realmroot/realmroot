import { createAccessControl } from 'better-auth/plugins/access'
import { type RealmrootOrganizationScope, realmrootOrganizationScopes } from './scope-registry'

export { type RealmrootOrganizationScope, realmrootOrganizationScopes }

export const organizationAccessControl = createAccessControl({
  organization: ['create', 'read', 'update', 'delete'],
  member: ['create', 'read', 'update', 'delete'],
  invitation: ['create', 'read', 'cancel'],
  role: ['create', 'read', 'update', 'delete', 'assign'],
  team: ['create', 'update', 'delete'],
  apiResource: ['create', 'read', 'update', 'delete'],
  scope: realmrootOrganizationScopes,
} as const)

export const predefinedOrganizationRoleScopes = {
  owner: realmrootOrganizationScopes,
  admin: realmrootOrganizationScopes.filter((scope) => scope !== 'organizations:delete' && scope !== 'roles:write'),
  developer: [
    'applications:read',
    'applications:write',
    'users:read',
    'organizations:read',
    'roles:read',
    'role-assignments:read',
    'resource-servers:read',
    'resource-servers:write',
    'connectors:read',
    'webhooks:read',
    'webhooks:write',
    'agents:read',
    'audit-events:read',
  ],
  member: ['organizations:read', 'users:read'],
} satisfies Record<string, RealmrootOrganizationScope[]>

export const organizationRoles = {
  owner: organizationAccessControl.newRole({
    organization: ['create', 'read', 'update', 'delete'],
    member: ['create', 'read', 'update', 'delete'],
    invitation: ['create', 'read', 'cancel'],
    role: ['create', 'read', 'update', 'delete', 'assign'],
    team: ['create', 'update', 'delete'],
    apiResource: ['create', 'read', 'update', 'delete'],
    scope: predefinedOrganizationRoleScopes.owner,
  }),
  admin: organizationAccessControl.newRole({
    organization: ['read', 'update'],
    member: ['create', 'read', 'update', 'delete'],
    invitation: ['create', 'read', 'cancel'],
    role: ['read', 'assign'],
    team: ['create', 'update', 'delete'],
    apiResource: ['read'],
    scope: predefinedOrganizationRoleScopes.admin,
  }),
  developer: organizationAccessControl.newRole({
    organization: ['read'],
    member: ['read'],
    invitation: ['read'],
    role: ['read'],
    team: [],
    apiResource: ['read'],
    scope: predefinedOrganizationRoleScopes.developer,
  }),
  member: organizationAccessControl.newRole({
    organization: ['read'],
    member: ['read'],
    invitation: ['read'],
    role: ['read'],
    team: [],
    apiResource: ['read'],
    scope: predefinedOrganizationRoleScopes.member,
  }),
}

export type OrganizationAccessLevel = keyof typeof organizationRoles

export const predefinedOrganizationRoleKeys = Object.keys(organizationRoles) as OrganizationAccessLevel[]

export function encodeRoleScope(resourceId: string, scope: string) {
  return `${encodeURIComponent(resourceId)}/${encodeURIComponent(scope)}`
}

export function decodeRoleScope(value: string): { resourceId: string; scope: string } | null {
  const separator = value.indexOf('/')
  if (separator < 1 || separator === value.length - 1) return null
  try {
    return {
      resourceId: decodeURIComponent(value.slice(0, separator)),
      scope: decodeURIComponent(value.slice(separator + 1)),
    }
  } catch {
    return null
  }
}
