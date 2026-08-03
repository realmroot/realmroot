import {
  addMember,
  archiveResource,
  assignAgentRole,
  buildTokenClaims,
  cancelInvitation,
  createInvitation,
  createOrganization,
  createResource,
  createRole,
  createRoleAssignment,
  deleteOrganization,
  deleteResource,
  deleteRole,
  getAgentRoleAuthorization,
  getOrganization,
  getResource,
  getResourceContract,
  getRole,
  getRoleAssignment,
  listInvitations,
  listMembers,
  listOrganizations,
  listResources,
  listRoleAssignments,
  listRolePermissions,
  listRoles,
  putRoleAssignmentRevocation,
  removeMember,
  replaceRolePermissions,
  restoreResource,
  updateMember,
  updateOrganization,
  updateResource,
  updateRole,
} from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import type {
  ApiResourceResponse,
  InvitationResponse,
  MemberResponse,
  OrganizationResponse,
  RoleResponse,
} from '@shared/api/authorization'
import { describe, expect, it, vi } from 'vitest'

const timestamp = '2026-07-30T00:00:00.000Z'
const pagination = { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null }
const actor = { controllerUserId: 'user-1', agent: null }
const organization: OrganizationResponse = {
  id: 'org-1',
  slug: 'acme',
  name: 'Acme',
  displayName: 'Acme Inc.',
  logo: null,
  disabled: false,
  disabledReason: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const member: MemberResponse = {
  id: 'member-1',
  organizationId: organization.id,
  userId: 'user-1',
  role: 'member',
  title: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const invitation: InvitationResponse = {
  id: 'invitation-1',
  organizationId: organization.id,
  email: 'member@example.com',
  role: 'member',
  inviterId: 'admin-1',
  status: 'pending',
  expiresAt: timestamp,
  acceptedAt: null,
  revokedAt: null,
  createdAt: timestamp,
}
const resource: ApiResourceResponse = {
  id: 'resource-1',
  identifier: 'projects',
  name: 'Projects',
  resourceUrl: 'https://api.example.com',
  connectorId: null,
  authorizationDetails: [],
  description: null,
  enabled: true,
  ownerOrganizationId: organization.id,
  accessEligibility: { mode: 'realm', organizationIds: [] },
  availableToAgents: true,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const role: RoleResponse = {
  id: 'role-1',
  key: 'projects-reader',
  name: 'Projects reader',
  description: null,
  system: false,
  createdAt: timestamp,
  updatedAt: timestamp,
}

describe('authorization CRUD and assignment policy', () => {
  it('manages organizations, members, and invitations through repository ports', async () => {
    const authorization = repository()
    authorization.createOrganization.mockResolvedValue(organization)
    authorization.listOrganizations.mockResolvedValue({ items: [organization], pagination })
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.addMember.mockResolvedValue(member)
    authorization.listMembers.mockResolvedValue({ items: [member], pagination })
    authorization.findMember.mockResolvedValue(member)
    authorization.createInvitation.mockResolvedValue(invitation)
    authorization.listInvitations.mockResolvedValue({ items: [invitation], pagination })
    authorization.findInvitation.mockResolvedValue(invitation)
    const deps = { authorization } as unknown as Deps

    await expect(createOrganization(deps, { slug: 'acme', name: 'Acme' })).resolves.toBe(organization)
    expect(authorization.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^org_/),
        displayName: null,
        logo: null,
        disabled: false,
        disabledReason: null,
      }),
    )
    await expect(listOrganizations(deps, { limit: 20, offset: 0 })).resolves.toEqual({
      organizations: [organization],
      pagination,
    })
    await expect(getOrganization(deps, organization.id)).resolves.toBe(organization)
    await expect(updateOrganization(deps, organization.id, { name: 'Acme 2' })).resolves.toBe(organization)
    expect(authorization.updateOrganization).toHaveBeenCalledWith(organization.id, { name: 'Acme 2' })
    await expect(addMember(deps, organization.id, { userId: 'user-1', role: 'member' })).resolves.toBe(member)
    expect(authorization.addMember).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({ id: expect.stringMatching(/^mem_/), title: null }),
    )
    await expect(listMembers(deps, organization.id, { limit: 20, offset: 0 })).resolves.toEqual({
      members: [member],
      pagination,
    })
    await expect(updateMember(deps, organization.id, member.id, { title: 'Owner' })).resolves.toBe(member)
    await expect(removeMember(deps, organization.id, member.id)).resolves.toBeUndefined()

    await expect(
      createInvitation(deps, organization.id, { email: invitation.email, role: 'member' }, 'admin-1'),
    ).resolves.toBe(invitation)
    expect(authorization.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^inv_/),
        status: 'pending',
        inviterId: 'admin-1',
        expiresAt: expect.any(String),
      }),
    )
    await createInvitation(
      deps,
      organization.id,
      { email: invitation.email, role: 'member', expiresAt: timestamp },
      null,
    )
    expect(authorization.createInvitation).toHaveBeenLastCalledWith(
      expect.objectContaining({ expiresAt: timestamp, inviterId: null }),
    )
    await expect(listInvitations(deps, organization.id, { limit: 20, offset: 0 })).resolves.toEqual({
      invitations: [invitation],
      pagination,
    })
    await expect(cancelInvitation(deps, organization.id, invitation.id)).resolves.toBeUndefined()
    expect(authorization.cancelInvitation).toHaveBeenCalledWith(invitation.id)
    await expect(deleteOrganization(deps, organization.id)).resolves.toBeUndefined()
    expect(authorization.deleteOrganization).toHaveBeenCalledWith(organization.id)
  })

  it('surfaces missing and cross-organization records', async () => {
    const authorization = repository()
    const deps = { authorization } as unknown as Deps

    await expect(getOrganization(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    authorization.findOrganization.mockResolvedValue(organization)
    await expect(updateMember(deps, organization.id, 'missing', {})).rejects.toMatchObject({ status: 404 })
    authorization.findMember.mockResolvedValue({ ...member, organizationId: 'org-2' })
    await expect(removeMember(deps, organization.id, member.id)).rejects.toMatchObject({ status: 404 })
    authorization.findInvitation.mockResolvedValue(null)
    await expect(cancelInvitation(deps, organization.id, 'missing')).rejects.toMatchObject({ status: 404 })
    authorization.findInvitation.mockResolvedValue({ ...invitation, organizationId: 'org-2' })
    await expect(cancelInvitation(deps, organization.id, invitation.id)).rejects.toMatchObject({ status: 404 })
  })

  it('rejects demoting or removing the last Organization Owner', async () => {
    const authorization = repository()
    const deps = { authorization } as unknown as Deps
    authorization.findMember.mockResolvedValue({ ...member, role: 'owner' })
    authorization.countMembersByRole.mockResolvedValue(1)

    await expect(updateMember(deps, organization.id, member.id, { role: 'admin' })).rejects.toMatchObject({
      status: 400,
      message: 'Transfer Organization ownership before changing or removing the last Owner.',
    })
    await expect(removeMember(deps, organization.id, member.id)).rejects.toMatchObject({ status: 400 })
    expect(authorization.updateMember).not.toHaveBeenCalled()
    expect(authorization.removeMember).not.toHaveBeenCalled()
  })

  it('manages native and external API resources', async () => {
    const authorization = repository()
    authorization.createResource.mockResolvedValue(resource)
    authorization.listResources.mockResolvedValue({ items: [resource], pagination })
    authorization.findResource.mockResolvedValue(resource)
    const canonicalResourceUrl = new URL(resource.resourceUrl).toString()
    const connector = {
      id: 'connector-1',
      providerType: 'generic_oauth',
      enabled: true,
      clientId: 'client-1',
      clientSecret: 'secret',
      issuer: resource.resourceUrl,
      authorizationEndpoint: `${resource.resourceUrl}/authorize`,
      tokenEndpoint: `${resource.resourceUrl}/token`,
      userInfoEndpoint: `${resource.resourceUrl}/userinfo`,
      jwksEndpoint: `${resource.resourceUrl}/jwks`,
      revocationEndpoint: `${resource.resourceUrl}/revoke`,
      providerMetadata: {
        grant_types_supported: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
          'urn:ietf:params:oauth:grant-type:token-exchange',
        ],
        dpop_signing_alg_values_supported: ['ES256'],
        authorization_details_types_supported: ['payment_initiation'],
        authorization_details_catalog_endpoint: `${resource.resourceUrl}/authorization-details`,
        authorization_details_catalog_scope: 'authorization-details:read',
        pushed_authorization_request_endpoint: `${resource.resourceUrl}/par`,
      },
    }
    const connectors = { findById: vi.fn().mockResolvedValue(connector) }
    const openApiFetch = resourceOpenApiFetch(resource.resourceUrl)
    const deps = {
      authorization,
      connectors,
      externalHttp: {
        fetch: vi.fn((request: Request) =>
          request.url.endsWith('/.well-known/oauth-protected-resource')
            ? Promise.resolve(
                Response.json({
                  resource: canonicalResourceUrl,
                  authorization_servers: [resource.resourceUrl],
                }),
              )
            : openApiFetch(request),
        ),
      },
    } as unknown as Deps

    await createResource(deps, {
      identifier: 'native',
      name: 'Native',
      resourceUrl: resource.resourceUrl,
    })
    expect(authorization.createResource).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectorId: null,
        description: null,
        enabled: true,
      }),
    )
    await createResource(deps, {
      identifier: 'external-without-rar',
      name: 'External without RAR',
      resourceUrl: resource.resourceUrl,
      connectorId: 'connector-1',
    })
    expect(authorization.createResource).toHaveBeenLastCalledWith(
      expect.objectContaining({ authorizationDetails: [], connectorId: 'connector-1' }),
    )
    await expect(
      createResource(deps, {
        identifier: 'invalid-native-rar',
        name: 'Invalid native RAR',
        resourceUrl: resource.resourceUrl,
        authorizationDetails: [{ type: 'project_access', project_id: 'project-1' }],
      }),
    ).rejects.toThrow('Authorization details require an external API resource connector.')
    await createResource(deps, {
      identifier: 'external',
      name: 'External',
      resourceUrl: resource.resourceUrl,
      connectorId: 'connector-1',
      authorizationDetails: [
        { type: 'payment_initiation', actions: ['initiate'], locations: ['https://merchant.example.com'] },
      ],
      enabled: true,
    })
    expect(authorization.createResource).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectorId: 'connector-1',
        authorizationDetails: [
          { type: 'payment_initiation', actions: ['initiate'], locations: ['https://merchant.example.com'] },
        ],
        enabled: true,
      }),
    )
    await expect(listResources(deps, { limit: 20, offset: 0 })).resolves.toEqual({
      resources: [resource],
      pagination,
    })
    await expect(getResource(deps, resource.id)).resolves.toBe(resource)
    await expect(updateResource(deps, resource.id, { name: 'Projects 2' })).resolves.toBe(resource)
    await expect(
      updateResource(deps, resource.id, {
        authorizationDetails: [{ type: 'project_access', project_id: 'project-1' }],
      }),
    ).rejects.toThrow('Authorization details require an external API resource connector.')
    authorization.findResource.mockResolvedValue({ ...resource, connectorId: 'connector-1' })
    await expect(
      updateResource(deps, resource.id, {
        authorizationDetails: [
          { type: 'payment_initiation', actions: ['initiate'], locations: ['https://merchant.example.com'] },
        ],
      }),
    ).resolves.toMatchObject({ id: resource.id })
    authorization.findResource.mockResolvedValue(resource)
    authorization.updateResource.mockClear()
    await expect(updateResource(deps, resource.id, { connectorId: 'connector-1' })).rejects.toThrow(
      'authorization mode cannot change',
    )
    expect(authorization.updateResource).not.toHaveBeenCalled()
    authorization.findResource.mockResolvedValue({ ...resource, connectorId: 'connector-1' })
    await expect(updateResource(deps, resource.id, { connectorId: null })).rejects.toThrow(
      'authorization mode cannot change',
    )
    expect(authorization.updateResource).not.toHaveBeenCalled()
    authorization.findResource.mockResolvedValue(resource)
    authorization.archiveResource.mockResolvedValue(undefined)
    await expect(archiveResource(deps, resource.id, actor)).resolves.toBe(resource)
    expect(authorization.archiveResource).toHaveBeenCalledWith(
      resource.id,
      expect.any(Date),
      expect.objectContaining({
        action: 'api_resource.archived',
        controllerUserId: 'user-1',
        resourceId: resource.id,
      }),
    )

    authorization.findResource.mockResolvedValueOnce({ ...resource, archivedAt: timestamp }).mockResolvedValue(resource)
    authorization.restoreResource.mockResolvedValue(undefined)
    await expect(restoreResource(deps, resource.id, actor)).resolves.toBe(resource)
    expect(authorization.restoreResource).toHaveBeenCalledWith(
      resource.id,
      expect.any(Date),
      expect.objectContaining({
        action: 'api_resource.restored',
        controllerUserId: 'user-1',
        resourceId: resource.id,
      }),
    )

    authorization.archiveResource.mockClear()
    authorization.findResource.mockResolvedValue(resource)
    await archiveResource(deps, resource.id, {
      controllerUserId: null,
      agent: {
        issuer: 'https://auth.example.com',
        subject: 'agent-subject',
        identityId: 'identity-1',
        hostId: 'host-1',
      },
    })
    expect(authorization.archiveResource).toHaveBeenCalledWith(
      resource.id,
      expect.any(Date),
      expect.objectContaining({
        controllerUserId: null,
        subjectIssuer: 'https://auth.example.com',
        subject: 'agent-subject',
        agentIdentityId: 'identity-1',
        hostId: 'host-1',
      }),
    )

    authorization.archiveResource.mockClear()
    authorization.findResource.mockResolvedValue({ ...resource, archivedAt: timestamp })
    await archiveResource(deps, resource.id, actor)
    expect(authorization.archiveResource).not.toHaveBeenCalled()

    authorization.restoreResource.mockClear()
    authorization.findResource.mockResolvedValue(resource)
    await restoreResource(deps, resource.id, actor)
    expect(authorization.restoreResource).not.toHaveBeenCalled()

    authorization.findResource.mockResolvedValue({ ...resource, archivedAt: timestamp })
    await expect(updateResource(deps, resource.id, { enabled: true })).rejects.toMatchObject({
      status: 400,
      message: 'Archived API resources must be restored before updating.',
    })

    authorization.findResource.mockResolvedValue(resource)
    authorization.updateResource.mockResolvedValueOnce(false)
    await expect(updateResource(deps, resource.id, { enabled: true })).rejects.toMatchObject({
      status: 400,
      message: 'Archived API resources must be restored before updating.',
    })

    authorization.findResource.mockResolvedValue(resource)
    authorization.deleteResource.mockResolvedValue(null)
    await expect(deleteResource(deps, resource.id)).resolves.toBeUndefined()

    authorization.deleteResource.mockResolvedValue({
      federatedCredentials: 0,
      accountConnections: 1,
      connectionIntents: 1,
      agentAccessRequests: 1,
      agentAccessGrants: 1,
    })
    await expect(deleteResource(deps, resource.id)).rejects.toMatchObject({
      status: 409,
      code: 'resource_in_use',
      details: {
        federatedCredentials: 0,
        accountConnections: 1,
        connectionIntents: 1,
        agentAccessRequests: 1,
        agentAccessGrants: 1,
      },
    })

    authorization.findResource.mockResolvedValue({
      ...resource,
      connectorId: 'connector-1',
    })
    connectors.findById.mockResolvedValue({ ...connector, enabled: false })
    await expect(updateResource(deps, resource.id, { enabled: true })).rejects.toMatchObject({ status: 400 })
    connectors.findById.mockResolvedValue(connector)
    await expect(updateResource(deps, resource.id, { enabled: true })).resolves.toEqual({
      ...resource,
      connectorId: 'connector-1',
    })
    authorization.findResource.mockResolvedValue(null)
    await expect(getResource(deps, 'missing')).rejects.toMatchObject({ status: 404 })
  })

  it('reads resource contracts and rejects disabled owner Organizations', async () => {
    const authorization = repository()
    authorization.findResource.mockResolvedValue(resource)
    authorization.findOrganization.mockResolvedValue({ ...organization, disabled: true })
    const deps = {
      authorization,
      externalHttp: { fetch: vi.fn(resourceOpenApiFetch(resource.resourceUrl)) },
    } as unknown as Deps

    await expect(getResourceContract(deps, resource.id)).resolves.toMatchObject({
      resourceId: resource.id,
      sourceUrl: 'https://api.example.com/openapi.json',
      scopes: [],
      operations: [],
    })
    await expect(
      createResource(deps, {
        identifier: 'disabled-owner',
        name: 'Disabled owner API',
        resourceUrl: resource.resourceUrl,
        ownerOrganizationId: organization.id,
        enabled: false,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('validates the resource contract before enabling it [spec: agent-identity/api-resource-contract-validation]', async () => {
    const authorization = repository()
    authorization.createResource.mockResolvedValue(resource)
    authorization.findResource.mockResolvedValue(resource)
    const externalHttp = { fetch: vi.fn().mockResolvedValue(new Response('<html></html>')) }
    const deps = {
      authorization,
      externalResources: { findAuthorization: vi.fn() },
      externalHttp,
    } as unknown as Deps
    const input = {
      identifier: 'projects',
      name: 'Projects',
      resourceUrl: resource.resourceUrl,
    }

    await expect(createResource(deps, input)).rejects.toThrow('Business resource must advertise its OpenAPI document')
    expect(authorization.createResource).not.toHaveBeenCalled()

    await expect(createResource(deps, { ...input, enabled: false })).resolves.toBe(resource)
    expect(authorization.createResource).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    expect(externalHttp.fetch).toHaveBeenCalledTimes(1)

    await expect(updateResource(deps, resource.id, { enabled: true })).rejects.toThrow(
      'Business resource must advertise its OpenAPI document',
    )
    await expect(updateResource(deps, resource.id, { resourceUrl: 'https://wrong.example.com/api' })).rejects.toThrow(
      'Business resource must advertise its OpenAPI document',
    )
    expect(authorization.updateResource).not.toHaveBeenCalled()
  })

  it('manages Realm roles and their resource-qualified permissions', async () => {
    const authorization = repository()
    authorization.createRole.mockResolvedValue(role)
    authorization.listRoles.mockResolvedValue({ items: [role], pagination })
    authorization.findRole.mockResolvedValue(role)
    authorization.listRolePermissions.mockResolvedValue([{ resourceId: resource.id, scope: 'projects:read' }])
    const deps = { authorization } as unknown as Deps

    await createRole(deps, { key: role.key, name: role.name })
    expect(authorization.createRole).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^role_/),
        description: null,
        system: false,
      }),
    )
    await expect(listRoles(deps, { limit: 20, offset: 0 })).resolves.toEqual({ roles: [role], pagination })
    await expect(getRole(deps, role.id)).resolves.toBe(role)
    await expect(updateRole(deps, role.id, { name: 'Reader 2' })).resolves.toBe(role)
    await expect(listRolePermissions(deps, role.id)).resolves.toEqual({
      permissions: [{ resourceId: resource.id, scope: 'projects:read' }],
    })
    await expect(deleteRole(deps, role.id)).resolves.toBeUndefined()
    authorization.findRole.mockResolvedValue({ ...role, system: true })
    await expect(deleteRole(deps, role.id)).rejects.toMatchObject({ status: 400 })
    authorization.findRole.mockResolvedValue(null)
    await expect(getRole(deps, 'missing')).rejects.toMatchObject({ status: 404 })
  })

  it('[spec: admin-console/admin-create-role] validates multi-resource role permissions', async () => {
    const authorization = repository()
    authorization.findRole.mockResolvedValue(role)
    authorization.findResource.mockResolvedValue(resource)
    const secondResource = { ...resource, id: 'resource-2', resourceUrl: 'https://other.example.com' }
    authorization.findResource.mockImplementation(async (id) =>
      id === resource.id ? resource : id === secondResource.id ? secondResource : null,
    )
    const externalHttp = {
      fetch: vi.fn(async (request: Request) => {
        const source = request.url.startsWith(secondResource.resourceUrl) ? secondResource : resource
        if (request.url === new URL(source.resourceUrl).toString()) {
          return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
        }
        return Response.json({
          openapi: '3.1.0',
          components: {
            securitySchemes: {
              oauth: {
                type: 'oauth2',
                flows: { clientCredentials: { tokenUrl: '/token', scopes: { [`${source.identifier}:read`]: 'Read' } } },
              },
            },
          },
          paths: {
            '/items': { get: { security: [{ oauth: [`${source.identifier}:read`] }] } },
          },
        })
      }),
    }
    const deps = { authorization, externalHttp } as unknown as Deps
    const permissions = [
      { resourceId: resource.id, scope: 'projects:read' },
      { resourceId: secondResource.id, scope: 'projects:read' },
    ]

    await replaceRolePermissions(deps, role.id, permissions)
    expect(authorization.replaceRolePermissions).toHaveBeenCalledWith(role.id, permissions)
    await expect(
      replaceRolePermissions(deps, role.id, [{ resourceId: resource.id, scope: 'projects:write' }]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('validates Agent role assignments and deduplicates eligibility', async () => {
    const authorization = repository()
    const agentIdentities = { findIdentity: vi.fn() }
    const deps = { authorization, agentIdentities } as unknown as Deps

    authorization.findRole.mockResolvedValue(role)
    agentIdentities.findIdentity.mockResolvedValue(null)
    await expect(assignAgentRole(deps, { roleId: role.id, subjectId: 'agent-1' }, null)).rejects.toMatchObject({
      status: 404,
    })
    agentIdentities.findIdentity.mockResolvedValue({ identity: { status: 'retired' }, bindings: [] })
    await expect(assignAgentRole(deps, { roleId: role.id, subjectId: 'agent-1' }, null)).rejects.toMatchObject({
      status: 404,
    })
    agentIdentities.findIdentity.mockResolvedValue({
      identity: { status: 'active', ownerOrganizationId: null, ownerUserId: 'user-1' },
      bindings: [],
    })
    await assignAgentRole(deps, { roleId: role.id, subjectId: 'agent-1' }, null)
    expect(authorization.createRoleAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'agent', subjectId: 'agent-1', organizationId: null }),
    )

    authorization.listAgentRoleAssignments.mockResolvedValue([
      { role, scopes: ['projects:write', 'projects:read'] },
      { role, scopes: ['projects:read'] },
    ])
    authorization.findResource.mockResolvedValue(resource)
    await expect(getAgentRoleAuthorization(deps, 'agent-1', resource.id)).resolves.toEqual({
      roles: [role.key],
      scopes: ['projects:read', 'projects:write'],
    })

    authorization.findResource.mockResolvedValue({ ...resource, availableToAgents: false })
    await expect(getAgentRoleAuthorization(deps, 'agent-1', resource.id)).resolves.toEqual({ roles: [], scopes: [] })
  })

  it('manages canonical Role assignment inventory, subjects, and revocation resources', async () => {
    const authorization = repository()
    const assignment = {
      id: 'assignment-1',
      roleId: role.id,
      subjectType: 'user' as const,
      subjectId: 'user-1',
      organizationId: null,
      assignedByUserId: 'admin-1',
      expiresAt: null,
      revokedAt: null,
      createdAt: timestamp,
    }
    authorization.findRole.mockResolvedValue(role)
    authorization.listRoleAssignments.mockResolvedValue({ items: [assignment], pagination })
    authorization.findRoleAssignment.mockResolvedValue(assignment)
    authorization.createRoleAssignment.mockImplementation(async (input) => ({ ...assignment, ...input }))
    authorization.revokeRoleAssignment.mockResolvedValue(true)
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.findMemberByOrganizationUser.mockResolvedValue(member)
    const users = { getUser: vi.fn().mockResolvedValue({ id: 'user-1' }) }
    const applications = { findById: vi.fn() }
    const agentIdentities = { findIdentity: vi.fn() }
    const deps = { authorization, users, applications, agentIdentities } as unknown as Deps

    await expect(
      listRoleAssignments(
        deps,
        { limit: 20, offset: 0, subjectType: 'user' },
        { organizationIds: ['org-1'], includeRealmAssignments: true },
      ),
    ).resolves.toEqual({ assignments: [assignment], pagination })
    expect(authorization.listRoleAssignments).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      subjectType: 'user',
      organizationIds: ['org-1'],
      includeRealmAssignments: true,
    })
    await expect(getRoleAssignment(deps, assignment.id)).resolves.toBe(assignment)
    authorization.findRoleAssignment.mockResolvedValue(null)
    await expect(getRoleAssignment(deps, 'missing')).rejects.toMatchObject({ status: 404 })

    authorization.findRoleAssignment.mockResolvedValue(assignment)
    await expect(putRoleAssignmentRevocation(deps, assignment.id)).resolves.toMatchObject({
      roleAssignmentId: assignment.id,
      revokedAt: expect.any(String),
    })
    authorization.findRoleAssignment.mockResolvedValue({ ...assignment, revokedAt: timestamp })
    await expect(putRoleAssignmentRevocation(deps, assignment.id)).resolves.toEqual({
      roleAssignmentId: assignment.id,
      revokedAt: timestamp,
    })
    authorization.findRoleAssignment.mockResolvedValue(assignment)
    authorization.revokeRoleAssignment.mockResolvedValue(false)
    await expect(putRoleAssignmentRevocation(deps, assignment.id)).rejects.toMatchObject({ status: 404 })

    await createRoleAssignment(deps, { roleId: role.id, subjectType: 'user', subjectId: 'user-1' }, 'admin-1')
    await createRoleAssignment(
      deps,
      { roleId: role.id, subjectType: 'user', subjectId: 'user-1', organizationId: organization.id },
      'admin-1',
    )
    authorization.findMemberByOrganizationUser.mockResolvedValue(null)
    await expect(
      createRoleAssignment(
        deps,
        { roleId: role.id, subjectType: 'user', subjectId: 'user-1', organizationId: organization.id },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400 })

    applications.findById.mockResolvedValue(null)
    await expect(
      createRoleAssignment(deps, { roleId: role.id, subjectType: 'workload', subjectId: 'app-1' }, 'admin-1'),
    ).rejects.toMatchObject({ status: 404 })
    applications.findById.mockResolvedValue({ id: 'app-1', ownerOrganizationId: 'org-other' })
    await expect(
      createRoleAssignment(
        deps,
        { roleId: role.id, subjectType: 'workload', subjectId: 'app-1', organizationId: organization.id },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400 })
    applications.findById.mockResolvedValue({ id: 'app-1', ownerOrganizationId: organization.id })
    await createRoleAssignment(
      deps,
      { roleId: role.id, subjectType: 'workload', subjectId: 'app-1', organizationId: organization.id },
      'admin-1',
    )

    agentIdentities.findIdentity.mockResolvedValue({
      identity: { status: 'active', ownerOrganizationId: 'org-other', ownerUserId: null },
      bindings: [],
    })
    await expect(
      createRoleAssignment(
        deps,
        { roleId: role.id, subjectType: 'agent', subjectId: 'agent-1', organizationId: organization.id },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('builds claims from global, application, and organization-member assignments', async () => {
    const authorization = repository()
    const assignment = { role, scopes: ['projects:read'] }
    authorization.findResourceByResourceUrl.mockResolvedValue(resource)
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.findMemberByOrganizationUser.mockResolvedValue({ id: 'member-1' })
    authorization.listUserRoleAssignments.mockResolvedValue([assignment])
    authorization.listApplicationRoleAssignments.mockResolvedValue([assignment])
    const deps = { authorization } as unknown as Deps

    await expect(
      buildTokenClaims(deps, {
        userId: 'user-1',
        applicationId: 'app-1',
        organizationId: organization.id,
        resource: resource.resourceUrl,
        scopes: ['projects:read'],
        claimSelection: {
          authorization: true,
          groups: true,
          roles: true,
          scopes: true,
          organizationId: true,
          organizationName: true,
        },
      }),
    ).resolves.toEqual({
      authorization: {
        audience: resource.resourceUrl,
        resource: resource.identifier,
        organization_id: organization.id,
        organization_name: organization.displayName,
        groups: [organization.id],
        roles: [role.key],
        scopes: ['projects:read'],
      },
      groups: [organization.id],
      roles: [role.key],
      scope: 'projects:read',
      organization_id: organization.id,
      organization_name: organization.displayName,
    })

    authorization.findResourceByResourceUrl.mockResolvedValue(null)
    await expect(buildTokenClaims(deps, { resource: 'missing', scopes: ['projects:read'] })).resolves.toMatchObject({
      roles: [],
      groups: [],
    })
    authorization.findResourceByResourceUrl.mockResolvedValue(resource)
    authorization.findMemberByOrganizationUser.mockResolvedValue(null)
    await expect(
      buildTokenClaims(deps, { userId: 'user-1', organizationId: organization.id, scopes: [] }),
    ).rejects.toMatchObject({ status: 403 })
    await buildTokenClaims(deps, { applicationId: 'app-1', scopes: [] })
    await buildTokenClaims(deps, { scopes: [] })
  })
})

function repository() {
  return {
    createOrganization: vi.fn(),
    listOrganizations: vi.fn(),
    findOrganization: vi.fn().mockResolvedValue(null),
    updateOrganization: vi.fn(),
    deleteOrganization: vi.fn(),
    addMember: vi.fn(),
    listMembers: vi.fn(),
    findMember: vi.fn().mockResolvedValue(null),
    findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
    countMembersByRole: vi.fn().mockResolvedValue(1),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    createInvitation: vi.fn(),
    listInvitations: vi.fn(),
    findInvitation: vi.fn().mockResolvedValue(null),
    cancelInvitation: vi.fn(),
    createResource: vi.fn(),
    listResources: vi.fn(),
    listEnabledResources: vi.fn(),
    findResource: vi.fn().mockResolvedValue(null),
    findResourceByResourceUrl: vi.fn().mockResolvedValue(null),
    updateResource: vi.fn().mockResolvedValue(true),
    archiveResource: vi.fn(),
    restoreResource: vi.fn(),
    deleteResource: vi.fn(),
    createRole: vi.fn(),
    listRoles: vi.fn(),
    findRole: vi.fn().mockResolvedValue(null),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    listRolePermissions: vi.fn(),
    replaceRolePermissions: vi.fn(),
    listRoleAssignments: vi.fn(),
    findRoleAssignment: vi.fn().mockResolvedValue(null),
    createRoleAssignment: vi.fn(),
    revokeRoleAssignment: vi.fn(),
    listUserRoleAssignments: vi.fn().mockResolvedValue([]),
    listApplicationRoleAssignments: vi.fn().mockResolvedValue([]),
    listAgentRoleAssignments: vi.fn().mockResolvedValue([]),
  }
}

function resourceOpenApiFetch(resourceUrl: string) {
  return async (request: Request) => {
    if (request.url === new URL(resourceUrl).toString()) {
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    if (request.url === new URL('/openapi.json', resourceUrl).toString()) {
      return Response.json({ openapi: '3.1.0', paths: {} })
    }
    return new Response(null, { status: 404 })
  }
}
