import {
  addMember,
  buildTokenClaims,
  cancelInvitation,
  createInvitation,
  createOrganization,
  createResource,
  createRole,
  deleteOrganization,
  deleteResource,
  deleteRole,
  ensureRealmrootResourceServer,
  getOrganization,
  getResource,
  getResourceContract,
  getRole,
  listInvitations,
  listMembers,
  listOrganizations,
  listResources,
  listRoles,
  refreshResourceScopeRegistry,
  removeMember,
  replaceMemberRoles,
  synchronizeEnabledResourceScopeRegistries,
  updateMember,
  updateOrganization,
  updateResource,
  updateRole,
} from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import { organizationUserHasScope } from '@server/usecases/organization-membership-scopes'
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
const adminActor = { controllerUserId: 'admin-1', agent: null }
const agentActor = {
  controllerUserId: null,
  agent: {
    issuer: 'https://auth.example.com/api/auth',
    subject: 'agt_123',
    identityId: 'agent-1',
    hostId: 'host-1',
  },
}
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
  visibility: 'public',
  scopeRegistry: null,
  availableToAgents: true,
  createdAt: timestamp,
  updatedAt: timestamp,
}
describe('authorization CRUD and assignment policy', () => {
  it(`persists one immutable built-in Realmroot Resource Server and reconciles its deployment contract
      [spec: management-api/management-realmroot-resource-server-origin]`, async () => {
    const authorization = repository()
    authorization.createResource.mockImplementation(async (input) => ({
      ...input,
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
    expect(authorization.updateResource).not.toHaveBeenCalled()

    const stale = { ...created, resourceUrl: 'https://previous.example.com/api' }
    const reconciled = { ...created, resourceUrl: 'https://auth.example.com/api' }
    authorization.findResource.mockResolvedValueOnce(stale).mockResolvedValueOnce(reconciled)
    await expect(ensureRealmrootResourceServer(deps, 'https://auth.example.com')).resolves.toBe(reconciled)
    expect(authorization.updateResource).toHaveBeenCalledWith('res_realmroot', {
      resourceUrl: 'https://auth.example.com/api',
    })

    const staleRegistry = { ...created, scopeRegistry: null }
    authorization.findResource.mockResolvedValueOnce(staleRegistry).mockResolvedValueOnce(created)
    await expect(ensureRealmrootResourceServer(deps, 'https://auth.example.com')).resolves.toBe(created)
    expect(authorization.replaceResourceScopeRegistry).toHaveBeenCalledWith(
      'res_realmroot',
      expect.objectContaining({
        discovery: expect.objectContaining({ documentHash: 'system-managed' }),
        scopes: expect.arrayContaining([expect.objectContaining({ value: 'resource-servers:write' })]),
      }),
    )

    authorization.findResource.mockResolvedValueOnce(stale)
    authorization.updateResource.mockResolvedValueOnce(false)
    await expect(ensureRealmrootResourceServer(deps, 'https://auth.example.com')).rejects.toThrow(
      'could not be reconciled',
    )

    authorization.findResource.mockResolvedValueOnce(stale).mockResolvedValueOnce(stale)
    await expect(ensureRealmrootResourceServer(deps, 'https://auth.example.com')).rejects.toThrow(
      'could not be reconciled',
    )

    await expect(updateResource(deps, created.id, { name: 'Changed' })).rejects.toThrow('system-managed')
    await expect(deleteResource(deps, created.id, actor)).rejects.toThrow('system-managed')

    for (const invalid of [
      { ...created, identifier: 'changed' },
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

    await expect(createOrganization(deps, { slug: 'acme', name: 'Acme' }, 'creator-1')).resolves.toBe(organization)
    expect(authorization.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^org_/),
        displayName: null,
        logo: null,
        disabled: false,
        disabledReason: null,
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^mem_/),
        userId: 'creator-1',
        roles: ['owner'],
        title: null,
      }),
    )
    await expect(listOrganizations(deps, { limit: 20, offset: 0 })).resolves.toEqual({
      organizations: [organization],
      pagination,
    })
    await expect(getOrganization(deps, organization.id)).resolves.toBe(organization)
    await expect(updateOrganization(deps, organization.id, { name: 'Acme 2' })).resolves.toBe(organization)
    expect(authorization.updateOrganization).toHaveBeenCalledWith(organization.id, { name: 'Acme 2' })
    await expect(addMember(deps, organization.id, { userId: 'user-1', roles: ['member'] })).resolves.toBe(member)
    expect(authorization.addMember).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({ id: expect.stringMatching(/^mem_/), title: null }),
    )
    await expect(listMembers(deps, organization.id, { limit: 20, offset: 0 })).resolves.toEqual({
      members: [member],
      pagination,
    })
    await expect(updateMember(deps, organization.id, member.id, { title: 'Owner' })).resolves.toBe(member)
    await expect(removeMember(deps, organization.id, member.id, adminActor)).resolves.toBeUndefined()

    await expect(
      createInvitation(deps, organization.id, { email: invitation.email, roles: ['member'] }, adminActor),
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
      adminActor,
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
    await expect(removeMember(deps, organization.id, member.id, adminActor)).rejects.toMatchObject({ status: 404 })
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
      replaceMemberRoles(deps, organization.id, member.id, { roles: ['admin'] }, adminActor),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Transfer Organization ownership before changing or removing the last Owner.',
    })
    await expect(removeMember(deps, organization.id, member.id, adminActor)).rejects.toMatchObject({ status: 412 })
    expect(authorization.replaceMemberRoles).not.toHaveBeenCalled()
    expect(authorization.removeMember).toHaveBeenCalled()
  })

  it('allows Owner assignment after the caller has role-assignment permission', async () => {
    const authorization = repository()
    const deps = { authorization } as unknown as Deps
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.findMember.mockResolvedValue(member)
    authorization.replaceMemberRoles.mockResolvedValue(true)
    authorization.addMember.mockResolvedValue(member)
    authorization.createInvitation.mockResolvedValue({ ...invitation, roles: ['owner'] })

    await expect(
      replaceMemberRoles(deps, organization.id, member.id, { roles: ['owner'] }, adminActor),
    ).resolves.toEqual({ roles: ['owner'] })
    await expect(addMember(deps, organization.id, { userId: 'new-owner', roles: ['owner'] })).resolves.toBe(member)
    await expect(
      createInvitation(deps, organization.id, { email: 'owner@example.com', roles: ['owner'] }, adminActor),
    ).resolves.toMatchObject({ roles: ['owner'] })
  })

  it('replaces multiple Roles atomically and validates Owner and dynamic Role assignments', async () => {
    const authorization = repository()
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.findMember.mockResolvedValue({ ...member, roles: ['owner'] })
    authorization.countMembersByRole.mockResolvedValue(2)
    authorization.replaceMemberRoles.mockResolvedValue(true)
    authorization.addMember.mockResolvedValue(member)
    authorization.listOrganizationRoles.mockResolvedValue([
      {
        key: 'operator',
        displayName: 'Operator',
        description: null,
        predefined: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ])
    const deps = { authorization } as unknown as Deps

    await expect(
      replaceMemberRoles(deps, organization.id, member.id, { roles: ['admin', 'operator'] }, adminActor),
    ).resolves.toEqual({ roles: ['admin', 'operator'] })
    expect(authorization.replaceMemberRoles).toHaveBeenCalledWith(
      organization.id,
      member.id,
      ['admin', 'operator'],
      timestamp,
      expect.objectContaining({ action: 'organization.member.roles-replaced' }),
    )

    authorization.replaceMemberRoles.mockResolvedValue(false)
    await expect(
      replaceMemberRoles(deps, organization.id, member.id, { roles: ['admin'] }, adminActor),
    ).rejects.toMatchObject({ status: 412 })

    await expect(addMember(deps, organization.id, { userId: 'owner-2', roles: ['owner'] })).resolves.toBe(member)
    await expect(addMember(deps, organization.id, { userId: 'owner-3', roles: ['owner'] })).resolves.toBe(member)
    await expect(
      addMember(deps, organization.id, { userId: 'unknown', roles: ['missing-role'] }),
    ).rejects.toMatchObject({ status: 400 })
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
    await expect(updateRole(deps, organization.id, 'owner', { displayName: 'Changed' }, actor)).rejects.toMatchObject({
      status: 409,
    })
    await expect(deleteRole(deps, organization.id, 'owner', actor)).rejects.toMatchObject({ status: 409 })

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
        agentActor,
      ),
    ).resolves.toMatchObject({ key: 'operator', predefined: false })
    expect(authorization.createOrganizationRole).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({ key: 'operator' }),
      { scope: ['res_realmroot/applications%3Aread'] },
      expect.objectContaining({
        action: 'organization.role.created',
        controllerUserId: null,
        subjectIssuer: agentActor.agent.issuer,
        subject: agentActor.agent.subject,
        agentIdentityId: agentActor.agent.identityId,
        hostId: agentActor.agent.hostId,
      }),
    )
  })

  it('lists, updates, and deletes dynamic Organization Roles with optimistic concurrency', async () => {
    const authorization = repository()
    const dynamicRole = {
      key: 'operator',
      displayName: 'Operator',
      description: null,
      predefined: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.listOrganizationRoles.mockResolvedValue([dynamicRole])
    authorization.listOrganizationRoleScopes.mockResolvedValue(
      new Map([['operator', [{ resourceId: 'res_realmroot', scope: 'applications:read' }]]]),
    )
    authorization.findOrganizationRole.mockResolvedValue(dynamicRole)
    authorization.updateOrganizationRole.mockResolvedValue(true)
    authorization.deleteOrganizationRole.mockResolvedValue('deleted')
    const deps = { authorization } as unknown as Deps

    await expect(listRoles(deps, organization.id, { limit: 2, offset: 0 })).resolves.toMatchObject({
      roles: [{ key: 'admin' }, { key: 'developer' }],
      pagination: { limit: 2, offset: 0, total: 5, hasMore: true },
    })
    await expect(getRole(deps, organization.id, 'operator')).resolves.toMatchObject({
      key: 'operator',
      scopes: [{ resourceId: 'res_realmroot', scope: 'applications:read' }],
    })
    await expect(
      updateRole(deps, organization.id, 'operator', { displayName: 'Tenant operator' }, actor),
    ).resolves.toMatchObject({ key: 'operator' })
    expect(authorization.updateOrganizationRole).toHaveBeenCalledWith(
      organization.id,
      'operator',
      { displayName: 'Tenant operator' },
      undefined,
      timestamp,
      expect.objectContaining({ action: 'organization.role.updated' }),
    )
    await expect(deleteRole(deps, organization.id, 'operator', actor)).resolves.toBeUndefined()
    expect(authorization.deleteOrganizationRole).toHaveBeenCalledWith(
      organization.id,
      'operator',
      timestamp,
      expect.objectContaining({ action: 'organization.role.deleted' }),
    )

    authorization.findOrganizationRole.mockResolvedValue(null)
    await expect(getRole(deps, organization.id, 'missing')).rejects.toMatchObject({ status: 404 })
    authorization.findOrganizationRole.mockResolvedValue(dynamicRole)
    authorization.updateOrganizationRole.mockResolvedValue(false)
    await expect(
      updateRole(deps, organization.id, 'operator', { description: 'Changed' }, actor),
    ).rejects.toMatchObject({ status: 412 })
    authorization.deleteOrganizationRole.mockResolvedValue('assigned')
    await expect(deleteRole(deps, organization.id, 'operator', actor)).rejects.toMatchObject({ status: 409 })
    authorization.deleteOrganizationRole.mockResolvedValue('not_found')
    await expect(deleteRole(deps, organization.id, 'operator', actor)).rejects.toMatchObject({ status: 412 })
  })

  it('validates and normalizes internal and external dynamic Role scopes', async () => {
    const authorization = repository()
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.findResource.mockImplementation(async (id) =>
      id === 'res_realmroot'
        ? {
            ...resource,
            id,
            identifier: 'realmroot',
            resourceUrl: 'https://auth.example.com/api',
            scopeRegistry: scopeRegistry(['applications:read']),
          }
        : id === resource.id
          ? { ...resource, scopeRegistry: scopeRegistry(['projects:read']) }
          : null,
    )
    authorization.findOrganizationRole.mockResolvedValue({
      key: 'operator',
      displayName: 'Operator',
      description: null,
      predefined: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    authorization.updateOrganizationRole.mockResolvedValue(true)
    const deps = {
      authorization,
      externalHttp: { fetch: vi.fn(resourceScopeOpenApiFetch(resource.resourceUrl, ['projects:read'])) },
    } as unknown as Deps

    await expect(
      createRole(deps, organization.id, { key: 'owner', displayName: 'Reserved', scopes: [] }, actor),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      createRole(
        deps,
        organization.id,
        {
          key: 'invalid',
          displayName: 'Invalid',
          scopes: [{ resourceId: 'res_realmroot', scope: 'unknown:scope' }],
        },
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 })

    await updateRole(
      deps,
      organization.id,
      'operator',
      {
        scopes: [
          { resourceId: resource.id, scope: 'projects:read' },
          { resourceId: resource.id, scope: 'projects:read' },
          { resourceId: 'res_realmroot', scope: 'applications:read' },
        ],
      },
      actor,
    )
    expect(authorization.updateOrganizationRole).toHaveBeenCalledWith(
      organization.id,
      'operator',
      expect.anything(),
      { scope: ['res_realmroot/applications%3Aread', 'resource-1/projects%3Aread'] },
      timestamp,
      expect.anything(),
    )

    authorization.findResource.mockResolvedValue({
      ...resource,
      visibility: 'public',
    })
    await expect(
      updateRole(
        deps,
        organization.id,
        'operator',
        { scopes: [{ resourceId: resource.id, scope: 'projects:read' }] },
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('builds tenant-bound user and workload token claims fail closed', async () => {
    const authorization = repository()
    authorization.findResourceByResourceUrl.mockResolvedValue(resource)
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.findMemberByOrganizationUser.mockResolvedValue({ ...member, roles: ['member', 'operator'] })
    const deps = { authorization } as unknown as Deps
    const selection = {
      authorization: true,
      roles: true,
      groups: true,
      scopes: true,
      organizationId: true,
      organizationName: true,
    }

    await expect(
      buildTokenClaims(deps, {
        userId: member.userId,
        organizationId: organization.id,
        resource: resource.resourceUrl,
        scopes: ['projects:read', 'projects:write'],
        authorizedScopes: ['projects:read'],
        claimSelection: selection,
      }),
    ).resolves.toMatchObject({
      roles: ['member', 'operator'],
      groups: [organization.id],
      scope: 'projects:read',
      organization_id: organization.id,
      organization_name: organization.displayName,
      authorization: { scopes: ['projects:read'], resource: resource.identifier },
    })

    authorization.findMemberByOrganizationUser.mockResolvedValue(null)
    await expect(
      buildTokenClaims(deps, {
        userId: member.userId,
        organizationId: organization.id,
        resource: resource.resourceUrl,
        scopes: ['projects:read'],
      }),
    ).rejects.toMatchObject({ status: 403 })

    authorization.findResourceByResourceUrl.mockResolvedValue(null)
    await expect(
      buildTokenClaims(deps, { resource: 'https://missing.example.com', scopes: ['projects:read'] }),
    ).resolves.toMatchObject({ authorization: { scopes: [] } })

    authorization.findResourceByResourceUrl.mockResolvedValue({
      ...resource,
      visibility: 'private',
    })
    await expect(
      buildTokenClaims(deps, { organizationId: 'org-2', resource: resource.resourceUrl, scopes: ['projects:read'] }),
    ).resolves.toMatchObject({ authorization: { scopes: [] } })

    await expect(
      buildTokenClaims(deps, { organizationId: organization.id, scopes: ['organizations:read'] }),
    ).resolves.toMatchObject({ authorization: { scopes: ['organizations:read'] } })
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
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.createResource.mockResolvedValue(resource)
    authorization.listResources.mockResolvedValue({ items: [resource], pagination })
    authorization.findResource.mockResolvedValue(resource)
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
                  resource: resource.resourceUrl,
                  authorization_servers: [resource.resourceUrl],
                  scopes_supported: ['projects:read'],
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
      ownerOrganizationId: organization.id,
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
      ownerOrganizationId: organization.id,
    })
    expect(authorization.createResource).toHaveBeenLastCalledWith(
      expect.objectContaining({ authorizationDetails: [], connectorId: 'connector-1' }),
    )
    await expect(
      createResource(deps, {
        identifier: 'invalid-native-rar',
        name: 'Invalid native RAR',
        resourceUrl: resource.resourceUrl,
        ownerOrganizationId: organization.id,
        authorizationDetails: [{ type: 'project_access', project_id: 'project-1' }],
      }),
    ).rejects.toThrow('Authorization details require an external API resource connector.')
    await createResource(deps, {
      identifier: 'external',
      name: 'External',
      resourceUrl: resource.resourceUrl,
      connectorId: 'connector-1',
      ownerOrganizationId: organization.id,
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
    authorization.deleteResource.mockResolvedValue(true)
    await deleteResource(deps, resource.id, {
      controllerUserId: null,
      agent: {
        issuer: 'https://auth.example.com',
        subject: 'agent-subject',
        identityId: 'identity-1',
        hostId: 'host-1',
      },
    })
    expect(authorization.deleteResource).toHaveBeenCalledWith(
      resource.id,
      expect.any(Date),
      expect.objectContaining({
        action: 'api_resource.deleted',
        controllerUserId: null,
        subjectIssuer: 'https://auth.example.com',
        subject: 'agent-subject',
        agentIdentityId: 'identity-1',
        hostId: 'host-1',
      }),
    )

    authorization.findResource.mockResolvedValue(resource)
    authorization.updateResource.mockResolvedValueOnce(false)
    await expect(updateResource(deps, resource.id, { enabled: true })).rejects.toMatchObject({
      status: 404,
      message: 'API resource was not found.',
    })

    authorization.findResource.mockResolvedValue(resource)
    authorization.deleteResource.mockResolvedValue(false)
    await expect(deleteResource(deps, resource.id, actor)).rejects.toMatchObject({ status: 404 })

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

  it('rejects external scope refresh when the protected resource authorization server drifts', async () => {
    const authorization = repository()
    const existingRegistry = scopeRegistry(['projects:read'])
    authorization.findResource.mockResolvedValue({
      ...resource,
      connectorId: 'connector-1',
      scopeRegistry: existingRegistry,
    })
    const deps = {
      authorization,
      connectors: {
        findById: vi.fn().mockResolvedValue({
          id: 'connector-1',
          providerType: 'generic_oauth',
          enabled: true,
          clientId: 'client-1',
          clientSecret: 'secret',
          issuer: 'https://issuer.example.com',
          authorizationEndpoint: 'https://issuer.example.com/authorize',
          tokenEndpoint: 'https://issuer.example.com/token',
          userInfoEndpoint: 'https://issuer.example.com/userinfo',
          jwksEndpoint: 'https://issuer.example.com/jwks',
          revocationEndpoint: 'https://issuer.example.com/revoke',
          providerMetadata: {
            grant_types_supported: [
              'authorization_code',
              'refresh_token',
              'urn:ietf:params:oauth:grant-type:jwt-bearer',
              'urn:ietf:params:oauth:grant-type:token-exchange',
            ],
            dpop_signing_alg_values_supported: ['ES256'],
          },
        }),
      },
      externalHttp: {
        fetch: vi.fn().mockResolvedValue(
          Response.json({
            resource: resource.resourceUrl,
            authorization_servers: ['https://drifted.example.com'],
            scopes_supported: ['projects:write'],
          }),
        ),
      },
    } as unknown as Deps

    await expect(refreshResourceScopeRegistry(deps, resource.id)).rejects.toThrow(
      'authorization server does not match the selected OIDC connector',
    )
    expect(authorization.replaceResourceScopeRegistry).toHaveBeenCalledWith(resource.id, {
      ...existingRegistry,
      discovery: {
        ...existingRegistry.discovery,
        lastError: expect.objectContaining({ code: 'bad_request' }),
      },
    })
  })

  it('refreshes active scope registries and continues after an isolated failure', async () => {
    const authorization = repository()
    const active = { ...resource, scopeRegistry: scopeRegistry(['projects:read']) }
    authorization.findResource.mockImplementation(async (id) =>
      id === 'resource-failing' ? { ...active, id, resourceUrl: 'https://failing.example.com' } : active,
    )
    authorization.listEnabledResources.mockResolvedValue([
      active,
      { ...active, id: 'resource-failing', resourceUrl: 'https://failing.example.com' },
      { ...active, id: 'res_realmroot' },
      { ...active, id: 'resource-deleted', deletedAt: new Date(timestamp) },
    ])
    const openApiFetch = resourceOpenApiFetch(resource.resourceUrl)
    const deps = {
      authorization,
      externalHttp: {
        fetch: vi.fn((request: Request) => {
          if (request.url.includes('failing.example.com')) return Promise.reject(new Error('offline'))
          if (request.url.includes('/.well-known/oauth-protected-resource')) {
            return Promise.resolve(
              Response.json({ resource: resource.resourceUrl, scopes_supported: ['projects:read'] }),
            )
          }
          return openApiFetch(request)
        }),
      },
    } as unknown as Deps
    await expect(refreshResourceScopeRegistry(deps, resource.id)).resolves.toBe(active)
    expect(authorization.replaceResourceScopeRegistry).toHaveBeenCalledWith(
      resource.id,
      expect.objectContaining({ scopes: [expect.objectContaining({ value: 'projects:read' })] }),
    )
    await expect(synchronizeEnabledResourceScopeRegistries(deps)).resolves.toBeUndefined()
    authorization.findResource.mockResolvedValueOnce({ ...active, enabled: false })
    await expect(refreshResourceScopeRegistry(deps, resource.id)).rejects.toMatchObject({ status: 400 })
    authorization.findResource.mockResolvedValueOnce(active)
    authorization.replaceResourceScopeRegistry.mockResolvedValueOnce(false)
    await expect(refreshResourceScopeRegistry(deps, resource.id)).rejects.toMatchObject({ status: 400 })
  })

  it('updates only declared Resource Server scope grant modes', async () => {
    const authorization = repository()
    const registered = { ...resource, scopeRegistry: scopeRegistry(['projects:read', 'projects:write']) }
    authorization.findResource.mockResolvedValue(registered)
    authorization.updateResource.mockResolvedValue(true)
    authorization.replaceResourceScopeRegistry.mockResolvedValue(true)
    const deps = { authorization } as unknown as Deps
    await expect(
      updateResource(deps, resource.id, { scopeGrantModes: [{ scope: 'projects:read', grantMode: 'automatic' }] }),
    ).resolves.toBe(registered)
    authorization.findResource.mockResolvedValueOnce({ ...resource, scopeRegistry: null })
    await expect(
      updateResource(deps, resource.id, { scopeGrantModes: [{ scope: 'projects:read', grantMode: 'automatic' }] }),
    ).rejects.toThrow('synchronized')
    authorization.findResource.mockResolvedValueOnce(registered)
    await expect(
      updateResource(deps, resource.id, { scopeGrantModes: [{ scope: 'unknown', grantMode: 'automatic' }] }),
    ).rejects.toThrow('not declared')
    authorization.findResource.mockResolvedValueOnce(registered)
    authorization.findOrganization.mockResolvedValueOnce(organization)
    await expect(updateResource(deps, resource.id, { ownerOrganizationId: organization.id })).resolves.toBe(registered)
    authorization.findResource.mockResolvedValueOnce(registered)
    authorization.replaceResourceScopeRegistry.mockResolvedValueOnce(false)
    await expect(
      updateResource(deps, resource.id, { scopeGrantModes: [{ scope: 'projects:read', grantMode: 'automatic' }] }),
    ).rejects.toThrow('API resource was not found.')
    const realmroot = { ...registered, id: 'res_realmroot', resourceUrl: 'https://auth.example.com/api' }
    authorization.findResource.mockResolvedValueOnce(realmroot).mockResolvedValueOnce(realmroot)
    await expect(refreshResourceScopeRegistry(deps, 'res_realmroot')).resolves.toBe(realmroot)
    expect(authorization.replaceResourceScopeRegistry).toHaveBeenCalledWith(
      'res_realmroot',
      expect.objectContaining({
        discovery: expect.objectContaining({ documentHash: 'system-managed' }),
        scopes: expect.arrayContaining([expect.objectContaining({ value: 'resource-servers:write' })]),
      }),
    )
  })

  it('covers Role defaults, visibility, and derived token scopes', async () => {
    const authorization = repository()
    const dynamicRole = {
      key: 'operator',
      displayName: 'Operator',
      description: null,
      predefined: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.listOrganizationRoles.mockResolvedValue([dynamicRole])
    authorization.listOrganizationRoleScopes.mockResolvedValue(new Map())
    const deps = { authorization } as unknown as Deps
    await expect(listRoles(deps, organization.id, { limit: 20, offset: 0 })).resolves.toMatchObject({
      roles: expect.arrayContaining([expect.objectContaining({ key: 'operator', scopes: [] })]),
    })

    authorization.findResource.mockResolvedValueOnce({
      ...resource,
      visibility: 'private',
      ownerOrganizationId: 'other',
    })
    await expect(
      createRole(
        deps,
        organization.id,
        { key: 'hidden', displayName: 'Hidden', scopes: [{ resourceId: resource.id, scope: 'projects:read' }] },
        actor,
      ),
    ).rejects.toThrow('not visible')
    authorization.findResource.mockResolvedValueOnce({
      ...resource,
      scopeRegistry: {
        ...scopeRegistry(['projects:read']),
        scopes: [{ value: 'projects:read', description: null, grantMode: 'automatic' }],
      },
    })
    await expect(
      createRole(
        deps,
        organization.id,
        { key: 'automatic', displayName: 'Automatic', scopes: [{ resourceId: resource.id, scope: 'projects:read' }] },
        actor,
      ),
    ).rejects.toThrow('assigned scopes')

    const assignedResource = {
      ...resource,
      scopeRegistry: {
        ...scopeRegistry(['projects:read']),
        scopes: [{ value: 'projects:read', description: null, grantMode: 'assigned' as const }],
      },
    }
    authorization.findResourceByResourceUrl.mockResolvedValue(assignedResource)
    authorization.findMemberByOrganizationUser.mockResolvedValue({ ...member, roles: ['operator'] })
    authorization.listOrganizationRoleScopes.mockResolvedValue(
      new Map([['operator', [{ resourceId: resource.id, scope: 'projects:read' }]]]),
    )
    authorization.findResource.mockResolvedValue(assignedResource)
    await expect(
      buildTokenClaims(deps, {
        userId: member.userId,
        organizationId: organization.id,
        resource: resource.resourceUrl,
        scopes: ['projects:read'],
      }),
    ).resolves.toMatchObject({ authorization: { scopes: ['projects:read'] } })
    await expect(
      buildTokenClaims(deps, {
        userId: member.userId,
        organizationId: organization.id,
        resource: resource.resourceUrl,
        scopes: ['projects:read'],
        authorizedScopes: ['projects:read'],
      }),
    ).resolves.toMatchObject({ authorization: { scopes: ['projects:read'] } })
    authorization.findResourceByResourceUrl.mockResolvedValueOnce(null)
    await expect(
      buildTokenClaims(deps, {
        userId: member.userId,
        organizationId: organization.id,
        resource: 'https://missing.example.com',
        scopes: ['projects:read'],
      }),
    ).resolves.toMatchObject({ authorization: { scopes: [] } })
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

    authorization.findOrganization.mockResolvedValue(organization)
    authorization.createResource.mockResolvedValue(resource)
    await expect(
      createResource(deps, {
        identifier: 'organization-api',
        name: 'Organization API',
        resourceUrl: resource.resourceUrl,
        ownerOrganizationId: organization.id,
        visibility: 'public',
        enabled: false,
      }),
    ).resolves.toBe(resource)
  })

  it('updates only declared Resource Server scope grant modes', async () => {
    const authorization = repository()
    const registered = { ...resource, scopeRegistry: scopeRegistry(['projects:read']) }
    authorization.findResource.mockResolvedValue(registered)
    authorization.updateResource.mockResolvedValue(true)
    authorization.replaceResourceScopeRegistry.mockResolvedValue(true)
    const deps = { authorization } as unknown as Deps

    await expect(
      updateResource(deps, resource.id, {
        scopeGrantModes: [{ scope: 'projects:read', grantMode: 'automatic' }],
      }),
    ).resolves.toBe(registered)
    expect(authorization.replaceResourceScopeRegistry).toHaveBeenCalledWith(
      resource.id,
      expect.objectContaining({ scopes: [expect.objectContaining({ grantMode: 'automatic' })] }),
    )

    authorization.findResource.mockResolvedValueOnce({ ...resource, scopeRegistry: null })
    await expect(
      updateResource(deps, resource.id, {
        scopeGrantModes: [{ scope: 'projects:read', grantMode: 'automatic' }],
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('synchronized') })
    authorization.findResource.mockResolvedValueOnce(registered)
    await expect(
      updateResource(deps, resource.id, {
        scopeGrantModes: [{ scope: 'projects:unknown', grantMode: 'automatic' }],
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('not declared') })
  })

  it('validates the resource contract before enabling it [spec: agent-identity/api-resource-contract-validation]', async () => {
    const authorization = repository()
    authorization.findOrganization.mockResolvedValue(organization)
    authorization.createResource.mockResolvedValue(resource)
    authorization.findResource.mockResolvedValue(resource)
    const externalHttp = {
      fetch: vi.fn(async (request: Request) =>
        request.url.includes('/.well-known/oauth-protected-resource')
          ? Response.json({
              resource: resourceUrlFromMetadataUrl(request.url),
              scopes_supported: ['projects:read'],
            })
          : new Response('<html></html>'),
      ),
    }
    const deps = {
      authorization,
      externalResources: { findAuthorization: vi.fn() },
      externalHttp,
    } as unknown as Deps
    const input = {
      identifier: 'projects',
      name: 'Projects',
      resourceUrl: resource.resourceUrl,
      ownerOrganizationId: organization.id,
    }

    await expect(createResource(deps, input)).rejects.toThrow('Business resource must advertise its OpenAPI document')
    expect(authorization.createResource).not.toHaveBeenCalled()

    await expect(createResource(deps, { ...input, enabled: false })).resolves.toBe(resource)
    expect(authorization.createResource).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    expect(externalHttp.fetch).toHaveBeenCalledTimes(2)

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
    replaceResourceScopeRegistry: vi.fn().mockResolvedValue(true),
    deleteResource: vi.fn().mockResolvedValue(true),
    createOrganizationRole: vi.fn(),
    listOrganizationRoles: vi.fn().mockResolvedValue([]),
    findOrganizationRole: vi.fn().mockResolvedValue(null),
    updateOrganizationRole: vi.fn(),
    deleteOrganizationRole: vi.fn(),
    listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
  }
}

function scopeRegistry(scopes: string[]) {
  return {
    discovery: {
      sourceUrl: 'https://api.example.com/openapi.json',
      etag: null,
      documentHash: 'test-registry',
      syncedAt: timestamp,
      lastError: null,
    },
    scopes: scopes.map((value) => ({ value, description: null, grantMode: 'assigned' as const })),
  }
}

function resourceOpenApiFetch(resourceUrl: string) {
  return async (request: Request) => {
    if (request.url === protectedResourceMetadataUrl(resourceUrl)) {
      return Response.json({ resource: resourceUrl, scopes_supported: ['projects:read'] })
    }
    if (request.url === new URL(resourceUrl).toString()) {
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    if (request.url === new URL('/openapi.json', resourceUrl).toString()) {
      return Response.json({ openapi: '3.1.0', paths: {} })
    }
    return new Response(null, { status: 404 })
  }
}

function resourceScopeOpenApiFetch(resourceUrl: string, scopes: string[]) {
  return async (request: Request) => {
    if (request.url === protectedResourceMetadataUrl(resourceUrl)) {
      return Response.json({ resource: resourceUrl, scopes_supported: scopes })
    }
    if (request.url === new URL(resourceUrl).toString()) {
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    if (request.url === new URL('/openapi.json', resourceUrl).toString()) {
      return Response.json({
        openapi: '3.1.0',
        components: {
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: {
                clientCredentials: {
                  tokenUrl: '/token',
                  scopes: Object.fromEntries(scopes.map((scope) => [scope, scope])),
                },
              },
            },
          },
        },
        paths: { '/projects': { get: { security: [{ oauth: scopes }] } } },
      })
    }
    return new Response(null, { status: 404 })
  }
}

function protectedResourceMetadataUrl(resourceUrl: string) {
  const resource = new URL(resourceUrl)
  const path = resource.pathname === '/' ? '' : resource.pathname
  return new URL(`/.well-known/oauth-protected-resource${path}`, resource.origin).toString()
}

function resourceUrlFromMetadataUrl(metadataUrl: string) {
  const metadata = new URL(metadataUrl)
  const prefix = '/.well-known/oauth-protected-resource'
  return `${metadata.origin}${metadata.pathname.slice(prefix.length)}${metadata.search}`
}
