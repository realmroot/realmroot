import {
  assignAgentRole,
  buildTokenClaims,
  getAgentRoleAuthorization,
  replaceRoleScopes,
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
  resourceId: 'resource-documents',
  organizationId: 'org-home',
  applicationId: null,
  system: false,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
}

const resource: ApiResourceResponse = {
  id: 'resource-documents',
  identifier: 'documents',
  name: 'Documents API',
  audience: 'https://api.example.com',
  resourceUrl: 'https://api.example.com',
  authorizationMode: 'native',
  description: null,
  enabled: true,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
}

describe('authorization policy', () => {
  it('[spec: management-api/replace-role-scopes] validates role scopes against the business OpenAPI authority', async () => {
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
        replaceRoleScopes: replace,
      },
      externalHttp: { fetch },
    } as unknown as Deps

    await replaceRoleScopes(deps, role.id, ['documents.read'])

    expect(replace).toHaveBeenCalledWith(role.id, ['documents.read'])
    await expect(replaceRoleScopes(deps, role.id, ['documents.write'])).rejects.toMatchObject({
      status: 400,
    })
  })

  it('[spec: agent-identity/agent-role-scope-eligibility] assigns resource roles to an Agent without inheriting controller roles', async () => {
    const assign = vi.fn()
    const deps = {
      authorization: {
        findRole: vi.fn().mockResolvedValue(role),
        assignAgentRole: assign,
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
        subjectId: 'agent-1',
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
        findResourceByAudience: vi.fn().mockResolvedValue(resource),
        listUserRoleAssignments: vi.fn().mockResolvedValue([{ role, scopes: ['documents.read'] }]),
        listApplicationRoleAssignments: vi.fn().mockResolvedValue([]),
        findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Deps

    await expect(
      buildTokenClaims(deps, {
        userId: 'user-1',
        organizationId: 'org-home',
        resource: resource.audience,
        scopes: ['documents.read'],
      }),
    ).resolves.toEqual({
      authorization: {
        audience: resource.audience,
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

  it('keeps the role resource and subject scope immutable', async () => {
    const deps = {
      authorization: { findRole: vi.fn().mockResolvedValue(role) },
    } as unknown as Deps

    await expect(updateRole(deps, role.id, { resourceId: 'another-resource' })).rejects.toMatchObject({
      status: 400,
      message: 'Role resource and subject scope cannot be changed after creation.',
    })
  })
})
