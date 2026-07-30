import { badRequest, notFound, resourceInUse } from '@server/domain/errors'
import {
  type AuthorizationTokenClaimInput,
  createId,
  toAssignmentInput,
  toTokenClaims,
} from '@server/usecases/authorization-utils'
import type { Deps } from '@server/usecases/deps'
import type { RoleAssignmentScope } from '@server/usecases/ports'
import {
  validateRequestedScopes,
  validateResourceContract,
  validateResourceUrl,
} from '@server/usecases/resource-openapi'

export type { AuthorizationTokenClaimInput } from '@server/usecases/authorization-utils'

import type {
  AddMemberRequest,
  AssignRoleRequest,
  CreateApiResourceRequest,
  CreateInvitationRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  PaginationQuery,
  UpdateApiResourceRequest,
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
  inviterId: string | null,
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

export async function createResource(deps: Deps, input: CreateApiResourceRequest) {
  const authorizationMode = input.authorizationMode ?? 'native'
  const enabled = authorizationMode === 'external' ? false : (input.enabled ?? true)
  validateResourceUrl(input.resourceUrl)
  if (enabled) await validateResourceContract(deps, input.resourceUrl)
  return deps.authorization.createResource({
    id: createId('res'),
    identifier: input.identifier,
    name: input.name,
    resourceUrl: input.resourceUrl,
    authorizationMode,
    description: input.description ?? null,
    enabled,
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
  const resource = await getResource(deps, id)
  if (input.resourceUrl !== undefined) validateResourceUrl(input.resourceUrl)
  if (resource.authorizationMode === 'external' && input.enabled === true) {
    const authorization = await deps.externalResources.findAuthorization(id)
    if (authorization?.status !== 'active') {
      throw badRequest('External API resource authorization must be configured before enabling the resource.')
    }
  }
  const enabled = input.enabled ?? resource.enabled
  if (enabled && (input.enabled === true || input.resourceUrl !== undefined)) {
    await validateResourceContract(deps, input.resourceUrl ?? resource.resourceUrl)
  }
  await deps.authorization.updateResource(id, input)
  return getResource(deps, id)
}

export async function deleteResource(deps: Deps, id: string) {
  await getResource(deps, id)
  const references = await deps.authorization.deleteResource(id)
  if (references) {
    throw resourceInUse('API resource has authorization history and cannot be permanently deleted.', { ...references })
  }
}

export async function createRole(deps: Deps, input: CreateRoleRequest) {
  return deps.authorization.createRole({
    id: createId('role'),
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    resourceId: input.resourceId ?? null,
    organizationId: input.organizationId ?? null,
    applicationId: input.applicationId ?? null,
    system: input.system ?? false,
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

export async function listRoleScopes(deps: Deps, roleId: string) {
  await getRole(deps, roleId)
  return { scopes: await deps.authorization.listRoleScopes(roleId) }
}

export async function replaceRoleScopes(deps: Deps, roleId: string, scopes: string[]) {
  const role = await getRole(deps, roleId)
  if (!role.resourceId) throw badRequest('A role must belong to an API resource before scopes can be assigned.')
  const resource = await getResource(deps, role.resourceId)
  await validateRequestedScopes(deps, resource.resourceUrl, scopes)
  await deps.authorization.replaceRoleScopes(roleId, scopes)
}

export async function assignUserRole(deps: Deps, input: AssignRoleRequest, actorUserId: string | null) {
  const role = await getRole(deps, input.roleId)
  if (role.organizationId || role.applicationId) {
    throw badRequest('User role assignments must use global roles.')
  }
  await deps.authorization.assignUserRole(toAssignmentInput(input, actorUserId))
}

export async function assignApplicationRole(deps: Deps, input: AssignRoleRequest, actorUserId: string | null) {
  const role = await getRole(deps, input.roleId)
  if (role.organizationId || (role.applicationId && role.applicationId !== input.subjectId)) {
    throw badRequest('Application role assignments must use global roles or roles scoped to the same application.')
  }
  await deps.authorization.assignApplicationRole(toAssignmentInput(input, actorUserId))
}

export async function assignMemberRole(deps: Deps, input: AssignRoleRequest, actorUserId: string | null) {
  const role = await getRole(deps, input.roleId)
  const member = await requireMember(deps, input.subjectId)
  if (role.applicationId || (role.organizationId && role.organizationId !== member.organizationId)) {
    throw badRequest('Member role assignments must use global roles or roles scoped to the same organization.')
  }
  await deps.authorization.assignMemberRole(toAssignmentInput(input, actorUserId))
}

export async function assignAgentRole(deps: Deps, input: AssignRoleRequest, actorUserId: string | null) {
  const role = await getRole(deps, input.roleId)
  if (!role.resourceId || role.applicationId) {
    throw badRequest('Agent role assignments require an API resource role.')
  }
  const identity = await deps.agentIdentities.findIdentity(input.subjectId)
  if (!identity || identity.identity.status !== 'active') throw notFound('Active Agent identity was not found.')
  if (role.organizationId && role.organizationId !== identity.identity.ownerOrganizationId) {
    throw badRequest('Agent role must belong to the Agent home organization.')
  }
  await deps.authorization.assignAgentRole(toAssignmentInput(input, actorUserId))
}

export async function getAgentRoleAuthorization(
  deps: Deps,
  agentIdentityId: string,
  resourceId: string,
  organizationId?: string,
) {
  const assignments = await deps.authorization.listAgentRoleAssignments(agentIdentityId, {
    resourceId,
    organizationId,
  })
  return {
    roles: [...new Set(assignments.map((assignment) => assignment.role.key))].sort(),
    scopes: [...new Set(assignments.flatMap((assignment) => assignment.scopes))].sort(),
  }
}

export async function buildTokenClaims(deps: Deps, input: AuthorizationTokenClaimInput) {
  const resource = input.resource ? await deps.authorization.findResourceByResourceUrl(input.resource) : null
  if (input.resource && !resource) {
    return toTokenClaims(input, [], null)
  }
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
  return toTokenClaims(input, assignments, resource, organization)
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
