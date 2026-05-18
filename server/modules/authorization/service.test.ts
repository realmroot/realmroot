import { describe, expect, it } from 'vitest'
import type { PaginationQuery } from '../../../shared/api/authorization'
import { type AuthorizationRepository, AuthorizationService, type RoleAssignmentRecord } from './service'

describe('AuthorizationService', () => {
  it('manages organizations, members, resources, scopes, permissions, roles, and assignments', async () => {
    const repository = new InMemoryAuthorizationRepository()
    const service = new AuthorizationService(repository)

    const organization = await service.createOrganization({
      slug: 'acme-workspace',
      name: 'Acme Workspace',
    })
    const member = await service.addMember(organization.id, {
      userId: 'user-1',
      role: 'member',
      title: 'Developer',
    })
    const resource = await service.createResource({
      identifier: 'contacts-api',
      name: 'Contacts API',
      audience: 'https://api.example.com/contacts',
      tokenClaimsNamespace: 'https://claims.example.com/contacts',
    })
    const scope = await service.createScope(resource.id, {
      value: 'contacts:read',
      includeInAccessToken: true,
    })
    const permission = await service.createPermission(resource.id, {
      scopeId: scope.id,
      key: 'contacts.read',
      tokenClaimValue: 'read',
    })
    const role = await service.createRole({
      key: 'contacts-reader',
      name: 'Contacts Reader',
      resourceId: resource.id,
      organizationId: organization.id,
      tokenClaimName: 'contacts_role',
    })

    await service.replaceRolePermissions(role.id, [permission.id])
    await service.assignMemberRole({ roleId: role.id, subjectId: member.id, tokenClaims: { tier: 'gold' } }, 'admin-1')

    await expect(service.listOrganizations({ limit: 20, offset: 0 })).resolves.toMatchObject({
      organizations: [{ id: organization.id, slug: 'acme-workspace' }],
      pagination: { total: 1, hasMore: false },
    })
    await expect(service.listScopes(resource.id, { limit: 20, offset: 0 })).resolves.toMatchObject({
      scopes: [{ value: 'contacts:read' }],
    })
    await expect(service.listPermissions(resource.id, { limit: 20, offset: 0 })).resolves.toMatchObject({
      permissions: [{ key: 'contacts.read' }],
    })

    const claims = await service.buildTokenClaims({
      userId: 'user-1',
      organizationId: organization.id,
      resource: 'https://api.example.com/contacts',
      scopes: ['openid', 'contacts:read'],
    })

    expect(claims).toMatchObject({
      authorization: {
        scopes: ['openid', 'contacts:read'],
        roles: ['contacts-reader'],
        permissions: ['contacts.read'],
        organization_id: organization.id,
        resource: 'contacts-api',
        audience: 'https://api.example.com/contacts',
      },
      roles: ['contacts-reader'],
      permissions: ['contacts.read'],
      tier: 'gold',
      'https://claims.example.com/contacts': {
        contacts_role: 'contacts-reader',
      },
    })
  })

  it('rejects assignments to missing roles and protects system roles from deletion', async () => {
    const service = new AuthorizationService(new InMemoryAuthorizationRepository())
    const systemRole = await service.createRole({
      key: 'system-admin',
      name: 'System Admin',
      system: true,
    })

    await expect(service.assignUserRole({ roleId: 'missing', subjectId: 'user-1' }, 'admin-1')).rejects.toMatchObject({
      status: 404,
      message: 'Role was not found.',
    })
    await expect(service.deleteRole(systemRole.id)).rejects.toMatchObject({
      status: 400,
      message: 'System roles cannot be deleted.',
    })
  })

  it('keeps role scope immutable and rejects token claim overrides', async () => {
    const service = new AuthorizationService(new InMemoryAuthorizationRepository())
    const role = await service.createRole({
      key: 'auditor',
      name: 'Auditor',
    })

    await expect(service.updateRole(role.id, { organizationId: 'org-1' })).rejects.toMatchObject({
      status: 400,
      message: 'Role resource and subject scope cannot be changed after creation.',
    })
    await expect(
      service.assignUserRole(
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
      service.assignUserRole(
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
      service.createRole({
        key: 'claim-overrider',
        name: 'Claim Overrider',
        tokenClaimName: 'roles',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Role token claim name is reserved: roles',
    })
    await expect(
      service.updateRole(role.id, { tokenClaimName: 'https://claims.example.com/contacts' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Role token claim name is reserved: https://claims.example.com/contacts',
    })
  })

  it('rejects cross-resource permission wiring and incompatible scoped assignments', async () => {
    const repository = new InMemoryAuthorizationRepository()
    const service = new AuthorizationService(repository)
    const organization = await service.createOrganization({ slug: 'acme-workspace', name: 'Acme Workspace' })
    const otherOrganization = await service.createOrganization({ slug: 'other-workspace', name: 'Other Workspace' })
    const member = await service.addMember(organization.id, { userId: 'user-1', role: 'member' })
    const contactsResource = await service.createResource({
      identifier: 'contacts-api',
      name: 'Contacts API',
      audience: 'https://api.example.com/contacts',
    })
    const billingResource = await service.createResource({
      identifier: 'billing-api',
      name: 'Billing API',
      audience: 'https://api.example.com/billing',
    })
    const contactsScope = await service.createScope(contactsResource.id, { value: 'contacts:read' })
    const billingPermission = await service.createPermission(billingResource.id, { key: 'billing.read' })
    const contactsRole = await service.createRole({
      key: 'contacts-reader',
      name: 'Contacts Reader',
      resourceId: contactsResource.id,
    })
    const otherOrgRole = await service.createRole({
      key: 'other-org-admin',
      name: 'Other Org Admin',
      organizationId: otherOrganization.id,
    })
    const appRole = await service.createRole({
      key: 'contacts-client',
      name: 'Contacts Client',
      applicationId: 'app-1',
    })

    await expect(
      service.createPermission(billingResource.id, {
        key: 'billing.contacts-scope',
        scopeId: contactsScope.id,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'API scope must belong to the same API resource as the permission.',
    })
    await expect(service.replaceRolePermissions(contactsRole.id, [billingPermission.id])).rejects.toMatchObject({
      status: 400,
      message: 'Role permissions must belong to the same API resource as the role.',
    })
    await expect(
      service.assignUserRole({ roleId: otherOrgRole.id, subjectId: 'user-1' }, 'admin-1'),
    ).rejects.toMatchObject({
      status: 400,
      message: 'User role assignments must use global roles.',
    })
    await expect(
      service.assignMemberRole({ roleId: otherOrgRole.id, subjectId: member.id }, 'admin-1'),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Member role assignments must use global roles or roles scoped to the same organization.',
    })
    await expect(
      service.assignApplicationRole({ roleId: appRole.id, subjectId: 'app-2' }, 'admin-1'),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Application role assignments must use global roles or roles scoped to the same application.',
    })
  })

  it('rejects nested mutation URLs when child resources belong to another parent', async () => {
    const service = new AuthorizationService(new InMemoryAuthorizationRepository())
    const organization = await service.createOrganization({ slug: 'acme-workspace', name: 'Acme Workspace' })
    const otherOrganization = await service.createOrganization({ slug: 'other-workspace', name: 'Other Workspace' })
    const member = await service.addMember(organization.id, { userId: 'user-1', role: 'member' })
    const invitation = await service.createInvitation(
      organization.id,
      { email: 'user@example.com', role: 'member' },
      'admin-1',
    )
    const resource = await service.createResource({
      identifier: 'contacts-api',
      name: 'Contacts API',
      audience: 'https://api.example.com/contacts',
    })
    const otherResource = await service.createResource({
      identifier: 'billing-api',
      name: 'Billing API',
      audience: 'https://api.example.com/billing',
    })
    const scope = await service.createScope(resource.id, { value: 'contacts:read' })
    const permission = await service.createPermission(resource.id, { key: 'contacts.read' })

    await expect(service.updateMember(otherOrganization.id, member.id, { title: 'Owner' })).rejects.toMatchObject({
      status: 404,
      message: 'Organization member was not found.',
    })
    await expect(service.removeMember(otherOrganization.id, member.id)).rejects.toMatchObject({
      status: 404,
      message: 'Organization member was not found.',
    })
    await expect(service.cancelInvitation(otherOrganization.id, invitation.id)).rejects.toMatchObject({
      status: 404,
      message: 'Organization invitation was not found.',
    })
    await expect(service.updateScope(otherResource.id, scope.id, { description: 'bad parent' })).rejects.toMatchObject({
      status: 404,
      message: 'API scope was not found.',
    })
    await expect(service.deleteScope(otherResource.id, scope.id)).rejects.toMatchObject({
      status: 404,
      message: 'API scope was not found.',
    })
    await expect(
      service.updatePermission(otherResource.id, permission.id, { description: 'bad parent' }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'API permission was not found.',
    })
    await expect(service.deletePermission(otherResource.id, permission.id)).rejects.toMatchObject({
      status: 404,
      message: 'API permission was not found.',
    })
  })

  it('combines application and member assignments into resource token claims while filtering unrelated roles', async () => {
    const repository = new InMemoryAuthorizationRepository()
    const service = new AuthorizationService(repository)

    const organization = await service.createOrganization({
      slug: 'acme-workspace',
      name: 'Acme Workspace',
    })
    const member = await service.addMember(organization.id, {
      userId: 'user-1',
      role: 'member',
    })
    const contactsResource = await service.createResource({
      identifier: 'contacts-api',
      name: 'Contacts API',
      audience: 'https://api.example.com/contacts',
      tokenClaimsNamespace: 'https://claims.example.com/contacts',
    })
    const billingResource = await service.createResource({
      identifier: 'billing-api',
      name: 'Billing API',
      audience: 'https://api.example.com/billing',
    })
    const contactsPermission = await service.createPermission(contactsResource.id, {
      key: 'contacts.read',
    })
    const memberPermission = await service.createPermission(contactsResource.id, {
      key: 'contacts.manage',
    })
    const billingPermission = await service.createPermission(billingResource.id, {
      key: 'billing.read',
    })
    const globalRole = await service.createRole({
      key: 'workspace-auditor',
      name: 'Workspace Auditor',
      tokenClaimName: 'workspace_role',
    })
    const applicationRole = await service.createRole({
      key: 'contacts-client',
      name: 'Contacts Client',
      resourceId: contactsResource.id,
      applicationId: 'app-1',
      tokenClaimName: 'contacts_role',
      tokenClaimValue: 'client',
    })
    const memberRole = await service.createRole({
      key: 'contacts-member-admin',
      name: 'Contacts Member Admin',
      resourceId: contactsResource.id,
      organizationId: organization.id,
      tokenClaimName: 'member_role',
    })
    const unrelatedRole = await service.createRole({
      key: 'billing-reader',
      name: 'Billing Reader',
      resourceId: billingResource.id,
      tokenClaimName: 'billing_role',
    })

    await service.replaceRolePermissions(applicationRole.id, [contactsPermission.id])
    await service.replaceRolePermissions(memberRole.id, [memberPermission.id])
    await service.replaceRolePermissions(unrelatedRole.id, [billingPermission.id])
    await service.assignUserRole({ roleId: globalRole.id, subjectId: 'user-1' }, 'admin-1')
    await service.assignApplicationRole(
      { roleId: applicationRole.id, subjectId: 'app-1', tokenClaims: { client_tier: 'internal' } },
      'admin-1',
    )
    await service.assignMemberRole({ roleId: memberRole.id, subjectId: member.id }, 'admin-1')
    await service.assignUserRole({ roleId: unrelatedRole.id, subjectId: 'user-1' }, 'admin-1')

    const claims = await service.buildTokenClaims({
      userId: 'user-1',
      applicationId: 'app-1',
      organizationId: organization.id,
      resource: 'https://api.example.com/contacts',
      scopes: ['openid', 'contacts:read'],
    })

    expect(claims).toMatchObject({
      authorization: {
        scopes: ['openid', 'contacts:read'],
        roles: ['workspace-auditor', 'contacts-client', 'contacts-member-admin'],
        permissions: ['contacts.read', 'contacts.manage'],
        organization_id: organization.id,
        resource: 'contacts-api',
        audience: 'https://api.example.com/contacts',
      },
      roles: ['workspace-auditor', 'contacts-client', 'contacts-member-admin'],
      permissions: ['contacts.read', 'contacts.manage'],
      client_tier: 'internal',
      'https://claims.example.com/contacts': {
        workspace_role: 'workspace-auditor',
        contacts_role: 'client',
        member_role: 'contacts-member-admin',
      },
    })
    expect(claims.roles).not.toContain('billing-reader')
    expect(claims.permissions).not.toContain('billing.read')

    const planRole = await service.createRole({
      key: 'plan-role',
      name: 'Plan Role',
      tokenClaimName: 'plan',
      tokenClaimValue: 'computed',
    })
    await service.assignUserRole(
      { roleId: planRole.id, subjectId: 'user-1', tokenClaims: { plan: 'custom' } },
      'admin-1',
    )
    await expect(
      service.buildTokenClaims({
        userId: 'user-1',
        scopes: ['openid'],
      }),
    ).resolves.toMatchObject({
      plan: 'computed',
    })

    const unknownResourceClaims = await service.buildTokenClaims({
      userId: 'user-1',
      applicationId: 'app-1',
      organizationId: organization.id,
      resource: 'https://api.example.com/missing',
      scopes: ['openid'],
    })

    expect(unknownResourceClaims).toMatchObject({
      authorization: {
        scopes: ['openid'],
        roles: [],
        permissions: [],
        organization_id: organization.id,
      },
      roles: [],
      permissions: [],
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
