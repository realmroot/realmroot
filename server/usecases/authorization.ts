import { badRequest, notFound } from '@server/domain/errors'
import {
  assertRoleTokenClaimName,
  assertTokenClaims,
  createId,
  filterScopes,
  toAssignmentInput,
  toTokenClaims,
} from '@server/usecases/authorization-utils'
import type { AuthorizationRepository, RoleAssignmentScope } from '@server/usecases/ports'
import type { ApplicationOidcClaims } from '@shared/api/applications'
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

export interface AuthorizationTokenClaimInput {
  userId?: string | null
  applicationId?: string | null
  organizationId?: string
  resource?: string
  scopes: string[]
  destination?: 'access_token' | 'id_token' | 'userinfo'
  claimSelection?: ApplicationOidcClaims['accessToken']
}

export class AuthorizationService {
  constructor(private readonly repository: AuthorizationRepository) {}

  async createOrganization(input: CreateOrganizationRequest) {
    return this.repository.createOrganization({
      id: createId('org'),
      slug: input.slug,
      name: input.name,
      displayName: input.displayName ?? null,
      logo: input.logo ?? null,
      disabled: false,
      disabledReason: null,
    })
  }

  listOrganizations(pagination: PaginationQuery) {
    return this.repository.listOrganizations(pagination).then((page) => ({
      organizations: page.items,
      pagination: page.pagination,
    }))
  }

  async getOrganization(id: string) {
    const organization = await this.repository.findOrganization(id)
    if (!organization) throw notFound('Organization was not found.')
    return organization
  }

  async updateOrganization(id: string, input: UpdateOrganizationRequest) {
    await this.getOrganization(id)
    await this.repository.updateOrganization(id, input)
    return this.getOrganization(id)
  }

  async deleteOrganization(id: string) {
    await this.getOrganization(id)
    await this.repository.deleteOrganization(id)
  }

  async addMember(organizationId: string, input: AddMemberRequest) {
    await this.getOrganization(organizationId)
    return this.repository.addMember(organizationId, {
      id: createId('mem'),
      organizationId,
      userId: input.userId,
      role: input.role,
      title: input.title ?? null,
    })
  }

  async listMembers(organizationId: string, pagination: PaginationQuery) {
    await this.getOrganization(organizationId)
    const page = await this.repository.listMembers(organizationId, pagination)
    return { members: page.items, pagination: page.pagination }
  }

  async updateMember(organizationId: string, memberId: string, input: UpdateMemberRequest) {
    await this.requireMemberForOrganization(memberId, organizationId)
    await this.repository.updateMember(memberId, input)
    return this.requireMember(memberId)
  }

  async removeMember(organizationId: string, memberId: string) {
    await this.requireMemberForOrganization(memberId, organizationId)
    await this.repository.removeMember(memberId)
  }

  async createInvitation(organizationId: string, input: CreateInvitationRequest, inviterId: string) {
    await this.getOrganization(organizationId)
    return this.repository.createInvitation({
      id: createId('inv'),
      organizationId,
      email: input.email,
      role: input.role,
      inviterId,
      status: 'pending',
      expiresAt: input.expiresAt ?? new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
    })
  }

  async listInvitations(organizationId: string, pagination: PaginationQuery) {
    await this.getOrganization(organizationId)
    const page = await this.repository.listInvitations(organizationId, pagination)
    return { invitations: page.items, pagination: page.pagination }
  }

  async cancelInvitation(organizationId: string, id: string) {
    const invitation = await this.repository.findInvitation(id)
    if (!invitation || invitation.organizationId !== organizationId) {
      throw notFound('Organization invitation was not found.')
    }
    return this.repository.cancelInvitation(id)
  }

  createResource(input: CreateApiResourceRequest) {
    return this.repository.createResource({
      id: createId('res'),
      identifier: input.identifier,
      name: input.name,
      audience: input.audience,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      tokenClaimsNamespace: input.tokenClaimsNamespace ?? null,
    })
  }

  listResources(pagination: PaginationQuery) {
    return this.repository
      .listResources(pagination)
      .then((page) => ({ resources: page.items, pagination: page.pagination }))
  }

  async getResource(id: string) {
    const resource = await this.repository.findResource(id)
    if (!resource) throw notFound('API resource was not found.')
    return resource
  }

