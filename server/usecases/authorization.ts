import { badRequest, forbidden, notFound, resourceInUse } from '@server/domain/errors'
import { platformOrganization } from '@server/domain/platform-organization'
import {
  isRealmrootResourceServer,
  realmrootResourceServer,
  realmrootResourceUrl,
} from '@server/domain/realmroot-resource-server'
import { type AuthorizationTokenClaimInput, createId, toTokenClaims } from '@server/usecases/authorization-utils'
import type { Deps } from '@server/usecases/deps'
import { validateExternalResourceConnector } from '@server/usecases/resource-connectors'
import {
  readResourceContract,
  validateRequestedScopes,
  validateResourceContract,
  validateResourceUrl,
} from '@server/usecases/resource-openapi'

export type { AuthorizationTokenClaimInput } from '@server/usecases/authorization-utils'

export interface ResourceMutationActor {
  controllerUserId: string | null
  agent: {
    issuer: string
    subject: string
    identityId: string
    hostId: string
  } | null
}

import type {
  AddMemberRequest,
  ApiResourceResponse,
  AssignRoleRequest,
  CreateApiResourceRequest,
  CreateInvitationRequest,
  CreateOrganizationRequest,
  CreateRoleAssignmentRequest,
  CreateRoleRequest,
  ListRoleAssignmentsQuery,
  PaginationQuery,
  RolePermission,
  UpdateApiResourceRequest,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '@shared/api/authorization'
import { apiResourceEligibilitySchema } from '@shared/api/authorization'

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

export function listOrganizations(deps: Deps, pagination: PaginationQuery, organizationIds?: string[]) {
  return deps.authorization.listOrganizations(pagination, organizationIds).then((page) => ({
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
  const member = await requireMemberForOrganization(deps, memberId, organizationId)
  if (input.role && input.role !== 'owner') await rejectLastOwnerMutation(deps, member)
  await deps.authorization.updateMember(memberId, input)
  return requireMember(deps, memberId)
}

export async function removeMember(deps: Deps, organizationId: string, memberId: string) {
  const member = await requireMemberForOrganization(deps, memberId, organizationId)
  await rejectLastOwnerMutation(deps, member)
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
  const enabled = input.enabled ?? true
  const ownerOrganizationId = input.ownerOrganizationId ?? platformOrganization.id
  if (input.ownerOrganizationId) await requireActiveOrganization(deps, input.ownerOrganizationId)
  const accessEligibility = apiResourceEligibilitySchema.parse(
    input.accessEligibility ?? { mode: 'realm', organizationIds: [] },
  )
  await validateResourceEligibility(deps, accessEligibility)
  validateResourceUrl(input.resourceUrl)
  if (input.connectorId) {
    await validateExternalResourceConnector(
      deps,
      input.resourceUrl,
      input.connectorId,
      input.authorizationDetails ?? [],
    )
  } else if ((input.authorizationDetails?.length ?? 0) > 0) {
    throw badRequest('Authorization details require an external API resource connector.')
  } else if (enabled) {
    await validateResourceContract(deps, input.resourceUrl)
  }
  return deps.authorization.createResource({
    id: createId('res'),
    identifier: input.identifier,
    name: input.name,
    resourceUrl: input.resourceUrl,
    connectorId: input.connectorId ?? null,
    authorizationDetails: input.authorizationDetails ?? [],
    description: input.description ?? null,
    enabled,
    ownerOrganizationId,
    accessEligibility,
    availableToAgents: input.availableToAgents ?? true,
  })
}

export async function ensureRealmrootResourceServer(deps: Deps, apiOrigin: string) {
  const resourceUrl = realmrootResourceUrl(apiOrigin)
  const existing = await deps.authorization.findResource(realmrootResourceServer.id)
  if (existing) {
    if (
      existing.identifier !== realmrootResourceServer.identifier ||
      existing.resourceUrl !== resourceUrl ||
      existing.ownerOrganizationId !== realmrootResourceServer.ownerOrganizationId ||
      existing.connectorId !== null
    ) {
      throw new Error('The persisted Realmroot Resource Server does not match this deployment.')
    }
    return existing
  }
  return deps.authorization.createResource({
    ...realmrootResourceServer,
    resourceUrl,
    connectorId: null,
    authorizationDetails: [],
    enabled: true,
    accessEligibility: { mode: 'realm', organizationIds: [] },
    availableToAgents: true,
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

export async function getResourceContract(deps: Deps, id: string) {
  const resource = await getResource(deps, id)
  const contract = await readResourceContract(deps, resource.resourceUrl)
  return {
    resourceId: resource.id,
    ...contract,
  }
}

export async function updateResource(deps: Deps, id: string, input: UpdateApiResourceRequest) {
  const resource = await getResource(deps, id)
  if (isRealmrootResourceServer(id)) throw badRequest('The Realmroot Resource Server is system-managed.')
  if (resource.archivedAt) throw badRequest('Archived API resources must be restored before updating.')
  if (input.resourceUrl !== undefined) validateResourceUrl(input.resourceUrl)
  if (input.ownerOrganizationId) await requireActiveOrganization(deps, input.ownerOrganizationId)
  if (input.accessEligibility) await validateResourceEligibility(deps, input.accessEligibility)
  if (input.connectorId !== undefined && (input.connectorId === null) !== (resource.connectorId === null)) {
    throw badRequest('API resource authorization mode cannot change after creation.')
  }
  const connectorId = input.connectorId ?? resource.connectorId
  const resourceUrl = input.resourceUrl ?? resource.resourceUrl
  const authorizationDetails = input.authorizationDetails ?? resource.authorizationDetails
  const enabled = input.enabled ?? resource.enabled
  const boundaryChanged =
    input.connectorId !== undefined || input.resourceUrl !== undefined || input.authorizationDetails !== undefined
  if (connectorId && (boundaryChanged || input.enabled === true)) {
    await validateExternalResourceConnector(deps, resourceUrl, connectorId, authorizationDetails)
  } else if (!connectorId && authorizationDetails.length > 0) {
    throw badRequest('Authorization details require an external API resource connector.')
  } else if (!connectorId && enabled && (input.enabled === true || input.resourceUrl !== undefined)) {
    await validateResourceContract(deps, resourceUrl)
  }
  if (!(await deps.authorization.updateResource(id, input))) {
    throw badRequest('Archived API resources must be restored before updating.')
  }
  return getResource(deps, id)
}

async function requireActiveOrganization(deps: Deps, organizationId: string) {
  const organization = await getOrganization(deps, organizationId)
  if (organization.disabled) throw badRequest('Organization must be active.')
  return organization
}

async function validateResourceEligibility(deps: Deps, eligibility: ApiResourceResponse['accessEligibility']) {
  if (eligibility.mode !== 'organizations') return
  for (const organizationId of eligibility.organizationIds) await requireActiveOrganization(deps, organizationId)
}

export async function archiveResource(deps: Deps, id: string, actor: ResourceMutationActor) {
  const resource = await getResource(deps, id)
  if (isRealmrootResourceServer(id)) throw badRequest('The Realmroot Resource Server is system-managed.')
  if (!resource.archivedAt) {
    const now = new Date()
    await deps.authorization.archiveResource(
      id,
      now,
      resourceMutationAudit('api_resource.archived', resource, now, actor),
    )
  }
  return getResource(deps, id)
}

export async function restoreResource(deps: Deps, id: string, actor: ResourceMutationActor) {
  const resource = await getResource(deps, id)
  if (isRealmrootResourceServer(id)) throw badRequest('The Realmroot Resource Server is system-managed.')
  if (resource.archivedAt) {
    const now = new Date()
    await deps.authorization.restoreResource(
      id,
      now,
      resourceMutationAudit('api_resource.restored', resource, now, actor),
    )
  }
  return getResource(deps, id)
}

function resourceMutationAudit(
  action: 'api_resource.archived' | 'api_resource.restored',
  resource: ApiResourceResponse,
  occurredAt: Date,
  actor: ResourceMutationActor,
) {
  return {
    id: createId('agaudit'),
    action,
    result: 'allowed',
    controllerUserId: actor.controllerUserId,
    subjectIssuer: actor.agent?.issuer ?? null,
    subject: actor.agent?.subject ?? null,
    agentIdentityId: actor.agent?.identityId ?? null,
    hostId: actor.agent?.hostId ?? null,
    ownerKind: 'organization' as const,
    ownerId: resource.ownerOrganizationId,
    quarantineReason: null,
    resourceId: resource.id,
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: null,
    reasonCode: null,
    metadata: action === 'api_resource.archived' ? { authorizationRecordsRevoked: true } : null,
    occurredAt,
  }
}

export async function deleteResource(deps: Deps, id: string) {
  await getResource(deps, id)
  if (isRealmrootResourceServer(id)) throw badRequest('The Realmroot Resource Server is system-managed.')
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
  await getRole(deps, id)
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

export async function replaceRolePermissions(deps: Deps, roleId: string, permissions: RolePermission[]) {
  await getRole(deps, roleId)
  const permissionsByResource = new Map<string, RolePermission[]>()
  for (const permission of permissions) {
    permissionsByResource.set(permission.resourceId, [
      ...(permissionsByResource.get(permission.resourceId) ?? []),
      permission,
    ])
  }
  for (const [resourceId, resourcePermissions] of permissionsByResource) {
    const resource = await getResource(deps, resourceId)
    await validateRequestedScopes(
      deps,
      resource.resourceUrl,
      resourcePermissions.map((permission) => permission.scope),
    )
  }
  await deps.authorization.replaceRolePermissions(roleId, permissions)
}

export function listRoleAssignments(
  deps: Deps,
  query: ListRoleAssignmentsQuery,
  visibility?: { organizationIds: string[]; includeRealmAssignments?: boolean },
) {
  return deps.authorization.listRoleAssignments({ ...query, ...visibility }).then((page) => ({
    assignments: page.items,
    pagination: page.pagination,
  }))
}

export async function getRoleAssignment(deps: Deps, id: string) {
  const assignment = await deps.authorization.findRoleAssignment(id)
  if (!assignment) throw notFound('Role assignment was not found.')
  return assignment
}

export async function createRoleAssignment(deps: Deps, input: CreateRoleAssignmentRequest, actorUserId: string | null) {
  await getRole(deps, input.roleId)
  const organizationId = input.organizationId ?? null
  if (organizationId) await getOrganization(deps, organizationId)
  await validateRoleAssignmentSubject(deps, input.subjectType, input.subjectId, organizationId)
  return deps.authorization.createRoleAssignment({
    id: createId('assignment'),
    roleId: input.roleId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    organizationId,
    assignedByUserId: actorUserId,
    expiresAt: input.expiresAt ?? null,
  })
}

export async function putRoleAssignmentRevocation(deps: Deps, id: string) {
  const assignment = await getRoleAssignment(deps, id)
  if (assignment.revokedAt) return { roleAssignmentId: id, revokedAt: assignment.revokedAt }
  const revokedAt = new Date()
  if (!(await deps.authorization.revokeRoleAssignment(id, revokedAt))) throw notFound('Role assignment was not found.')
  return { roleAssignmentId: id, revokedAt: revokedAt.toISOString() }
}

async function validateRoleAssignmentSubject(
  deps: Deps,
  subjectType: CreateRoleAssignmentRequest['subjectType'],
  subjectId: string,
  organizationId: string | null,
) {
  if (subjectType === 'user') {
    await deps.users.getUser(subjectId)
    if (organizationId && !(await deps.authorization.findMemberByOrganizationUser(organizationId, subjectId))) {
      throw badRequest('User must be a member of the assignment Organization context.')
    }
    return
  }
  if (subjectType === 'workload') {
    const application = await deps.applications.findById(subjectId)
    if (!application) throw notFound('Workload Application was not found.')
    if (organizationId && application.ownerOrganizationId !== organizationId) {
      throw badRequest('Workload must be owned by the assignment Organization context.')
    }
    return
  }
  const agent = await deps.agentIdentities.findIdentity(subjectId)
  if (!agent || agent.identity.status !== 'active') throw notFound('Active Agent identity was not found.')
  if (!organizationId || agent.identity.ownerOrganizationId === organizationId) return
  if (
    !agent.identity.ownerUserId ||
    !(await deps.authorization.findMemberByOrganizationUser(organizationId, agent.identity.ownerUserId))
  ) {
    throw badRequest('Agent must belong to the assignment Organization or one of its members.')
  }
}

export async function assignAgentRole(deps: Deps, input: AssignRoleRequest, actorUserId: string | null) {
  await createRoleAssignment(deps, { ...input, subjectType: 'agent', organizationId: null }, actorUserId)
}

export async function getAgentRoleAuthorization(
  deps: Deps,
  agentIdentityId: string,
  resourceId: string,
  organizationId?: string,
) {
  const resource = await getResource(deps, resourceId)
  if (!resource.availableToAgents || !resourceEligibleForOrganization(resource, organizationId)) {
    return { roles: [], scopes: [] }
  }
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
  if (input.userId && input.organizationId) {
    const membership = await deps.authorization.findMemberByOrganizationUser(input.organizationId, input.userId)
    if (!membership) throw forbidden('User is not a member of the active Organization context.')
  }
  if (resource && !resourceEligibleForOrganization(resource, input.organizationId)) {
    return toTokenClaims({ ...input, scopes: [] }, [], resource, organization)
  }
  const scope = {
    resourceId,
    organizationId: input.organizationId,
  }
  const userAssignments = input.userId ? await deps.authorization.listUserRoleAssignments(input.userId, scope) : []
  const applicationAssignments = input.applicationId
    ? await deps.authorization.listApplicationRoleAssignments(input.applicationId, scope)
    : []
  const assignments = [...userAssignments, ...applicationAssignments]
  return toTokenClaims(input, assignments, resource, organization)
}

function resourceEligibleForOrganization(resource: ApiResourceResponse, organizationId?: string) {
  if (resource.accessEligibility.mode === 'realm') return true
  if (!organizationId) return false
  if (resource.accessEligibility.mode === 'owner_organization') {
    return resource.ownerOrganizationId === organizationId
  }
  return resource.accessEligibility.organizationIds.includes(organizationId)
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

async function rejectLastOwnerMutation(deps: Deps, member: Awaited<ReturnType<typeof requireMember>>) {
  if (member.role !== 'owner') return
  const ownerCount = await deps.authorization.countMembersByRole(member.organizationId, 'owner')
  if (ownerCount <= 1) {
    throw badRequest('Transfer Organization ownership before changing or removing the last Owner.')
  }
}
