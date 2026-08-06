import { badRequest, conflict, forbidden, notFound, preconditionFailed, resourceInUse } from '@server/domain/errors'
import {
  isRealmrootResourceServer,
  realmrootResourceServer,
  realmrootResourceUrl,
} from '@server/domain/realmroot-resource-server'
import { type AuthorizationTokenClaimInput, createId, toTokenClaims } from '@server/usecases/authorization-utils'
import type { Deps } from '@server/usecases/deps'
import { resolveOrganizationMembershipScopes } from '@server/usecases/organization-membership-scopes'
import { validateExternalResourceConnector } from '@server/usecases/resource-connectors'
import { activeResourceEligibleForOrganization } from '@server/usecases/resource-eligibility'
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

import { realmrootResourceServer as internalResourceServer } from '@server/domain/realmroot-resource-server'
import type {
  AddMemberRequest,
  ApiResourceResponse,
  CreateApiResourceRequest,
  CreateInvitationRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  PaginationQuery,
  ReplaceMemberRolesRequest,
  RoleResponse,
  RoleScope,
  UpdateApiResourceRequest,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '@shared/api/authorization'
import { apiResourceEligibilitySchema } from '@shared/api/authorization'
import {
  encodeRoleScope,
  predefinedOrganizationRoleKeys,
  predefinedOrganizationRoleScopes,
} from '@shared/organization-access'
import { realmrootScopeRegistry } from '@shared/scope-registry'

export function createOrganization(deps: Deps, input: CreateOrganizationRequest, ownerUserId: string) {
  return deps.authorization.createOrganization(
    {
      id: createId('org'),
      slug: input.slug,
      name: input.name,
      displayName: input.displayName ?? null,
      logo: input.logo ?? null,
      disabled: false,
      disabledReason: null,
    },
    {
      id: createId('mem'),
      userId: ownerUserId,
      roles: ['owner'],
      title: null,
    },
  )
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

export async function addMember(
  deps: Deps,
  organizationId: string,
  input: AddMemberRequest,
  actorUserId: string,
  platformAdministrator: boolean,
) {
  await getOrganization(deps, organizationId)
  await validateOrganizationRoleKeys(deps, organizationId, input.roles)
  await rejectOwnerAssignmentByNonOwner(deps, organizationId, actorUserId, input.roles, platformAdministrator)
  return deps.authorization.addMember(organizationId, {
    id: createId('mem'),
    organizationId,
    userId: input.userId,
    roles: input.roles,
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

export async function removeMember(deps: Deps, organizationId: string, memberId: string, actorUserId: string) {
  const member = await requireMemberForOrganization(deps, memberId, organizationId)
  const removed = await deps.authorization.removeMember(
    organizationId,
    memberId,
    member.updatedAt,
    authorizationAudit('organization.member.removed', organizationId, actorUserId, new Date(), {
      organizationId,
      memberId,
    }),
  )
  if (!removed) throw preconditionFailed('The Organization member changed or is the last Owner.')
}

export async function replaceMemberRoles(
  deps: Deps,
  organizationId: string,
  memberId: string,
  input: ReplaceMemberRolesRequest,
  actorUserId: string,
  platformAdministrator: boolean,
) {
  const target = await requireMemberForOrganization(deps, memberId, organizationId)
  await validateOrganizationRoleKeys(deps, organizationId, input.roles)
  await rejectOwnerAssignmentByNonOwner(deps, organizationId, actorUserId, input.roles, platformAdministrator)
  if (target.roles.includes('owner') && !input.roles.includes('owner')) await rejectLastOwnerMutation(deps, target)
  const now = new Date()
  const updated = await deps.authorization.replaceMemberRoles(
    organizationId,
    memberId,
    input.roles,
    target.updatedAt,
    authorizationAudit('organization.member.roles-replaced', organizationId, actorUserId, now, {
      organizationId,
      memberId,
      previousRoles: target.roles,
      roles: input.roles,
    }),
  )
  if (!updated) throw preconditionFailed('The Organization member changed after it was read.')
  return { roles: input.roles }
}

export async function createInvitation(
  deps: Deps,
  organizationId: string,
  input: CreateInvitationRequest,
  inviterId: string,
  platformAdministrator: boolean,
) {
  await getOrganization(deps, organizationId)
  await validateOrganizationRoleKeys(deps, organizationId, input.roles)
  await rejectOwnerAssignmentByNonOwner(deps, organizationId, inviterId, input.roles, platformAdministrator)
  return deps.authorization.createInvitation({
    id: createId('inv'),
    organizationId,
    email: input.email,
    roles: input.roles,
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
  const ownerOrganizationId = input.ownerOrganizationId
  await requireActiveOrganization(deps, ownerOrganizationId)
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
  const existing = await reconcileRealmrootResourceServer(deps, apiOrigin)
  if (existing) return existing
  return deps.authorization.createResource({
    ...realmrootResourceServer,
    resourceUrl: realmrootResourceUrl(apiOrigin),
    connectorId: null,
    authorizationDetails: [],
    enabled: true,
    accessEligibility: { mode: 'realm', organizationIds: [] },
    availableToAgents: true,
  })
}

export async function reconcileRealmrootResourceServer(deps: Deps, apiOrigin: string) {
  const resourceUrl = realmrootResourceUrl(apiOrigin)
  const existing = await deps.authorization.findResource(realmrootResourceServer.id)
  if (existing) {
    assertRealmrootResourceServerIdentity(existing)
    if (existing.resourceUrl === resourceUrl) return existing
    const updated = await deps.authorization.updateResource(existing.id, { resourceUrl })
    if (!updated) throw new Error('The persisted Realmroot Resource Server could not be reconciled.')
    const reconciled = await deps.authorization.findResource(existing.id)
    if (!reconciled) {
      throw new Error('The persisted Realmroot Resource Server could not be reconciled.')
    }
    assertRealmrootResourceServerIdentity(reconciled)
    if (reconciled.resourceUrl !== resourceUrl) {
      throw new Error('The persisted Realmroot Resource Server could not be reconciled.')
    }
    return reconciled
  }
  return null
}

function assertRealmrootResourceServerIdentity(resource: ApiResourceResponse) {
  if (
    resource.identifier !== realmrootResourceServer.identifier ||
    resource.ownerOrganizationId !== realmrootResourceServer.ownerOrganizationId ||
    resource.connectorId !== null
  ) {
    throw new Error('The persisted Realmroot Resource Server does not match this deployment.')
  }
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
      resourceMutationAudit('api_resource.archived', id, resource.ownerOrganizationId, now, actor),
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
      resourceMutationAudit('api_resource.restored', id, resource.ownerOrganizationId, now, actor),
    )
  }
  return getResource(deps, id)
}

function resourceMutationAudit(
  action: 'api_resource.archived' | 'api_resource.restored',
  resourceId: string,
  ownerOrganizationId: string,
  occurredAt: Date,
  actor: ResourceMutationActor,
) {
  return {
    id: createId('agaudit'),
    action,
    result: 'allowed',
    realmOwned: false,
    ownerUserId: null,
    ownerOrganizationId,
    controllerUserId: actor.controllerUserId,
    subjectIssuer: actor.agent?.issuer ?? null,
    subject: actor.agent?.subject ?? null,
    agentIdentityId: actor.agent?.identityId ?? null,
    hostId: actor.agent?.hostId ?? null,
    resourceId,
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

export async function createRole(deps: Deps, organizationId: string, input: CreateRoleRequest, actorUserId: string) {
  await getOrganization(deps, organizationId)
  if (predefinedOrganizationRoleKeys.includes(input.key as never)) {
    throw conflict(`Role key "${input.key}" is reserved for a predefined Role.`)
  }
  const scopes = normalizeRoleScopes(input.scopes)
  await validateRoleScopes(deps, organizationId, scopes)
  const now = new Date()
  return deps.authorization.createOrganizationRole(
    organizationId,
    { key: input.key, displayName: input.displayName, description: input.description ?? null, scopes },
    toBetterAuthPermission(scopes),
    authorizationAudit('organization.role.created', organizationId, actorUserId, now, {
      organizationId,
      roleKey: input.key,
    }),
  )
}

export async function listRoles(deps: Deps, organizationId: string, pagination: PaginationQuery) {
  await getOrganization(deps, organizationId)
  const dynamicScopes = await deps.authorization.listOrganizationRoleScopes(organizationId)
  const dynamic = (await deps.authorization.listOrganizationRoles(organizationId)).map((role) => ({
    ...role,
    scopes: dynamicScopes.get(role.key) ?? [],
  }))
  const roles = [...predefinedRoleRepresentations(), ...dynamic].sort((left, right) =>
    left.key.localeCompare(right.key),
  )
  const paged = roles.slice(pagination.offset, pagination.offset + pagination.limit)
  return {
    roles: paged,
    pagination: {
      limit: pagination.limit,
      offset: pagination.offset,
      total: roles.length,
      hasMore: pagination.offset + paged.length < roles.length,
    },
  }
}

export async function getRole(deps: Deps, organizationId: string, roleKey: string): Promise<RoleResponse> {
  const predefined = predefinedRoleRepresentations().find((role) => role.key === roleKey)
  if (predefined) return predefined
  const role = await deps.authorization.findOrganizationRole(organizationId, roleKey)
  if (!role) throw notFound('Organization Role was not found.')
  const scopes = await deps.authorization.listOrganizationRoleScopes(organizationId)
  return { ...role, scopes: scopes.get(roleKey) ?? [] }
}

export async function updateRole(
  deps: Deps,
  organizationId: string,
  roleKey: string,
  input: UpdateRoleRequest,
  actorUserId: string,
) {
  const role = await getRole(deps, organizationId, roleKey)
  if (role.predefined) throw conflict('Predefined Organization Roles cannot be modified.')
  const scopes = input.scopes === undefined ? undefined : normalizeRoleScopes(input.scopes)
  if (scopes) await validateRoleScopes(deps, organizationId, scopes)
  const now = new Date()
  const updated = await deps.authorization.updateOrganizationRole(
    organizationId,
    roleKey,
    input,
    scopes ? toBetterAuthPermission(scopes) : undefined,
    role.updatedAt!,
    authorizationAudit('organization.role.updated', organizationId, actorUserId, now, { organizationId, roleKey }),
  )
  if (!updated) throw preconditionFailed('The Organization Role changed after it was read.')
  return getRole(deps, organizationId, roleKey)
}

export async function deleteRole(deps: Deps, organizationId: string, roleKey: string, actorUserId: string) {
  const role = await getRole(deps, organizationId, roleKey)
  if (role.predefined) throw conflict('Predefined Organization Roles cannot be deleted.')
  const now = new Date()
  const result = await deps.authorization.deleteOrganizationRole(
    organizationId,
    roleKey,
    role.updatedAt!,
    authorizationAudit('organization.role.deleted', organizationId, actorUserId, now, { organizationId, roleKey }),
  )
  if (result === 'assigned') throw conflict('Assigned Organization Roles cannot be deleted.')
  if (result === 'not_found') throw preconditionFailed('The Organization Role changed after it was read.')
}

function predefinedRoleRepresentations(): RoleResponse[] {
  return predefinedOrganizationRoleKeys.map((key) => ({
    key,
    displayName: key[0]!.toUpperCase() + key.slice(1),
    description: null,
    predefined: true,
    scopes: predefinedOrganizationRoleScopes[key].map((scope) => ({
      resourceId: internalResourceServer.id,
      scope,
    })),
    createdAt: null,
    updatedAt: null,
  }))
}

function normalizeRoleScopes(scopes: RoleScope[]) {
  return [...new Map(scopes.map((scope) => [`${scope.resourceId}\u0000${scope.scope}`, scope])).values()].sort(
    (left, right) => left.resourceId.localeCompare(right.resourceId) || left.scope.localeCompare(right.scope),
  )
}

async function validateRoleScopes(deps: Deps, organizationId: string, scopes: RoleScope[]) {
  const byResource = new Map<string, string[]>()
  for (const item of scopes) byResource.set(item.resourceId, [...(byResource.get(item.resourceId) ?? []), item.scope])
  for (const [resourceId, requestedScopes] of byResource) {
    const resource = await getResource(deps, resourceId)
    if (!activeResourceEligibleForOrganization(resource, organizationId)) {
      throw badRequest('Resource Server is not eligible for this Organization.')
    }
    if (resourceId === internalResourceServer.id) {
      if (requestedScopes.some((scope) => !(scope in realmrootScopeRegistry))) {
        throw badRequest('Requested scope is not declared by the Realmroot Scope Registry.')
      }
      continue
    }
    await validateRequestedScopes(deps, resource.resourceUrl, requestedScopes)
  }
}

function toBetterAuthPermission(scopes: RoleScope[]) {
  return { scope: scopes.map(({ resourceId, scope }) => encodeRoleScope(resourceId, scope)) }
}

export async function getAgentRoleAuthorization(
  deps: Deps,
  agentIdentityId: string,
  resourceId: string,
  organizationId?: string,
): Promise<{ roles: string[]; scopes: string[] }> {
  const resource = await getResource(deps, resourceId)
  if (!resource.availableToAgents || !activeResourceEligibleForOrganization(resource, organizationId)) {
    throw forbidden('Resource Server is not eligible for this Agent tenant.')
  }
  void agentIdentityId
  return { roles: [], scopes: [] }
}

export async function buildTokenClaims(deps: Deps, input: AuthorizationTokenClaimInput) {
  const resource = input.resource ? await deps.authorization.findResourceByResourceUrl(input.resource) : null
  if (input.resource && !resource) {
    return toTokenClaims(input, { roles: [], scopes: [] }, null)
  }
  const organization =
    input.organizationId && input.claimSelection?.organizationName
      ? await deps.authorization.findOrganization(input.organizationId)
      : null
  let roleAuthorization: { roles: string[]; scopes: string[] } | null = null
  if (input.userId && input.organizationId) {
    const membership = await deps.authorization.findMemberByOrganizationUser(input.organizationId, input.userId)
    if (!membership) throw forbidden('User is not a member of the active Organization context.')
    roleAuthorization = {
      roles: membership.roles,
      scopes: resource
        ? (input.authorizedScopes ??
          (await resolveOrganizationMembershipScopes(deps, input.organizationId, membership.roles, resource.id)))
        : [],
    }
  }
  if (resource && !activeResourceEligibleForOrganization(resource, input.organizationId)) {
    return toTokenClaims({ ...input, scopes: [] }, roleAuthorization, resource, organization)
  }
  return toTokenClaims(input, roleAuthorization, resource, organization)
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
  if (!member.roles.includes('owner')) return
  const ownerCount = await deps.authorization.countMembersByRole(member.organizationId, 'owner')
  if (ownerCount <= 1) {
    throw badRequest('Transfer Organization ownership before changing or removing the last Owner.')
  }
}

async function validateOrganizationRoleKeys(deps: Deps, organizationId: string, roles: string[]) {
  const dynamic = new Set((await deps.authorization.listOrganizationRoles(organizationId)).map((role) => role.key))
  const unknown = roles.find((role) => !predefinedOrganizationRoleKeys.includes(role as never) && !dynamic.has(role))
  if (unknown) throw badRequest(`Organization Role "${unknown}" was not found.`)
}

async function rejectOwnerAssignmentByNonOwner(
  deps: Deps,
  organizationId: string,
  actorUserId: string,
  roles: string[],
  platformAdministrator: boolean,
) {
  if (!roles.includes('owner') || platformAdministrator) return
  const actor = await deps.authorization.findMemberByOrganizationUser(organizationId, actorUserId)
  if (!actor?.roles.includes('owner')) throw forbidden('Only an Organization Owner can assign the Owner Role.')
}

function authorizationAudit(
  action: string,
  ownerOrganizationId: string,
  controllerUserId: string,
  occurredAt: Date,
  metadata: Record<string, unknown>,
) {
  return {
    id: createId('agaudit'),
    action,
    result: 'allowed',
    realmOwned: false,
    ownerUserId: null,
    ownerOrganizationId,
    controllerUserId,
    subjectIssuer: null,
    subject: controllerUserId,
    agentIdentityId: null,
    hostId: null,
    resourceId: null,
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: null,
    reasonCode: null,
    metadata,
    occurredAt,
  }
}