  async updateResource(id: string, input: UpdateApiResourceRequest) {
    await this.getResource(id)
    await this.repository.updateResource(id, input)
    return this.getResource(id)
  }

  async deleteResource(id: string) {
    await this.getResource(id)
    await this.repository.deleteResource(id)
  }

  async createScope(resourceId: string, input: CreateApiScopeRequest) {
    await this.getResource(resourceId)
    return this.repository.createScope(resourceId, {
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

  async listScopes(resourceId: string, pagination: PaginationQuery) {
    await this.getResource(resourceId)
    const page = await this.repository.listScopes(resourceId, pagination)
    return { scopes: page.items, pagination: page.pagination }
  }

  async updateScope(resourceId: string, id: string, input: UpdateApiScopeRequest) {
    await this.requireScopeForResource(id, resourceId)
    await this.repository.updateScope(id, input)
    return this.requireScope(id)
  }

  async deleteScope(resourceId: string, id: string) {
    await this.requireScopeForResource(id, resourceId)
    await this.repository.deleteScope(id)
  }

  async createPermission(resourceId: string, input: CreateApiPermissionRequest) {
    await this.getResource(resourceId)
    if (input.scopeId) await this.requireScopeBelongsToResource(input.scopeId, resourceId)
    return this.repository.createPermission(resourceId, {
      id: createId('perm'),
      resourceId,
      scopeId: input.scopeId ?? null,
      key: input.key,
      description: input.description ?? null,
      tokenClaimValue: input.tokenClaimValue ?? null,
    })
  }

  async listPermissions(resourceId: string, pagination: PaginationQuery) {
    await this.getResource(resourceId)
    const page = await this.repository.listPermissions(resourceId, pagination)
    return { permissions: page.items, pagination: page.pagination }
  }

  async updatePermission(resourceId: string, id: string, input: UpdateApiPermissionRequest) {
    await this.requirePermissionForResource(id, resourceId)
    if (input.scopeId) await this.requireScopeBelongsToResource(input.scopeId, resourceId)
    await this.repository.updatePermission(id, input)
    return this.requirePermission(id)
  }

  async deletePermission(resourceId: string, id: string) {
    await this.requirePermissionForResource(id, resourceId)
    await this.repository.deletePermission(id)
  }

  async createRole(input: CreateRoleRequest) {
    assertRoleTokenClaimName(input.tokenClaimName)
    return this.repository.createRole({
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

  listRoles(pagination: PaginationQuery) {
    return this.repository.listRoles(pagination).then((page) => ({ roles: page.items, pagination: page.pagination }))
  }

  async getRole(id: string) {
    const role = await this.repository.findRole(id)
    if (!role) throw notFound('Role was not found.')
    return role
  }

  async updateRole(id: string, input: UpdateRoleRequest) {
    const role = await this.getRole(id)
    assertRoleTokenClaimName(input.tokenClaimName)
    if (
      (input.resourceId !== undefined && input.resourceId !== role.resourceId) ||
      (input.organizationId !== undefined && input.organizationId !== role.organizationId) ||
      (input.applicationId !== undefined && input.applicationId !== role.applicationId)
    ) {
      throw badRequest('Role resource and subject scope cannot be changed after creation.')
    }
    await this.repository.updateRole(id, input)
    return this.getRole(id)
  }

  async deleteRole(id: string) {
    const role = await this.getRole(id)
    if (role.system) throw badRequest('System roles cannot be deleted.')
    await this.repository.deleteRole(id)
  }

  async listRolePermissions(roleId: string) {
    await this.getRole(roleId)
    return { permissions: await this.repository.listRolePermissions(roleId) }
  }

  async replaceRolePermissions(roleId: string, permissionIds: string[]) {
    const role = await this.getRole(roleId)
    for (const permissionId of permissionIds) {
      const permission = await this.requirePermission(permissionId)
      if (!role.resourceId || permission.resourceId !== role.resourceId) {
        throw badRequest('Role permissions must belong to the same API resource as the role.')
      }
    }
    await this.repository.replaceRolePermissions(roleId, permissionIds)
  }

  async assignUserRole(input: AssignRoleRequest, actorUserId: string | null) {
    const role = await this.getRole(input.roleId)
    if (role.organizationId || role.applicationId) {
      throw badRequest('User role assignments must use global roles.')
    }
    assertTokenClaims(input.tokenClaims)
    await this.repository.assignUserRole(toAssignmentInput(input, actorUserId))
  }

  async assignApplicationRole(input: AssignRoleRequest, actorUserId: string | null) {
    const role = await this.getRole(input.roleId)
    if (role.organizationId || (role.applicationId && role.applicationId !== input.subjectId)) {
      throw badRequest('Application role assignments must use global roles or roles scoped to the same application.')
    }
    assertTokenClaims(input.tokenClaims)
    await this.repository.assignApplicationRole(toAssignmentInput(input, actorUserId))
  }

  async assignMemberRole(input: AssignRoleRequest, actorUserId: string | null) {
    const role = await this.getRole(input.roleId)
    const member = await this.requireMember(input.subjectId)
    if (role.applicationId || (role.organizationId && role.organizationId !== member.organizationId)) {
      throw badRequest('Member role assignments must use global roles or roles scoped to the same organization.')
    }
    assertTokenClaims(input.tokenClaims)
    await this.repository.assignMemberRole(toAssignmentInput(input, actorUserId))
  }

  async buildTokenClaims(input: AuthorizationTokenClaimInput) {
    const resource = input.resource ? await this.repository.findResourceByAudience(input.resource) : null
    if (input.resource && !resource) {
      return toTokenClaims(input, [], null)
    }
    const scopes = input.destination ? await this.repository.listScopesByValues(resource?.id, input.scopes) : []
    const tokenScopes = input.destination ? filterScopes(input.scopes, input.destination, scopes) : input.scopes
    const organization =
      input.organizationId && input.claimSelection?.organizationName
        ? await this.repository.findOrganization(input.organizationId)
        : null
    const resourceId = resource?.id
    const scope = {
      resourceId,
      organizationId: input.organizationId,
      applicationId: input.applicationId ?? undefined,
    }
    const userAssignments = input.userId ? await this.repository.listUserRoleAssignments(input.userId, scope) : []
    const applicationAssignments = input.applicationId
      ? await this.repository.listApplicationRoleAssignments(input.applicationId, scope)
      : []
    const memberAssignments =
      input.userId && input.organizationId
        ? await this.memberAssignmentsFor(input.userId, input.organizationId, scope)
        : []

    const assignments = [...userAssignments, ...applicationAssignments, ...memberAssignments]
    return toTokenClaims({ ...input, scopes: tokenScopes }, assignments, resource, organization)
  }

  private async memberAssignmentsFor(userId: string, organizationId: string, scope: RoleAssignmentScope) {
    const member = await this.repository.findMemberByOrganizationUser(organizationId, userId)
    return member ? this.repository.listMemberRoleAssignments(member.id, scope) : []
  }

  private async requireMember(id: string) {
    const member = await this.repository.findMember(id)
    if (!member) throw notFound('Organization member was not found.')
    return member
  }

  private async requireMemberForOrganization(id: string, organizationId: string) {
    const member = await this.requireMember(id)
    if (member.organizationId !== organizationId) {
      throw notFound('Organization member was not found.')
    }
    return member
  }

  private async requireScope(id: string) {
    const scope = await this.repository.findScope(id)
    if (!scope) throw notFound('API scope was not found.')
    return scope
  }

  private async requireScopeForResource(id: string, resourceId: string) {
    const scope = await this.requireScope(id)
    if (scope.resourceId !== resourceId) {
      throw notFound('API scope was not found.')
    }
    return scope
  }

  private async requireScopeBelongsToResource(id: string, resourceId: string) {
    const scope = await this.requireScope(id)
    if (scope.resourceId !== resourceId) {
      throw badRequest('API scope must belong to the same API resource as the permission.')
    }
    return scope
  }

  private async requirePermission(id: string) {
    const permission = await this.repository.findPermission(id)
    if (!permission) throw notFound('API permission was not found.')
    return permission
  }

  private async requirePermissionForResource(id: string, resourceId: string) {
    const permission = await this.requirePermission(id)
    if (permission.resourceId !== resourceId) {
      throw notFound('API permission was not found.')
    }
    return permission
  }
}
