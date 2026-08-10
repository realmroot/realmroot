import { ApiError, badRequest, conflict, forbidden, notFound, preconditionFailed } from '@server/domain/errors'
import type { MutationActor } from '@server/domain/mutation-actor'
import { platformOrganization } from '@server/domain/platform-organization'
import {
  isRealmrootResourceServer,
  realmrootResourceServer,
  realmrootResourceUrl,
} from '@server/domain/realmroot-resource-server'
import { type AuthorizationTokenClaimInput, toTokenClaims } from '@server/usecases/authorization-utils'
import { refreshDynamicConnectorMetadata } from '@server/usecases/connectors'
import type { Deps } from '@server/usecases/deps'
import { resolveOrganizationMembershipScopes } from '@server/usecases/organization-membership-scopes'
import { validateExternalResourceConnector } from '@server/usecases/resource-connectors'
import { readProtectedResourceMetadata, synchronizeResourceDiscovery } from '@server/usecases/resource-metadata'
import {
  projectResourceOperations,
  readResourceContract,
  readResourceContractDocument,
  validateRequestedScopes,
  validateResourceUrl,
} from '@server/usecases/resource-openapi'
import { resourceScopeEntitlementLifecycle } from '@server/usecases/resource-scope-entitlements'
import { activeResourceVisibleToOrganization } from '@server/usecases/resource-visibility'

export type { AuthorizationTokenClaimInput } from '@server/usecases/authorization-utils'

