import { badRequest, notFound } from '@server/domain/errors'
import {
  type AuthorizationTokenClaimInput,
  assertRoleTokenClaimName,
  assertTokenClaims,
  createId,
  filterScopes,
  toAssignmentInput,
  toTokenClaims,
} from '@server/usecases/authorization-utils'
import type { Deps } from '@server/usecases/deps'
import type { RoleAssignmentScope } from '@server/usecases/ports'

export type { AuthorizationTokenClaimInput } from '@server/usecases/authorization-utils'

import type {
  AddMemberRequest,
  AssignRoleRequest,
  CreateApiPermissionRequest,
  CreateApiResourceRequest,
  CreateApiScopeRequest,
  CreateInvitationRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  PaginationQuery,
  UpdateApiPermissionRequest,
  UpdateApiResourceRequest,
  UpdateApiScopeRequest,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '@shared/api/authorization'

export function createOrganization(deps: Deps, input: CreateOrganizationRequest) {
  return deps.authorization.createOrganization({
    id: createId('org'),
    slug: input.slug,
    name: input.name,
    displayName: input.displayName ?? null,
    logo: input.logo ?? null,
    disabled: false,
    disabledReason: null,
  })
}

export function listOrganizations(deps: Deps, pagination: PaginationQuery) {
  return deps.authorization.listOrganizations(pagination).then((page) => ({
    organizations: page.items,
    pagination: page.pagination,
  }))
}

export async function getOrganization(deps: Deps, id: string) {
  const organization = await deps.authorization.findOrganization(id)
  if (!organization) throw notFound('Organization was not found.')
  return organization
}

export async function updateOrganization(deps: Deps, id: string, input: UpdateOrganizationRequest) {
  await getOrganization(deps, id)
  await deps.authorization.updateOrganization(id, input)
  return getOrganization(deps, id)
}

export async function deleteOrganization(deps: Deps, id: string) {
  await getOrganization(deps, id)
  await deps.authorization.deleteOrganization(id)
}

export async function addMember(deps: Deps, organizationId: string, input: AddMemberRequest) {
  await getOrganization(deps, organizationId)
  return deps.authorization.addMember(organizationId, {
    id: createId('mem'),
    organizationId,
    userId: input.userId,
    role: input.role,
    title: input.title ?? null,
  })
}

export async function listMembers(deps: Deps, organizationId: string, pagination: PaginationQuery) {
  await getOrganization(deps, organizationId)
  const page = await deps.authorization.listMembers(organizationId, pagination)
  return { members: page.items, pagination: page.pagination }
}

export async function updateMember(deps: Deps, organizationId: string, memberId: string, input: UpdateMemberRequest) {
  await requireMemberForOrganization(deps, memberId, organizationId)
  await deps.authorization.updateMember(memberId, input)
  return requireMember(deps, memberId)
}

export async function removeMember(deps: Deps, organizationId: string, memberId: string) {
  await requireMemberForOrganization(deps, memberId, organizationId)
  await deps.authorization.removeMember(memberId)
}

export async function createInvitation(
  deps: Deps,
  organizationId: string,
  input: CreateInvitationRequest,
  inviterId: string,
) {
  await getOrganization(deps, organizationId)
  return deps.authorization.createInvitation({
    id: createId('inv'),
    organizationId,
    email: input.email,
    role: input.role,
    inviterId,
    status: 'pending',
    expiresAt: input.expiresAt ?? new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
  })
}

export async function listInvitations(deps: Deps, organizationId: string, pagination: PaginationQuery) {
  await getOrganization(deps, organizationId)
  const page = await deps.authorization.listInvitations(organizationId, pagination)
  return { invitations: page.items, pagination: page.pagination }
}

export async function cancelInvitation(deps: Deps, organizationId: string, id: string) {
  const invitation = await deps.authorization.findInvitation(id)
  if (!invitation || invitation.organizationId !== organizationId) {
    throw notFound('Organization invitation was not found.')
  }
  return deps.authorization.cancelInvitation(id)
}

export function createResource(deps: Deps, input: CreateApiResourceRequest) {
  return deps.authorization.createResource({
    id: createId('res'),
    identifier: input.identifier,
    name: input.name,
    audience: input.audience,
    description: input.description ?? null,
    enabled: input.enabled ?? true,
    tokenClaimsNamespace: input.tokenClaimsNamespace ?? null,
  })
}

export function listResources(deps: Deps, pagination: PaginationQuery) {
  return deps.authorization
    .listResources(pagination)
    .then((page) => ({ resources: page.items, pagination: page.pagination }))
}

export async function getResource(deps: Deps, id: string) {
  const resource = await deps.authorization.findResource(id)
  if (!resource) throw notFound('API resource was not found.')
  return resource
}

export async function updateResource(deps: Deps, id: string, input: UpdateApiResourceRequest) {
  await getResource(deps, id)
  await deps.authorization.updateResource(id, input)
  return getResource(deps, id)
}

export async function deleteResource(deps: Deps, id: string) {
  await getResource(deps, id)
  await deps.authorization.deleteResource(id)
}

export async function createScope(deps: Deps, resourceId: string, input: CreateApiScopeRequest) {
  await getResource(deps, resourceId)
  return deps.authorization.createScope(resourceId, {
    id: createId('scope'),
    resourceId,
    value: input.value,
    description: input.description ?? null,
    required: input.required ?? false,
    tokenClaimName: input.tokenClaimName ?? null,
    includeInAccessToken: input.includeInAccessToken ?? true,
    includeInIdToken: input.includeInIdToken ?? false,
  })
}

export async function listScopes(deps: Deps, resourceId: string, pagination: PaginationQuery) {
  await getResource(deps, resourceId)
  const page = await deps.authorization.listScopes(resourceId, pagination)
  return { scopes: page.items, pagination: page.pagination }
}

export async function updateScope(deps: Deps, resourceId: string, id: string, input: UpdateApiScopeRequest) {
  await requireScopeForResource(deps, id, resourceId)
  await deps.authorization.updateScope(id, input)
  return requireScope(deps, id)
}

export async function deleteScope(deps: Deps, resourceId: string, id: string) {
  await requireScopeForResource(deps, id, resourceId)
  await deps.authorization.deleteScope(id)
}

export async function createPermission(deps: Deps, resourceId: string, input: CreateApiPermissionRequest) {
  await getResource(deps, resourceId)
  if (input.scopeId) await requireScopeBelongsToResource(deps, input.scopeId, resourceId)
  return deps.authorization.createPermission(resourceId, {
    id: createId('perm'),
    resourceId,
    scopeId: input.scopeId ?? null,
    key: input.key,
    description: input.description ?? null,
    tokenClaimValue: input.tokenClaimValue ?? null,
  })
}

export async function listPermissions(deps: Deps, resourceId: string, pagination: PaginationQuery) {
  await getResource(deps, resourceId)
  const page = await deps.authorization.listPermissions(resourceId, pagination)
  return { permissions: page.items, pagination: page.pagination }
}

export async function updatePermission(deps: Deps, resourceId: string, id: string, input: UpdateApiPermissionRequest) {
  await requirePermissionForResource(deps, id, resourceId)
  if (input.scopeId) await requireScopeBelongsToResource(deps, input.scopeId, resourceId)
  await deps.authorization.updatePermission(id, input)
  return requirePermission(deps, id)
}

export async function deletePermission(deps: Deps, resourceId: string, id: string) {
  await requirePermissionForResource(deps, id, resourceId)
  await deps.authorization.deletePermission(id)
}

export async function createRole(deps: Deps, input: CreateRoleRequest) {
  assertRoleTokenClaimName(input.tokenClaimName)
  return deps.authorization.createRole({
    id: createId('role'),
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    resourceId: input.resourceId ?? null,
    organizationId: input.organizationId ?? null,
    applicationId: input.applicationId ?? null,
    system: input.system ?? false,
    tokenClaimName: input.tokenClaimName ?? null,
    tokenClaimValue: input.tokenClaimValue ?? null,
  })
}

export function listRoles(deps: Deps, pagination: PaginationQuery) {
  return deps.authorization.listRoles(pagination).then((page) => ({ roles: page.items, pagination: page.pagination }))
}

export async function getRole(deps: Deps, id: string) {
  const role = await deps.authorization.findRole(id)
  if (!role) throw notFound('Role was not found.')
  return role
}

export async function updateRole(deps: Deps, id: string, input: UpdateRoleRequest) {
  const role = await getRole(deps, id)
  assertRoleTokenClaimName(input.tokenClaimName)
  if (
    (input.resourceId !== undefined && input.resourceId !== role.resourceId) ||
    (input.organizationId !== undefined && input.organizationId !== role.organizationId) ||
    (input.applicationId !== undefined && input.applicationId !== role.applicationId)
  ) {
    throw badRequest('Role resource and subject scope cannot be changed after creation.')
  }
  await deps.authorization.updateRole(id, input)
  return getRole(deps, id)
}

export async function deleteRole(deps: Deps, id: string) {
  const role = await getRole(deps, id)
  if (role.system) throw badRequest('System roles cannot be deleted.')
  await deps.authorization.deleteRole(id)
}

export async function listRolePermissions(deps: Deps, roleId: string) {
  await getRole(deps, roleId)
  return { permissions: await deps.authorization.listRolePermissions(roleId) }
}

export async function replaceRolePermissions(deps: Deps, roleId: string, permissionIds: string[]) {
  const role = await getRole(deps, roleId)
  for (const permissionId of permissionIds) {
    const permission = await requirePermission(deps, permissionId)
    if (!role.resourceId || permission.resourceId !== role.resourceId) {
      throw badRequest('Role permissions must belong to the same API resource as the role.')
    }
  }
  await deps.authorization.replaceRolePermissions(roleId, permissionIds)
}

export async function assignUserRole(deps: Deps, input: AssignRoleRequest, actorUserId: string | null) {
  const role = await getRole(deps, input.roleId)
  if (role.organizationId || role.applicationId) {
    throw badRequest('User role assignments must use global roles.')
  }
  assertTokenClaims(input.tokenClaims)
  await deps.authorization.assignUserRole(toAssignmentInput(input, actorUserId))
}

export async function assignApplicationRole(deps: Deps, input: AssignRoleRequest, actorUserId: string | null) {
  const role = await getRole(deps, input.roleId)
  if (role.organizationId || (role.applicationId && role.applicationId !== input.subjectId)) {
    throw badRequest('Application role assignments must use global roles or roles scoped to the same application.')
  }
  assertTokenClaims(input.tokenClaims)
  await deps.authorization.assignApplicationRole(toAssignmentInput(input, actorUserId))
}

export async function assignMemberRole(deps: Deps, input: AssignRoleRequest, actorUserId: string | null) {
  const role = await getRole(deps, input.roleId)
  const member = await requireMember(deps, input.subjectId)
  if (role.applicationId || (role.organizationId && role.organizationId !== member.organizationId)) {
    throw badRequest('Member role assignments must use global roles or roles scoped to the same organization.')
  }
  assertTokenClaims(input.tokenClaims)
  await deps.authorization.assignMemberRole(toAssignmentInput(input, actorUserId))
}

export async function buildTokenClaims(deps: Deps, input: AuthorizationTokenClaimInput) {
  const resource = input.resource ? await deps.authorization.findResourceByAudience(input.resource) : null
  if (input.resource && !resource) {
    return toTokenClaims(input, [], null)
  }
  const scopes = input.destination ? await deps.authorization.listScopesByValues(resource?.id, input.scopes) : []
  const tokenScopes = input.destination ? filterScopes(input.scopes, input.destination, scopes) : input.scopes
  const organization =
    input.organizationId && input.claimSelection?.organizationName
      ? await deps.authorization.findOrganization(input.organizationId)
      : null
  const resourceId = resource?.id
  const scope = {
    resourceId,
    organizationId: input.organizationId,
    applicationId: input.applicationId ?? undefined,
  }
  const userAssignments = input.userId ? await deps.authorization.listUserRoleAssignments(input.userId, scope) : []
  const applicationAssignments = input.applicationId
    ? await deps.authorization.listApplicationRoleAssignments(input.applicationId, scope)
    : []
  const memberAssignments =
    input.userId && input.organizationId
      ? await memberAssignmentsFor(deps, input.userId, input.organizationId, scope)
      : []

  const assignments = [...userAssignments, ...applicationAssignments, ...memberAssignments]
  return toTokenClaims({ ...input, scopes: tokenScopes }, assignments, resource, organization)
}

async function memberAssignmentsFor(deps: Deps, userId: string, organizationId: string, scope: RoleAssignmentScope) {
  const member = await deps.authorization.findMemberByOrganizationUser(organizationId, userId)
  return member ? deps.authorization.listMemberRoleAssignments(member.id, scope) : []
}

async function requireMember(deps: Deps, id: string) {
  const member = await deps.authorization.findMember(id)
  if (!member) throw notFound('Organization member was not found.')
  return member
}

async function requireMemberForOrganization(deps: Deps, id: string, organizationId: string) {
  const member = await requireMember(deps, id)
  if (member.organizationId !== organizationId) {
    throw notFound('Organization member was not found.')
  }
  return member
}

async function requireScope(deps: Deps, id: string) {
  const scope = await deps.authorization.findScope(id)
  if (!scope) throw notFound('API scope was not found.')
  return scope
}

async function requireScopeForResource(deps: Deps, id: string, resourceId: string) {
  const scope = await requireScope(deps, id)
  if (scope.resourceId !== resourceId) {
    throw notFound('API scope was not found.')
  }
  return scope
}

async function requireScopeBelongsToResource(deps: Deps, id: string, resourceId: string) {
  const scope = await requireScope(deps, id)
  if (scope.resourceId !== resourceId) {
    throw badRequest('API scope must belong to the same API resource as the permission.')
  }
  return scope
}

async function requirePermission(deps: Deps, id: string) {
  const permission = await deps.authorization.findPermission(id)
  if (!permission) throw notFound('API permission was not found.')
  return permission
}

async function requirePermissionForResource(deps: Deps, id: string, resourceId: string) {
  const permission = await requirePermission(deps, id)
  if (permission.resourceId !== resourceId) {
    throw notFound('API permission was not found.')
  }
  return permission
}
