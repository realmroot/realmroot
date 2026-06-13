import {
  assignUserRole,
  createResource,
  createRole,
  deleteResource,
  getResource,
  listRoles,
  updateResource,
  updateRole,
} from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import type { AuthorizationRepository, RoleAssignmentRecord } from '@server/usecases/ports'
import type { PaginationQuery } from '@shared/api/authorization'
import { describe, expect, it } from 'vitest'

describe('service.test 3', () => {
  it('updates and deletes API resources and lists roles', async () => {
    const deps = { authorization: new InMemoryAuthorizationRepository() } as unknown as Deps
    const resource = await createResource(deps, {
      identifier: 'orders-api',
      name: 'Orders API',
      audience: 'https://api.example.com/orders',
    })
    const role = await createRole(deps, {
      key: 'orders-reader',
      name: 'Orders Reader',
      resourceId: resource.id,
    })

    await expect(updateResource(deps, resource.id, { enabled: false })).resolves.toMatchObject({
      id: resource.id,
      enabled: false,
    })
    await expect(listRoles(deps, { limit: 20, offset: 0 })).resolves.toMatchObject({
      roles: [{ id: role.id, key: 'orders-reader' }],
      pagination: { total: 1 },
    })
    await deleteResource(deps, resource.id)
    await expect(getResource(deps, resource.id)).rejects.toMatchObject({
      status: 404,
      message: 'API resource was not found.',
    })
  })

  it('keeps role scope immutable and rejects token claim overrides', async () => {
    const deps = { authorization: new InMemoryAuthorizationRepository() } as unknown as Deps
    const role = await createRole(deps, {
      key: 'auditor',
      name: 'Auditor',
    })

    await expect(updateRole(deps, role.id, { organizationId: 'org-1' })).rejects.toMatchObject({
      status: 400,
      message: 'Role resource and subject scope cannot be changed after creation.',
    })
    await expect(updateRole(deps, role.id, { resourceId: 'resource-1' })).rejects.toMatchObject({
      status: 400,
      message: 'Role resource and subject scope cannot be changed after creation.',
    })
    await expect(updateRole(deps, role.id, { applicationId: 'app-1' })).rejects.toMatchObject({
      status: 400,
      message: 'Role resource and subject scope cannot be changed after creation.',
    })
    await expect(
      assignUserRole(
        deps,
        {
          roleId: role.id,
          subjectId: 'user-1',
          tokenClaims: {
            authorization: { roles: ['admin'] },
          },
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Assignment token claim is reserved: authorization',
    })
    await expect(
      assignUserRole(
        deps,
        {
          roleId: role.id,
          subjectId: 'user-1',
          tokenClaims: {
            'https://claims.example.com/contacts': { contacts_role: 'admin' },
          },
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Assignment token claim is reserved: https://claims.example.com/contacts',
    })
    await expect(
      createRole(deps, {
        key: 'claim-overrider',
        name: 'Claim Overrider',
        tokenClaimName: 'roles',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Role token claim name is reserved: roles',
    })
    await expect(
      updateRole(deps, role.id, { tokenClaimName: 'https://claims.example.com/contacts' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Role token claim name is reserved: https://claims.example.com/contacts',
    })
  })
})

type Organization = Awaited<ReturnType<AuthorizationRepository['createOrganization']>>
type Member = Awaited<ReturnType<AuthorizationRepository['addMember']>>
type Invitation = Awaited<ReturnType<AuthorizationRepository['createInvitation']>>
type Resource = Awaited<ReturnType<AuthorizationRepository['createResource']>>
type Scope = Awaited<ReturnType<AuthorizationRepository['createScope']>>
type Permission = Awaited<ReturnType<AuthorizationRepository['createPermission']>>
type Role = Awaited<ReturnType<AuthorizationRepository['createRole']>>

class InMemoryAuthorizationRepository implements AuthorizationRepository {
  private organizations = new Map<string, Organization>()
  private members = new Map<string, Member>()
  private invitations = new Map<string, Invitation>()
  private resources = new Map<string, Resource>()
  private scopes = new Map<string, Scope>()
  private permissions = new Map<string, Permission>()
  private roles = new Map<string, Role>()
  private rolePermissions = new Map<string, string[]>()
  private userAssignments = new Map<string, RoleAssignmentRecord[]>()
  private applicationAssignments = new Map<string, RoleAssignmentRecord[]>()
  private memberAssignments = new Map<string, RoleAssignmentRecord[]>()

  async createOrganization(input: Parameters<AuthorizationRepository['createOrganization']>[0]) {
    const organization = { ...input, createdAt: now(), updatedAt: now() }
    this.organizations.set(organization.id, organization)
    return organization
  }

  async listOrganizations(pagination: PaginationQuery) {
    return page([...this.organizations.values()], pagination)
  }

  async findOrganization(id: string) {
    return this.organizations.get(id) ?? null
  }

  async updateOrganization(id: string, patch: Parameters<AuthorizationRepository['updateOrganization']>[1]) {
    const organization = this.organizations.get(id)
    if (organization) this.organizations.set(id, { ...organization, ...defined(patch), updatedAt: now() })
  }

  async deleteOrganization(id: string) {
    this.organizations.delete(id)
  }

  async addMember(_organizationId: string, input: Parameters<AuthorizationRepository['addMember']>[1]) {
    const member = { ...input, createdAt: now(), updatedAt: now() }
    this.members.set(member.id, member)
    return member
  }

  async listMembers(organizationId: string, pagination: PaginationQuery) {
    return page(
      [...this.members.values()].filter((member) => member.organizationId === organizationId),
      pagination,
    )
  }

  async findMember(id: string) {
    return this.members.get(id) ?? null
  }

  async findMemberByOrganizationUser(organizationId: string, userId: string) {
    return (
      [...this.members.values()].find(
        (member) => member.organizationId === organizationId && member.userId === userId,
      ) ?? null
    )
  }

  async updateMember(id: string, patch: Parameters<AuthorizationRepository['updateMember']>[1]) {
    const member = this.members.get(id)
    if (member) this.members.set(id, { ...member, ...defined(patch), updatedAt: now() })
  }

  async removeMember(id: string) {
    this.members.delete(id)
  }

  async createInvitation(input: Parameters<AuthorizationRepository['createInvitation']>[0]) {
    const invitation = { ...input, acceptedAt: null, revokedAt: null, createdAt: now() }
    this.invitations.set(invitation.id, invitation)
    return invitation
  }

  async listInvitations(organizationId: string, pagination: PaginationQuery) {
    return page(
      [...this.invitations.values()].filter((invitation) => invitation.organizationId === organizationId),
      pagination,
    )
  }

  async findInvitation(id: string) {
    return this.invitations.get(id) ?? null
  }

  async cancelInvitation(id: string) {
    const invitation = this.invitations.get(id)
    if (invitation) this.invitations.set(id, { ...invitation, status: 'canceled', revokedAt: now() })
  }

  async createResource(input: Parameters<AuthorizationRepository['createResource']>[0]) {
    const resource = { ...input, createdAt: now(), updatedAt: now() }
    this.resources.set(resource.id, resource)
    return resource
  }

  async listResources(pagination: PaginationQuery) {
    return page([...this.resources.values()], pagination)
  }

  async findResource(id: string) {
    return this.resources.get(id) ?? null
  }

  async findResourceByAudience(audience: string) {
    return [...this.resources.values()].find((resource) => resource.audience === audience && resource.enabled) ?? null
  }

  async updateResource(id: string, patch: Parameters<AuthorizationRepository['updateResource']>[1]) {
    const resource = this.resources.get(id)
    if (resource) this.resources.set(id, { ...resource, ...defined(patch), updatedAt: now() })
  }

  async deleteResource(id: string) {
    this.resources.delete(id)
  }

  async createScope(_resourceId: string, input: Parameters<AuthorizationRepository['createScope']>[1]) {
    this.scopes.set(input.id, input)
    return input
  }

  async listScopes(resourceId: string, pagination: PaginationQuery) {
    return page(
      [...this.scopes.values()].filter((scope) => scope.resourceId === resourceId),
      pagination,
    )
  }

  async listScopesByValues(resourceId: string | undefined, values: string[]) {
    return [...this.scopes.values()].filter(
      (scope) => (!resourceId || scope.resourceId === resourceId) && values.includes(scope.value),
    )
  }

  async findScope(id: string) {
    return this.scopes.get(id) ?? null
  }

  async updateScope(id: string, patch: Parameters<AuthorizationRepository['updateScope']>[1]) {
    const scope = this.scopes.get(id)
    if (scope) this.scopes.set(id, { ...scope, ...defined(patch) })
  }

  async deleteScope(id: string) {
    this.scopes.delete(id)
  }

  async createPermission(_resourceId: string, input: Parameters<AuthorizationRepository['createPermission']>[1]) {
    this.permissions.set(input.id, input)
    return input
  }

  async listPermissions(resourceId: string, pagination: PaginationQuery) {
    return page(
      [...this.permissions.values()].filter((permission) => permission.resourceId === resourceId),
      pagination,
    )
  }

  async findPermission(id: string) {
    return this.permissions.get(id) ?? null
  }

  async updatePermission(id: string, patch: Parameters<AuthorizationRepository['updatePermission']>[1]) {
    const permission = this.permissions.get(id)
    if (permission) this.permissions.set(id, { ...permission, ...defined(patch) })
  }

  async deletePermission(id: string) {
    this.permissions.delete(id)
  }

  async createRole(input: Parameters<AuthorizationRepository['createRole']>[0]) {
    const role = { ...input, createdAt: now(), updatedAt: now() }
    this.roles.set(role.id, role)
    return role
  }

  async listRoles(pagination: PaginationQuery) {
    return page([...this.roles.values()], pagination)
  }

  async findRole(id: string) {
    return this.roles.get(id) ?? null
  }

  async updateRole(id: string, patch: Parameters<AuthorizationRepository['updateRole']>[1]) {
    const role = this.roles.get(id)
    if (role) this.roles.set(id, { ...role, ...defined(patch), updatedAt: now() })
  }

  async deleteRole(id: string) {
    this.roles.delete(id)
  }

  async listRolePermissions(roleId: string) {
    return this.permissionsFor(roleId)
  }

  async replaceRolePermissions(roleId: string, permissionIds: string[]) {
    this.rolePermissions.set(roleId, permissionIds)
  }

  async assignUserRole(input: Parameters<AuthorizationRepository['assignUserRole']>[0]) {
    this.addAssignment(this.userAssignments, input.subjectId, input)
  }

  async assignApplicationRole(input: Parameters<AuthorizationRepository['assignApplicationRole']>[0]) {
    this.addAssignment(this.applicationAssignments, input.subjectId, input)
  }

  async assignMemberRole(input: Parameters<AuthorizationRepository['assignMemberRole']>[0]) {
    this.addAssignment(this.memberAssignments, input.subjectId, input)
  }

  async listUserRoleAssignments(
    userId: string,
    scope: Parameters<AuthorizationRepository['listUserRoleAssignments']>[1],
  ) {
    return this.assignmentsFor(this.userAssignments, userId, scope)
  }

  async listApplicationRoleAssignments(
    applicationId: string,
    scope: Parameters<AuthorizationRepository['listApplicationRoleAssignments']>[1],
  ) {
    return this.assignmentsFor(this.applicationAssignments, applicationId, { ...scope, applicationId })
  }

  async listMemberRoleAssignments(
    memberId: string,
    scope: Parameters<AuthorizationRepository['listMemberRoleAssignments']>[1],
  ) {
    return this.assignmentsFor(this.memberAssignments, memberId, scope)
  }

  private addAssignment(
    assignments: Map<string, RoleAssignmentRecord[]>,
    subjectId: string,
    input: Parameters<AuthorizationRepository['assignUserRole']>[0],
  ) {
    const role = this.roles.get(input.roleId)
    if (!role) return
    assignments.set(subjectId, [
      ...(assignments.get(subjectId) ?? []),
      {
        role,
        permissions: this.permissionsFor(role.id),
        tokenClaims: input.tokenClaims ?? null,
      },
    ])
  }

  private assignmentsFor(
    assignments: Map<string, RoleAssignmentRecord[]>,
    subjectId: string,
    scope: Parameters<AuthorizationRepository['listUserRoleAssignments']>[1],
  ) {
    return (assignments.get(subjectId) ?? []).filter(
      (assignment) =>
        matchesScope(assignment.role.resourceId, scope.resourceId) &&
        matchesScope(assignment.role.organizationId, scope.organizationId) &&
        matchesScope(assignment.role.applicationId, scope.applicationId),
    )
  }

  private permissionsFor(roleId: string) {
    return (this.rolePermissions.get(roleId) ?? [])
      .map((permissionId) => this.permissions.get(permissionId))
      .filter((permission): permission is Permission => !!permission)
  }
}

function page<T>(items: T[], pagination: PaginationQuery) {
  const nextOffset = pagination.offset + pagination.limit < items.length ? pagination.offset + pagination.limit : null

  return {
    items: items.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: {
      limit: pagination.limit,
      offset: pagination.offset,
      total: items.length,
      hasMore: nextOffset !== null,
      nextOffset,
    },
  }
}

function defined<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}

function matchesScope(roleValue: string | null, scopeValue: string | undefined) {
  return scopeValue ? roleValue === scopeValue || roleValue === null : roleValue === null
}

function now() {
  return '2026-05-18T12:00:00.000Z'
}