import { realmrootResourceServer as internalResourceServer } from '@server/domain/realmroot-resource-server'
import { tokenExchangeGrantType } from '@shared/api/applications'
import type {
  AddMemberRequest,
  ApiResourceResponse,
  CreateApiResourceRequest,
  CreateApplicationPermissionRequest,
  CreateInvitationRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  CreateUserPermissionRequest,
  ListAuthorizedResourceServersQuery,
  ListPermissionsQuery,
  PaginationQuery,
  ReplaceMemberRolesRequest,
  RoleResponse,
  RoleScope,
  UpdateApiResourceRequest,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '@shared/api/authorization'
import {
  encodeRoleScope,
  predefinedOrganizationRoleKeys,
  predefinedOrganizationRoleScopes,
} from '@shared/organization-access'
import { realmrootScopeRegistry } from '@shared/scope-registry'

export function createOrganization(deps: Deps, input: CreateOrganizationRequest, ownerUserId: string) {
  return deps.authorization.createOrganization(
    {
      id: deps.ids.generate(),
      slug: input.slug,
      name: input.name,
      displayName: input.displayName ?? null,
      logo: input.logo ?? null,
      disabled: false,
      disabledReason: null,
    },
    {
      id: deps.ids.generate(),
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
  if (id === platformOrganization.id && input.disabled === true) {
    throw conflict('The built-in platform Organization cannot be disabled.')
  }
  await deps.authorization.updateOrganization(id, input)
  return getOrganization(deps, id)
}

export async function deleteOrganization(deps: Deps, id: string) {
  await getOrganization(deps, id)
  if (id === platformOrganization.id) throw conflict('The built-in platform Organization cannot be deleted.')
  await deps.authorization.deleteOrganization(id)
}

export async function addMember(deps: Deps, organizationId: string, input: AddMemberRequest) {
  await getOrganization(deps, organizationId)
  await validateOrganizationRoleKeys(deps, organizationId, input.roles)
  return deps.authorization.addMember(organizationId, {
    id: deps.ids.generate(),
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

export async function removeMember(deps: Deps, organizationId: string, memberId: string, actor: MutationActor) {
  const member = await requireMemberForOrganization(deps, memberId, organizationId)
  const removed = await deps.authorization.removeMember(
    organizationId,
    memberId,
    member.updatedAt,
    authorizationAudit(deps, 'organization.member.removed', organizationId, actor, new Date(), {
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
  actor: MutationActor,
) {
  const target = await requireMemberForOrganization(deps, memberId, organizationId)
  await validateOrganizationRoleKeys(deps, organizationId, input.roles)
  if (target.roles.includes('owner') && !input.roles.includes('owner')) await rejectLastOwnerMutation(deps, target)
  const now = new Date()
  const updated = await deps.authorization.replaceMemberRoles(
    organizationId,
    memberId,
    input.roles,
    target.updatedAt,
    authorizationAudit(deps, 'organization.member.roles-replaced', organizationId, actor, now, {
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
  actor: MutationActor,
) {
  await getOrganization(deps, organizationId)
  await validateOrganizationRoleKeys(deps, organizationId, input.roles)
  return deps.authorization.createInvitation({
    id: deps.ids.generate(),
    organizationId,
    email: input.email,
    roles: input.roles,
    inviterId: actor.controllerUserId,
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
  if (input.accessMode !== 'realmroot' && ownerOrganizationId !== platformOrganization.id) {
    throw badRequest('Provider-connected Resource Servers must be owned by the built-in platform Organization.')
  }
  await requireActiveOrganization(deps, ownerOrganizationId)
  validateResourceUrl(input.resourceUrl)
  const authorizationDetails = input.authorizationDetails ?? []
  const protectedMetadata =
    enabled || input.connectorId || authorizationDetails.length > 0
      ? await readProtectedResourceMetadata(deps, input.resourceUrl)
      : null
  await validateResourceProviderBoundary(
    deps,
    input.resourceUrl,
    input.accessMode,
    input.connectorId ?? null,
    authorizationDetails,
    protectedMetadata,
  )
  const synchronized = enabled
    ? await synchronizeResourceDiscovery(deps, input.resourceUrl, null, protectedMetadata!)
    : null
  const contract = synchronized ?? (await readResourceContract(deps, input.resourceUrl))
  if (!contract) throw new Error('Unconditional Resource Server contract read returned no document.')
  return deps.authorization.createResource({
    id: deps.ids.generate(),
    identifier: input.identifier,
    name: contract.name,
    resourceUrl: input.resourceUrl,
    accessMode: input.accessMode,
    connectorId: input.connectorId ?? null,
    authorizationDetails,
    description: contract.description,
    enabled,
    ownerOrganizationId,
    visibility: input.visibility ?? 'private',
    scopeRegistry: synchronized?.scopeRegistry ?? null,
    availableToAgents: input.availableToAgents ?? true,
  })
}

export async function ensureRealmrootResourceServer(deps: Deps, apiOrigin: string) {
  const existing = await reconcileRealmrootResourceServer(deps, apiOrigin)
  if (existing) return existing
  return deps.authorization.createResource({
    ...realmrootResourceServer,
    resourceUrl: realmrootResourceUrl(apiOrigin),
    accessMode: 'realmroot',
    connectorId: null,
    authorizationDetails: [],
    enabled: true,
    visibility: 'public',
    scopeRegistry: realmrootRegistry(apiOrigin),
    availableToAgents: true,
  })
}

export async function reconcileRealmrootResourceServer(deps: Deps, apiOrigin: string) {
  const resourceUrl = realmrootResourceUrl(apiOrigin)
  const existing = await deps.authorization.findResource(realmrootResourceServer.id)
  if (existing) {
    assertRealmrootResourceServerIdentity(existing)
    const registry = realmrootRegistry(apiOrigin)
    const resourceUrlChanged = existing.resourceUrl !== resourceUrl
    const registryChanged = !isCurrentRealmrootRegistry(existing.scopeRegistry, registry)
    if (!resourceUrlChanged && !registryChanged) return existing
    if (resourceUrlChanged && !(await deps.authorization.updateResource(existing.id, { resourceUrl }))) {
      throw new Error('The persisted Realmroot Resource Server could not be reconciled.')
    }
    if (
      registryChanged &&
      !(await deps.authorization.replaceResourceDiscovery(existing.id, {
        name: existing.name,
        description: existing.description,
        scopeRegistry: registry,
      }))
    ) {
      throw new Error('The persisted Realmroot Resource Server could not be reconciled.')
    }
    const reconciled = await deps.authorization.findResource(existing.id)
    if (!reconciled) {
      throw new Error('The persisted Realmroot Resource Server could not be reconciled.')
    }
    assertRealmrootResourceServerIdentity(reconciled)
    if (reconciled.resourceUrl !== resourceUrl || !isCurrentRealmrootRegistry(reconciled.scopeRegistry, registry)) {
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
    resource.accessMode !== 'realmroot' ||
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
  const contract = isRealmrootResourceServer(id)
    ? await readResourceContractDocument(
        deps,
        resource.scopeRegistry?.discovery.sourceUrl ?? `${resource.resourceUrl}/openapi.json`,
      )
    : await readResourceContract(deps, resource.resourceUrl)
  if (!contract) throw new Error('Unconditional Resource Server contract read returned no document.')
  const scopes = resource.scopeRegistry?.scopes ?? []
  const operations = projectResourceOperations(
    contract.operations,
    scopes.map((scope) => scope.value),
  )
  const { name: _name, description: _description, ...publishedContract } = contract
  return {
    resourceId: resource.id,
    ...publishedContract,
    operations,
    scopes,
  }
}

export async function refreshResourceScopeRegistry(deps: Deps, id: string) {
  const resource = await getResource(deps, id)
  if (!resource.enabled) throw badRequest('Resource Server must be active before synchronizing scopes.')
  if (isRealmrootResourceServer(id)) {
    const registry = realmrootRegistry(new URL(resource.resourceUrl).origin)
    if (
      !(await deps.authorization.replaceResourceDiscovery(id, {
        name: resource.name,
        description: resource.description,
        scopeRegistry: registry,
      }))
    ) {
      throw badRequest('Resource Server is no longer active.')
    }
    return getResource(deps, id)
  }
  try {
    const metadata = await readProtectedResourceMetadata(deps, resource.resourceUrl)
    if (resource.connectorId) {
      if (resource.accessMode === 'external_oauth') await refreshDynamicConnectorMetadata(deps, resource.connectorId)
      await validateResourceProviderBoundary(
        deps,
        resource.resourceUrl,
        resource.accessMode,
        resource.connectorId,
        resource.authorizationDetails,
        metadata,
        resource.id,
      )
    }
    const discovery = await synchronizeResourceDiscovery(deps, resource.resourceUrl, resource.scopeRegistry, metadata)
    if (!(await deps.authorization.replaceResourceDiscovery(id, discovery))) {
      throw badRequest('Resource Server is no longer active.')
    }
    return getResource(deps, id)
  } catch (error) {
    if (resource.scopeRegistry) {
      await deps.authorization.replaceResourceDiscovery(id, {
        name: resource.name,
        description: resource.description,
        scopeRegistry: {
          ...resource.scopeRegistry,
          discovery: { ...resource.scopeRegistry.discovery, lastError: synchronizationError(error) },
        },
      })
    }
    throw error
  }
}

export async function synchronizeEnabledResourceScopeRegistries(deps: Deps) {
  const resources = (await deps.authorization.listEnabledResources()).filter(
    (resource) => !isRealmrootResourceServer(resource.id),
  )
  for (const resource of resources) {
    try {
      await refreshResourceScopeRegistry(deps, resource.id)
    } catch {
      // A failed registry records its boundary error while the remaining Resource Servers continue synchronizing.
    }
  }
}

function synchronizationError(error: unknown) {
  return error instanceof ApiError
    ? { code: error.code, message: error.message }
    : { code: 'internal_error', message: error instanceof Error ? error.message : 'Scope synchronization failed.' }
}

export async function updateResource(deps: Deps, id: string, input: UpdateApiResourceRequest) {
  const resource = await getResource(deps, id)
  if (isRealmrootResourceServer(id)) throw badRequest('The Realmroot Resource Server is system-managed.')
  if (input.resourceUrl !== undefined) validateResourceUrl(input.resourceUrl)
  if (input.ownerOrganizationId) await requireActiveOrganization(deps, input.ownerOrganizationId)
  const connectorId = resource.connectorId
  const ownerOrganizationId = input.ownerOrganizationId ?? resource.ownerOrganizationId
  if (resource.accessMode !== 'realmroot' && ownerOrganizationId !== platformOrganization.id) {
    throw badRequest('Provider-connected Resource Servers must be owned by the built-in platform Organization.')
  }
  const resourceUrl = input.resourceUrl ?? resource.resourceUrl
  const authorizationDetails = input.authorizationDetails ?? resource.authorizationDetails
  const enabled = input.enabled ?? resource.enabled
  const boundaryChanged = input.resourceUrl !== undefined || input.authorizationDetails !== undefined
  const shouldReadBoundary = boundaryChanged || input.enabled === true
  const protectedMetadata = shouldReadBoundary ? await readProtectedResourceMetadata(deps, resourceUrl) : null
  if (shouldReadBoundary) {
    await validateResourceProviderBoundary(
      deps,
      resourceUrl,
      resource.accessMode,
      connectorId,
      authorizationDetails,
      protectedMetadata,
      resource.id,
    )
  }
  const shouldSynchronize = enabled && (input.enabled === true || input.resourceUrl !== undefined)
  const synchronized = shouldSynchronize
    ? await synchronizeResourceDiscovery(
        deps,
        resourceUrl,
        input.resourceUrl ? null : resource.scopeRegistry,
        protectedMetadata!,
      )
    : null
  const scopeRegistry = input.scopeGrantModes
    ? updateScopeGrantModes(synchronized?.scopeRegistry ?? resource.scopeRegistry, input.scopeGrantModes)
    : (synchronized?.scopeRegistry ?? null)
  const resourcePatch = synchronized
    ? { ...input, name: synchronized.name, description: synchronized.description }
    : input
  if (!(await deps.authorization.updateResource(id, resourcePatch))) {
    throw notFound('API resource was not found.')
  }
  if (
    scopeRegistry &&
    !(await deps.authorization.replaceResourceDiscovery(id, {
      name: synchronized?.name ?? resource.name,
      description: synchronized?.description ?? resource.description,
      scopeRegistry,
    }))
  ) {
    throw notFound('API resource was not found.')
  }
  return getResource(deps, id)
}

async function validateResourceProviderBoundary(
  deps: Deps,
  resourceUrl: string,
  accessMode: ApiResourceResponse['accessMode'],
  connectorId: string | null,
  authorizationDetails: NonNullable<CreateApiResourceRequest['authorizationDetails']>,
  protectedMetadata: Awaited<ReturnType<typeof readProtectedResourceMetadata>> | null,
  currentResourceId?: string,
) {
  const brokered = protectedMetadata?.accountConnection?.mode === 'brokered'
  if (accessMode === 'brokered') {
    if (!connectorId) {
      throw badRequest('A brokered account connection Resource Server must select a Provider Connector.')
    }
    if (!brokered) {
      throw badRequest('A brokered Resource Server must advertise brokered account connection metadata.')
    }
    const connector = await deps.connectors.findById(connectorId)
    if (!connector?.enabled) throw badRequest('Provider Connector must be enabled for brokered account connection.')
    const existingAuthority = (await deps.authorization.listEnabledResources()).find(
      (resource) =>
        resource.id !== currentResourceId &&
        resource.accessMode === 'brokered' &&
        resource.connectorId === connectorId &&
        resource.scopeRegistry?.accountConnection?.mode === 'brokered',
    )
    if (existingAuthority) throw conflict('Provider Connector already has an account connection authority.')
    return
  }
  if (brokered) {
    throw badRequest('Brokered account connection metadata requires brokered provider access.')
  }
  if (accessMode === 'external_oauth') {
    if (!connectorId) throw badRequest('External OAuth access requires a Provider Connector.')
    await validateExternalResourceConnector(deps, resourceUrl, connectorId, authorizationDetails, protectedMetadata!)
    return
  }
  if (connectorId) throw badRequest('Realmroot access cannot select a Provider Connector.')
  if (authorizationDetails.length > 0) {
    throw badRequest('Authorization details require external OAuth or brokered provider access.')
  }
}

async function requireActiveOrganization(deps: Deps, organizationId: string) {
  const organization = await getOrganization(deps, organizationId)
  if (organization.disabled) throw badRequest('Organization must be active.')
  return organization
}

function resourceMutationAudit(
  deps: Deps,
  resourceId: string,
  ownerOrganizationId: string,
  occurredAt: Date,
  actor: MutationActor,
) {
  return {
    id: deps.ids.generate(),
    action: 'api_resource.deleted',
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
    accessRequestId: null,
    scopes: null,
    reasonCode: null,
    metadata: { authorizationRecordsRevoked: true },
    occurredAt,
  }
}

export async function deleteResource(deps: Deps, id: string, actor: MutationActor) {
  const resource = await getResource(deps, id)
  if (isRealmrootResourceServer(id)) throw badRequest('The Realmroot Resource Server is system-managed.')
  const now = new Date()
  if (
    !(await deps.authorization.deleteResource(
      id,
      now,
      resourceMutationAudit(deps, id, resource.ownerOrganizationId, now, actor),
    ))
  ) {
    throw notFound('API resource was not found.')
  }
}

export async function createUserPermission(
  deps: Deps,
  userId: string,
  input: CreateUserPermissionRequest,
  actor: MutationActor,
) {
  await deps.users.getUser(userId)
  const resource = await getResource(deps, input.resourceServerId)
  if (!resource.enabled) throw badRequest('Resource Server must be active.')
  validateAssignedScope(resource, input.scope)
  if (resource.visibility === 'private') {
    const membership = await deps.authorization.findMemberByOrganizationUser(resource.ownerOrganizationId, userId)
    if (!membership) throw badRequest('Private Resource Server grants require an owner Organization member.')
  }
  if (input.organizationId) {
    const membership = await deps.authorization.findMemberByOrganizationUser(input.organizationId, userId)
    if (!membership) throw badRequest('User Permission Organization must contain the target user.')
    if (!activeResourceVisibleToOrganization(resource, input.organizationId)) {
      throw badRequest('Resource Server is not visible to the grant Organization.')
    }
  }
  const now = new Date()
  const expiresAt = input.mode === 'until' && input.expiresAt ? new Date(input.expiresAt) : null
  if (input.mode === 'until' && !expiresAt) throw badRequest('Until Permissions require an expiry.')
  if (input.mode === 'persistent' && input.expiresAt) throw badRequest('Persistent Permissions cannot expire.')
  if (expiresAt && expiresAt.getTime() <= now.getTime()) throw badRequest('Permission expiry must be in the future.')
  return toPermissionResponse(
    await deps.authorization.createScopeEntitlement(
      {
        id: deps.ids.generate(),
        userId,
        applicationId: null,
        agentIdentityId: null,
        organizationId: input.organizationId ?? null,
        resourceServerId: resource.id,
        connectionId: null,
        authorizationDetails: [],
        authorizationContextHash: await authorizationContextHash([]),
        scope: input.scope,
        mode: input.mode,
        ...entitlementGrantor(actor),
        sourceAccessRequestId: null,
        expiresAt,
        endedAt: null,
        endReason: null,
        createdAt: now,
        updatedAt: now,
      },
      now,
    ),
  )
}

export async function getUserPermission(deps: Deps, id: string) {
  const entitlement = await deps.authorization.findScopeEntitlement(id)
  if (!entitlement?.userId) throw notFound('User Permission was not found.')
  return toPermissionResponse(entitlement)
}

export async function listUserPermissions(
  deps: Deps,
  userId: string,
  query: ListPermissionsQuery,
  ownerOrganizationIds?: string[],
) {
  await deps.users.getUser(userId)
  const result = await deps.authorization.listUserPermissions(userId, query, ownerOrganizationIds)
  return { items: result.items.map(toPermissionResponse), pagination: result.pagination }
}

export async function listUserAuthorizedResourceServers(
  deps: Deps,
  userId: string,
  query: ListAuthorizedResourceServersQuery,
  ownerOrganizationIds?: string[],
) {
  await deps.users.getUser(userId)
  return deps.authorization.listAuthorizedResourceServers(
    { type: 'user', id: userId },
    query,
    new Date(),
    ownerOrganizationIds,
  )
}

export async function revokeUserPermission(deps: Deps, id: string) {
  await getUserPermission(deps, id)
  if (!(await deps.authorization.endScopeEntitlement(id, 'revoked', new Date()))) {
    throw conflict('User Permission is already ended.')
  }
}

export async function createApplicationPermission(
  deps: Deps,
  applicationId: string,
  input: CreateApplicationPermissionRequest,
  actor: MutationActor,
) {
  const [resource, application] = await Promise.all([
    getResource(deps, input.resourceServerId),
    deps.applications.findById(applicationId),
  ])
  if (!application) throw notFound('Application was not found.')
  if (
    !application.allowedGrantTypes.some(
      (grantType) => grantType === 'client_credentials' || grantType === tokenExchangeGrantType,
    )
  ) {
    throw badRequest('Application Scope Grants require a machine-principal grant type.')
  }
  if (!activeResourceVisibleToOrganization(resource, application.ownerOrganizationId)) {
    throw badRequest('Resource Server is not visible to the Application owner Organization.')
  }
  validateAssignedScope(resource, input.scope)
  const now = new Date()
  const expiresAt = input.mode === 'until' && input.expiresAt ? new Date(input.expiresAt) : null
  if (input.mode === 'until' && !expiresAt) throw badRequest('Until Permissions require an expiry.')
  if (input.mode === 'persistent' && input.expiresAt) throw badRequest('Persistent Permissions cannot expire.')
  if (expiresAt && expiresAt.getTime() <= now.getTime()) throw badRequest('Permission expiry must be in the future.')
  return toPermissionResponse(
    await deps.authorization.createScopeEntitlement(
      {
        id: deps.ids.generate(),
        userId: null,
        applicationId: application.id,
        agentIdentityId: null,
        organizationId: null,
        resourceServerId: resource.id,
        connectionId: null,
        authorizationDetails: [],
        authorizationContextHash: await authorizationContextHash([]),
        scope: input.scope,
        mode: input.mode,
        ...entitlementGrantor(actor),
        sourceAccessRequestId: null,
        expiresAt,
        endedAt: null,
        endReason: null,
        createdAt: now,
        updatedAt: now,
      },
      now,
    ),
  )
}

export async function getApplicationPermission(deps: Deps, id: string) {
  const entitlement = await deps.authorization.findScopeEntitlement(id)
  if (!entitlement?.applicationId) throw notFound('Application Permission was not found.')
  return toPermissionResponse(entitlement)
}

export async function listApplicationPermissions(deps: Deps, applicationId: string, query: ListPermissionsQuery) {
  const result = await deps.authorization.listApplicationPermissions(applicationId, query)
  return { items: result.items.map(toPermissionResponse), pagination: result.pagination }
}

export async function listApplicationAuthorizedResourceServers(
  deps: Deps,
  applicationId: string,
  query: ListAuthorizedResourceServersQuery,
) {
  const application = await deps.applications.findById(applicationId)
  if (!application) throw notFound('Application was not found.')
  return deps.authorization.listAuthorizedResourceServers({ type: 'application', id: applicationId }, query, new Date())
}

export async function revokeApplicationPermission(deps: Deps, id: string) {
  await getApplicationPermission(deps, id)
  if (!(await deps.authorization.endScopeEntitlement(id, 'revoked', new Date()))) {
    throw conflict('Application Permission is already ended.')
  }
}

function validateAssignedScope(resource: ApiResourceResponse, scope: string) {
  const assigned = new Set(
    resource.scopeRegistry?.scopes.filter((scope) => scope.grantMode === 'assigned').map((scope) => scope.value) ?? [],
  )
  if (!assigned.has(scope)) {
    throw badRequest('Direct grants may reference only assigned scopes in the current Resource Server registry.')
  }
}

function toPermissionResponse(entitlement: Awaited<ReturnType<Deps['authorization']['createScopeEntitlement']>>) {
  const lifecycle = resourceScopeEntitlementLifecycle(entitlement)
  const { grantedByUserId, grantedByAgentIdentityId, ...representation } = entitlement
  const subjectPath = entitlement.userId
    ? `users/${encodeURIComponent(entitlement.userId)}`
    : `applications/${encodeURIComponent(entitlement.applicationId!)}`
  return {
    ...representation,
    ...lifecycle,
    grantedBy: grantedByUserId
      ? { type: 'user' as const, id: grantedByUserId }
      : { type: 'agent' as const, id: grantedByAgentIdentityId! },
    expiresAt: entitlement.expiresAt?.toISOString() ?? null,
    endedAt: entitlement.endedAt?.toISOString() ?? null,
    createdAt: entitlement.createdAt.toISOString(),
    updatedAt: entitlement.updatedAt.toISOString(),
    links: {
      self: `/api/${subjectPath}/permissions/${encodeURIComponent(entitlement.id)}`,
      resourceServer: `/api/resource-servers/${encodeURIComponent(entitlement.resourceServerId)}`,
    },
  }
}

function entitlementGrantor(actor: MutationActor) {
  if (actor.controllerUserId) return { grantedByUserId: actor.controllerUserId, grantedByAgentIdentityId: null }
  if (actor.agent) return { grantedByUserId: null, grantedByAgentIdentityId: actor.agent.identityId }
  throw new Error('Permission administration requires an authenticated mutation actor.')
}

async function authorizationContextHash(details: unknown[]) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(details)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createRole(deps: Deps, organizationId: string, input: CreateRoleRequest, actor: MutationActor) {
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
    authorizationAudit(deps, 'organization.role.created', organizationId, actor, now, {
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
  actor: MutationActor,
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
    authorizationAudit(deps, 'organization.role.updated', organizationId, actor, now, { organizationId, roleKey }),
  )
  if (!updated) throw preconditionFailed('The Organization Role changed after it was read.')
  return getRole(deps, organizationId, roleKey)
}

export async function deleteRole(deps: Deps, organizationId: string, roleKey: string, actor: MutationActor) {
  const role = await getRole(deps, organizationId, roleKey)
  if (role.predefined) throw conflict('Predefined Organization Roles cannot be deleted.')
  const now = new Date()
  const result = await deps.authorization.deleteOrganizationRole(
    organizationId,
    roleKey,
    role.updatedAt!,
    authorizationAudit(deps, 'organization.role.deleted', organizationId, actor, now, { organizationId, roleKey }),
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
    if (!activeResourceVisibleToOrganization(resource, organizationId)) {
      throw badRequest('Resource Server is not visible to this Organization.')
    }
    if (resourceId === internalResourceServer.id) {
      if (requestedScopes.some((scope) => !(scope in realmrootScopeRegistry))) {
        throw badRequest('Requested scope is not declared by the Realmroot Scope Registry.')
      }
      continue
    }
    validateRequestedScopes(resource.scopeRegistry, requestedScopes)
    const assigned = new Set(
      resource.scopeRegistry?.scopes.filter((scope) => scope.grantMode === 'assigned').map((scope) => scope.value) ??
        [],
    )
    if (requestedScopes.some((scope) => !assigned.has(scope))) {
      throw badRequest('Organization Roles may reference only assigned scopes.')
    }
  }
}

function toBetterAuthPermission(scopes: RoleScope[]) {
  return { scope: scopes.map(({ resourceId, scope }) => encodeRoleScope(resourceId, scope)) }
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
  if (resource && input.organizationId && !activeResourceVisibleToOrganization(resource, input.organizationId)) {
    return toTokenClaims({ ...input, scopes: [] }, roleAuthorization, resource, organization)
  }
  return toTokenClaims(input, roleAuthorization, resource, organization)
}

function updateScopeGrantModes(
  registry: ApiResourceResponse['scopeRegistry'],
  updates: NonNullable<UpdateApiResourceRequest['scopeGrantModes']>,
) {
  if (!registry) throw badRequest('Resource Server scopes must be synchronized before grant modes can be changed.')
  const modes = new Map(updates.map((item) => [item.scope, item.grantMode]))
  const declared = new Set(registry.scopes.map((scope) => scope.value))
  const unknown = updates.find((item) => !declared.has(item.scope))
  if (unknown) throw badRequest(`Scope "${unknown.scope}" is not declared by the Resource Server.`)
  return {
    ...registry,
    scopes: registry.scopes.map((scope) => ({ ...scope, grantMode: modes.get(scope.value) ?? scope.grantMode })),
  }
}

function realmrootRegistry(apiOrigin: string): NonNullable<ApiResourceResponse['scopeRegistry']> {
  return {
    discovery: {
      sourceUrl: `${realmrootResourceUrl(apiOrigin)}/openapi.json`,
      etag: null,
      documentHash: 'system-managed',
      syncedAt: new Date().toISOString(),
      lastError: null,
    },
    scopes: Object.keys(realmrootScopeRegistry).map((value) => ({ value, description: null, grantMode: 'assigned' })),
  }
}

function isCurrentRealmrootRegistry(
  actual: ApiResourceResponse['scopeRegistry'],
  expected: NonNullable<ApiResourceResponse['scopeRegistry']>,
) {
  if (
    !actual ||
    actual.discovery.sourceUrl !== expected.discovery.sourceUrl ||
    actual.discovery.documentHash !== expected.discovery.documentHash ||
    actual.discovery.etag !== null ||
    actual.discovery.lastError !== null ||
    actual.scopes.length !== expected.scopes.length
  ) {
    return false
  }
  const actualScopes = new Map(actual.scopes.map((scope) => [scope.value, scope]))
  return expected.scopes.every((scope) => {
    const candidate = actualScopes.get(scope.value)
    return candidate?.description === scope.description && candidate.grantMode === scope.grantMode
  })
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

function authorizationAudit(
  deps: Deps,
  action: string,
  ownerOrganizationId: string,
  actor: MutationActor,
  occurredAt: Date,
  metadata: Record<string, unknown>,
) {
  return {
    id: deps.ids.generate(),
    action,
    result: 'allowed',
    realmOwned: false,
    ownerUserId: null,
    ownerOrganizationId,
    controllerUserId: actor.controllerUserId,
    subjectIssuer: actor.agent?.issuer ?? null,
    subject: actor.agent?.subject ?? actor.controllerUserId,
    agentIdentityId: actor.agent?.identityId ?? null,
    hostId: actor.agent?.hostId ?? null,
    resourceId: null,
    resourceConnectionId: null,
    accessRequestId: null,
    scopes: null,
    reasonCode: null,
    metadata,
    occurredAt,
  }
}
