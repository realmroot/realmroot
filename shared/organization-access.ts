import { createAccessControl } from 'better-auth/plugins/access'

export const organizationAccessControl = createAccessControl({
  organization: ['create', 'read', 'update', 'delete'],
  member: ['create', 'read', 'update', 'delete'],
  invitation: ['create', 'read', 'cancel'],
  role: ['create', 'read', 'update', 'delete', 'assign'],
  apiResource: ['create', 'read', 'update', 'delete'],
} as const)

export const organizationRoles = {
  owner: organizationAccessControl.newRole({
    organization: ['create', 'read', 'update', 'delete'],
    member: ['create', 'read', 'update', 'delete'],
    invitation: ['create', 'read', 'cancel'],
    role: ['create', 'read', 'update', 'delete', 'assign'],
    apiResource: ['create', 'read', 'update', 'delete'],
  }),
  admin: organizationAccessControl.newRole({
    organization: ['read', 'update'],
    member: ['create', 'read', 'update', 'delete'],
    invitation: ['create', 'read', 'cancel'],
    role: ['read', 'assign'],
    apiResource: ['read'],
  }),
  developer: organizationAccessControl.newRole({
    organization: ['read'],
    member: ['read'],
    invitation: ['read'],
    role: ['read'],
    apiResource: ['read'],
  }),
  member: organizationAccessControl.newRole({
    organization: ['read'],
    member: ['read'],
    invitation: ['read'],
    role: ['read'],
    apiResource: ['read'],
  }),
}

export type OrganizationAccessLevel = keyof typeof organizationRoles
