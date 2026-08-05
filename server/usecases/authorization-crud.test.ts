import {
  addMember,
  archiveResource,
  cancelInvitation,
  createInvitation,
  createOrganization,
  createResource,
  createRole,
  deleteOrganization,
  deleteResource,
  deleteRole,
  ensureRealmrootResourceServer,
  getAgentRoleAuthorization,
  getOrganization,
  getResource,
  getResourceContract,
  getRole,
  listInvitations,
  listMembers,
  listOrganizations,
  listResources,
  organizationUserHasScope,
  removeMember,
  replaceMemberRoles,
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
  roles: ['member'],
  title: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const invitation: InvitationResponse = {
  id: 'invitation-1',
  organizationId: organization.id,
  email: 'member@example.com',
  roles: ['member'],
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
describe('authorization CRUD and assignment policy', () => {
  it('fails closed when an Agent tenant is ineligible for a Resource Server', async () => {
    const authorization = repository()
    authorization.findResource.mockResolvedValue({
      ...resource,
      accessEligibility: { mode: 'organizations', organizationIds: ['org-2'] },
    })
    const deps = { authorization } as unknown as Deps

    await expect(getAgentRoleAuthorization(deps, 'agent-1', resource.id, organization.id)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('persists one immutable built-in Realmroot Resource Server', async () => {
    const authorization = repository()
    authorization.createResource.mockImplementation(async (input) => ({
      ...input,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
    const deps = { authorization } as unknown as Deps

    const created = await ensureRealmrootResourceServer(deps, 'https://auth.example.com')
    expect(created).toMatchObject({
      id: 'res_realmroot',
      identifier: 'realmroot',
      resourceUrl: 'https://auth.example.com/api',
      connectorId: null,
      ownerOrganizationId: 'org_platform',
    })

    authorization.findResource.mockResolvedValue(created)
    await expect(ensureRealmrootResourceServer(deps, 'https://auth.example.com')).resolves.toBe(created)
    await expect(updateResource(deps, created.id, { name: 'Changed' })).rejects.toThrow('system-managed')
    await expect(archiveResource(deps, created.id, actor)).rejects.toThrow('system-managed')
    await expect(restoreResource(deps, created.id, actor)).rejects.toThrow('system-managed')
    await expect(deleteResource(deps, created.id)).rejects.toThrow('system-managed')

    for (const invalid of [
      { ...created, identifier: 'changed' },
      { ...created, resourceUrl: 'https://other.example.com/api' },
      { ...created, ownerOrganizationId: 'org-other' },
      { ...created, connectorId: 'connector-1' },
    ]) {
      authorization.findResource.mockResolvedValueOnce(invalid)
      await expect(ensureRealmrootResourceServer(deps, 'https://auth.example.com')).rejects.toThrow(
        'does not match this deployment',
      )
    }
  })

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
    await expect(
      addMember(deps, organization.id, { userId: 'user-1', roles: ['member'] }, 'admin-1', false),
    ).resolves.toBe(member)
    expect(authorization.addMember).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({ id: expect.stringMatching(/^mem_/), title: null }),
    )
    await expect(listMembers(deps, organization.id, { limit: 20, offset: 0 })).resolves.toEqual({
      members: [member],
      pagination,
    })
    await expect(updateMember(deps, organization.id, member.id, { title: 'Owner' })).resolves.toBe(member)
    await expect(removeMember(deps, organization.id, member.id, 'admin-1')).resolves.toBeUndefined()

    await expect(
      createInvitation(deps, organization.id, { email: invitation.email, roles: ['member'] }, 'admin-1', false),
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
      { email: invitation.email, roles: ['member'], expiresAt: timestamp },
      'admin-1',
      false,
    )
    expect(authorization.createInvitation).toHaveBeenLastCalledWith(
      expect.objectContaining({ expiresAt: timestamp, inviterId: 'admin-1' }),
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
    await expect(removeMember(deps, organization.id, member.id, 'admin-1')).rejects.toMatchObject({ status: 404 })
    authorization.findInvitation.mockResolvedValue(null)
    await expect(cancelInvitation(deps, organization.id, 'missing')).rejects.toMatchObject({ status: 404 })
    authorization.findInvitation.mockResolvedValue({ ...invitation, organizationId: 'org-2' })
    await expect(cancelInvitation(deps, organization.id, invitation.id)).rejects.toMatchObject({ status: 404 })
  })

  it('rejects demoting or removing the last Organization Owner', async () => {
    const authorization = repository()
    const deps = { authorization } as unknown as Deps
    authorization.findMember.mockResolvedValue({ ...member, roles: ['owner'] })
    authorization.countMembersByRole.mockResolvedValue(1)
    authorization.removeMember.mockResolvedValue(false)

    await expect(
      replaceMemberRoles(deps, organization.id, member.id, { roles: ['admin'] }, 'admin-1', false),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Transfer Organization ownership before changing or removing the last Owner.',
    })
    await expect(removeMember(deps, organization.id, member.id, 'admin-1')).rejects.toMatchObject({ status: 412 })
    expect(authorization.replaceMemberRoles).not.toHaveBeenCalled()
    expect(authorization.removeMember).toHaveBeenCalled()
  })

  it('rejects granting Owner by a non-Owner Organization member', async () => {
    const authorization = repository()
    const deps = { authorization } as unknown as Deps
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.findMember.mockResolvedValue(member)
    authorization.findMemberByOrganizationUser.mockResolvedValue({ ...member, userId: 'admin-1', roles: ['admin'] })

    await expect(
      replaceMemberRoles(deps, organization.id, member.id, { roles: ['owner'] }, 'admin-1', false),
    ).rejects.toMatchObject({ status: 403, message: 'Only an Organization Owner can assign the Owner Role.' })
    await expect(
      addMember(deps, organization.id, { userId: 'new-owner', roles: ['owner'] }, 'admin-1', false),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      createInvitation(deps, organization.id, { email: 'owner@example.com', roles: ['owner'] }, 'admin-1', false),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('keeps predefined Roles immutable and dynamic Roles Organization-scoped [spec: management-api/management-restish-role-crud]', async () => {
    const authorization = repository()
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.findResource.mockImplementation(async (id) =>
      id === 'res_realmroot'
        ? { ...resource, id, identifier: 'realmroot', resourceUrl: 'https://auth.example.com/api' }
        : null,
    )
    authorization.createOrganizationRole.mockImplementation(async (_organizationId, input) => ({
      ...input,
      predefined: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
    const deps = { authorization } as unknown as Deps

    await expect(getRole(deps, organization.id, 'owner')).resolves.toMatchObject({ predefined: true })
    await expect(
      updateRole(deps, organization.id, 'owner', { displayName: 'Changed' }, 'user-1'),
    ).rejects.toMatchObject({
      status: 409,
    })
    await expect(deleteRole(deps, organization.id, 'owner', 'user-1')).rejects.toMatchObject({ status: 409 })

    await expect(
      createRole(
        deps,
        organization.id,
        {
          key: 'operator',
          displayName: 'Operator',
          description: null,
          scopes: [{ resourceId: 'res_realmroot', scope: 'applications:read' }],
        },
        'user-1',
      ),
    ).resolves.toMatchObject({ key: 'operator', predefined: false })
    expect(authorization.createOrganizationRole).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({ key: 'operator' }),
      { scope: ['res_realmroot/applications%3Aread'] },
      expect.objectContaining({ action: 'organization.role.created' }),
    )
  })

  it('unions multiple Better Auth Roles on each authorization decision', async () => {
    const authorization = repository()
    authorization.findMemberByOrganizationUser.mockResolvedValue({
      ...member,
      roles: ['member', 'custom-deployer'],
    })
    authorization.listOrganizationRoleScopes.mockResolvedValue(
      new Map([['custom-deployer', [{ resourceId: 'res_realmroot', scope: 'applications:write' }]]]),
    )
    const deps = { authorization } as unknown as Deps

    await expect(organizationUserHasScope(deps, organization.id, member.userId, 'organizations:read')).resolves.toBe(
      true,
    )
    await expect(organizationUserHasScope(deps, organization.id, member.userId, 'applications:write')).resolves.toBe(
      true,
    )

    authorization.findMemberByOrganizationUser.mockResolvedValue({ ...member, roles: ['member'] })
    await expect(organizationUserHasScope(deps, organization.id, member.userId, 'applications:write')).resolves.toBe(
      false,
    )
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
        authorization_details_catalog_version: 1,
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
    listUserMemberships: vi.fn().mockResolvedValue([]),
    listMemberUserIds: vi.fn().mockResolvedValue([]),
    countMembersByRole: vi.fn().mockResolvedValue(1),
    hasPendingInvitation: vi.fn().mockResolvedValue(false),
    updateMember: vi.fn(),
    replaceMemberRoles: vi.fn(),
    removeMember: vi.fn().mockResolvedValue(true),
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
    createOrganizationRole: vi.fn(),
    listOrganizationRoles: vi.fn().mockResolvedValue([]),
    findOrganizationRole: vi.fn().mockResolvedValue(null),
    updateOrganizationRole: vi.fn(),
    deleteOrganizationRole: vi.fn(),
    listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
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
