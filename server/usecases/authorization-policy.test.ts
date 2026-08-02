import {
  assignAgentRole,
  buildTokenClaims,
  getAgentRoleAuthorization,
  replaceRolePermissions,
  updateRole,
} from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import type { ApiResourceResponse, RoleResponse } from '@shared/api/authorization'
import { describe, expect, it, vi } from 'vitest'

const role: RoleResponse = {
  id: 'role-documents-reader',
  key: 'documents-reader',
  name: 'Documents reader',
  description: null,
  system: false,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
}

const resource: ApiResourceResponse = {
  id: 'resource-documents',
  identifier: 'documents',
  name: 'Documents API',
  resourceUrl: 'https://api.example.com',
  connectorId: null,
  authorizationDetails: [],
  description: null,
  enabled: true,
  ownerOrganizationId: 'org-home',
  accessEligibility: { mode: 'realm', organizationIds: [] },
  availableToAgents: true,
  archivedAt: null,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
}

describe('authorization policy', () => {
  it('[spec: management-api/replace-role-scopes] validates role permissions against the business OpenAPI authority', async () => {
    const replace = vi.fn()
    const fetch = vi.fn(async (request: Request) =>
      request.url.endsWith('/openapi.json')
        ? Response.json({
            openapi: '3.1.0',
            components: {
              securitySchemes: {
                oauth: {
                  type: 'oauth2',
                  flows: {
                    clientCredentials: {
                      tokenUrl: 'https://issuer.example.com/token',
                      scopes: { 'documents.read': 'Read documents' },
                    },
                  },
                },
              },
            },
            paths: {
              '/documents': {
                get: { security: [{ oauth: ['documents.read'] }] },
              },
            },
          })
        : new Response(null, {
            headers: { link: '<https://api.example.com/openapi.json>; rel="service-desc"' },
          }),
    )
    const deps = {
      authorization: {
        findRole: vi.fn().mockResolvedValue(role),
        findResource: vi.fn().mockResolvedValue(resource),
        replaceRolePermissions: replace,
      },
      externalHttp: { fetch },
    } as unknown as Deps

    await replaceRolePermissions(deps, role.id, [{ resourceId: resource.id, scope: 'documents.read' }])

    expect(replace).toHaveBeenCalledWith(role.id, [{ resourceId: resource.id, scope: 'documents.read' }])
    await expect(
      replaceRolePermissions(deps, role.id, [{ resourceId: resource.id, scope: 'documents.write' }]),
    ).rejects.toMatchObject({
      status: 400,
    })
  })

  it('[spec: agent-identity/agent-role-scope-eligibility] assigns resource roles to an Agent without inheriting controller roles', async () => {
    const assign = vi.fn()
    const deps = {
      authorization: {
        findRole: vi.fn().mockResolvedValue(role),
        findResource: vi.fn().mockResolvedValue(resource),
        createRoleAssignment: assign,
        listAgentRoleAssignments: vi.fn().mockResolvedValue([{ role, scopes: ['documents.read'] }]),
      },
      agentIdentities: {
        findIdentity: vi.fn().mockResolvedValue({
          identity: { id: 'agent-1', status: 'active', ownerOrganizationId: 'org-home' },
          bindings: [],
        }),
      },
    } as unknown as Deps

    await assignAgentRole(deps, { roleId: role.id, subjectId: 'agent-1' }, 'controller-1')

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: role.id,
        subjectType: 'agent',
        subjectId: 'agent-1',
        organizationId: null,
        assignedByUserId: 'controller-1',
      }),
    )
    await expect(getAgentRoleAuthorization(deps, 'agent-1', resource.id, 'org-home')).resolves.toEqual({
      roles: ['documents-reader'],
      scopes: ['documents.read'],
    })
  })

  it('[spec: agent-identity/native-token-authorization-claims] emits fixed groups and roles claims', async () => {
    const deps = {
      authorization: {
        findResourceByResourceUrl: vi.fn().mockResolvedValue(resource),
        listUserRoleAssignments: vi.fn().mockResolvedValue([{ role, scopes: ['documents.read'] }]),
        listApplicationRoleAssignments: vi.fn().mockResolvedValue([]),
        findMemberByOrganizationUser: vi.fn().mockResolvedValue({ id: 'member-1' }),
      },
    } as unknown as Deps

    await expect(
      buildTokenClaims(deps, {
        userId: 'user-1',
        organizationId: 'org-home',
        resource: resource.resourceUrl,
        scopes: ['documents.read'],
      }),
    ).resolves.toEqual({
      authorization: {
        audience: resource.resourceUrl,
        resource: resource.identifier,
        organization_id: 'org-home',
        groups: ['org-home'],
        roles: ['documents-reader'],
        scopes: ['documents.read'],
      },
      groups: ['org-home'],
      roles: ['documents-reader'],
    })
  })

  it('[spec: admin-console/admin-developer-access-policy] keeps Organization access levels out of business scopes', async () => {
    const membership = vi.fn().mockResolvedValue({ id: 'member-1', role: 'developer' })
    const deps = {
      authorization: {
        findResourceByResourceUrl: vi.fn().mockResolvedValue(resource),
        listUserRoleAssignments: vi.fn().mockResolvedValue([{ role, scopes: ['documents.read'] }]),
        listApplicationRoleAssignments: vi.fn().mockResolvedValue([]),
        findMemberByOrganizationUser: membership,
      },
    } as unknown as Deps
    const input = {
      userId: 'user-1',
      organizationId: 'org-home',
      resource: resource.resourceUrl,
      scopes: ['documents.read', 'documents.write'],
    }

    await expect(buildTokenClaims(deps, input)).resolves.toMatchObject({
      authorization: { roles: ['documents-reader'], scopes: ['documents.read'] },
    })
    membership.mockResolvedValue({ id: 'member-1', role: 'member' })
    await expect(buildTokenClaims(deps, input)).resolves.toMatchObject({
      authorization: { roles: ['documents-reader'], scopes: ['documents.read'] },
    })
  })

  it('removes requested scopes when the active Organization is not eligible for the target resource', async () => {
    const deps = {
      authorization: {
        findResourceByResourceUrl: vi.fn().mockResolvedValue({
          ...resource,
          accessEligibility: { mode: 'owner_organization', organizationIds: [] },
        }),
        findMemberByOrganizationUser: vi.fn().mockResolvedValue({ id: 'member-1', role: 'member' }),
      },
    } as unknown as Deps

    await expect(
      buildTokenClaims(deps, {
        userId: 'user-1',
        organizationId: 'org-other',
        resource: resource.resourceUrl,
        scopes: ['documents.read'],
      }),
    ).resolves.toMatchObject({ authorization: { roles: [], scopes: [] } })
  })

  it('updates Realm role metadata without an ownership scope', async () => {
    const deps = {
      authorization: {
        findRole: vi.fn().mockResolvedValue(role),
        updateRole: vi.fn(),
      },
    } as unknown as Deps

    await expect(updateRole(deps, role.id, { name: 'Document reader' })).resolves.toBe(role)
    expect(deps.authorization.updateRole).toHaveBeenCalledWith(role.id, { name: 'Document reader' })
  })
})
