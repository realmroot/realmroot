import type { Deps } from '@server/usecases/deps'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { describe, expect, it, vi } from 'vitest'
import { filterOAuthAccessTokenScopes } from './auth-helpers'

function createMockDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    applications: {
      findById: vi.fn(),
      findByClientId: vi.fn(),
    },
    authorization: {
      findResourceByResourceUrl: vi.fn(),
      findMemberByOrganizationUser: vi.fn(),
      findResource: vi.fn(),
      listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
    },
    ...overrides,
  } as unknown as Deps
}

describe('filterOAuthAccessTokenScopes', () => {
  const realmResource: ApiResourceResponse = {
    id: 'res_realm',
    identifier: 'realm-api',
    name: 'Realm API',
    resourceUrl: 'https://api.example.com/realm',
    connectorId: null,
    authorizationDetails: [],
    description: null,
    enabled: true,
    ownerOrganizationId: 'org_platform',
    accessEligibility: { mode: 'realm', organizationIds: [] },
    availableToAgents: true,
    archivedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }

  const orgPrivateResource: ApiResourceResponse = {
    id: 'res_org_private',
    identifier: 'private-api',
    name: 'Private Org API',
    resourceUrl: 'https://api.example.com/private',
    connectorId: null,
    authorizationDetails: [],
    description: null,
    enabled: true,
    ownerOrganizationId: 'org_1',
    accessEligibility: { mode: 'owner_organization', organizationIds: [] },
    availableToAgents: true,
    archivedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }

  it('preserves approved Realm-wide scopes without Organization membership [spec: hosted-auth/oauth-consent]', async () => {
    const deps = createMockDeps({
      authorization: {
        findResourceByResourceUrl: vi.fn().mockImplementation(async (url: string) => {
          if (url === realmResource.resourceUrl) return realmResource
          return null
        }),
        findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
        findResource: vi.fn(),
        listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
      } as unknown as Deps['authorization'],
    })

    const scopes = await filterOAuthAccessTokenScopes(deps, {
      user: { id: 'user_non_member', role: 'user' },
      scopes: ['openid', 'users:read'],
      resource: realmResource.resourceUrl,
    })

    expect(scopes).toEqual(['openid', 'users:read'])
    expect(deps.authorization.listOrganizationRoleScopes).not.toHaveBeenCalled()
  })

  it('filters out private organization resource scopes if user is not an organization member', async () => {
    const deps = createMockDeps({
      authorization: {
        findResourceByResourceUrl: vi.fn().mockImplementation(async (url: string) => {
          if (url === orgPrivateResource.resourceUrl) return orgPrivateResource
          return null
        }),
        findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
        findResource: vi.fn(),
        listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
      } as unknown as Deps['authorization'],
    })

    const scopes = await filterOAuthAccessTokenScopes(deps, {
      user: { id: 'user_non_member', role: 'user' },
      scopes: ['openid', 'users:read'],
      resource: orgPrivateResource.resourceUrl,
      referenceId: 'org_1',
    })

    expect(scopes).toEqual(['openid'])
  })

  it('does not require a dynamic Organization Role for approved eligible resource scopes', async () => {
    const deps = createMockDeps({
      authorization: {
        findResourceByResourceUrl: vi.fn().mockImplementation(async (url: string) => {
          if (url === orgPrivateResource.resourceUrl) return orgPrivateResource
          return null
        }),
        findMemberByOrganizationUser: vi.fn().mockResolvedValue({
          id: 'mem_1',
          organizationId: 'org_1',
          userId: 'user_1',
          roles: [], // empty roles list
        }),
        findResource: vi.fn(),
        listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
      } as unknown as Deps['authorization'],
    })

    const scopes = await filterOAuthAccessTokenScopes(deps, {
      user: { id: 'user_1', role: 'user' },
      scopes: ['openid', 'users:read'],
      resource: orgPrivateResource.resourceUrl,
      referenceId: 'org_1',
    })

    expect(scopes).toEqual(['openid', 'users:read'])
    expect(deps.authorization.listOrganizationRoleScopes).not.toHaveBeenCalled()
  })

  it('filters organization-private resource scopes without active Organization context', async () => {
    const deps = createMockDeps({
      authorization: {
        findResourceByResourceUrl: vi.fn().mockImplementation(async (url: string) => {
          if (url === orgPrivateResource.resourceUrl) return orgPrivateResource
          return null
        }),
        findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
        findResource: vi.fn(),
        listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
      } as unknown as Deps['authorization'],
    })

    const scopes = await filterOAuthAccessTokenScopes(deps, {
      user: { id: 'user_non_member', role: 'user' },
      scopes: ['openid', 'users:read'],
      resource: orgPrivateResource.resourceUrl,
    })

    expect(scopes).toEqual(['openid'])
  })
})
