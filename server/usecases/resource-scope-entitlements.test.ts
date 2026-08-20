import type { Deps } from '@server/usecases/deps'
import type { ApplicationAggregate } from '@server/usecases/ports'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { describe, expect, it, vi } from 'vitest'
import { applicationEffectiveResourceScopes, userEffectiveResourceScopes } from './resource-scope-entitlements'

const now = new Date('2026-08-06T00:00:00.000Z')
const resource = {
  id: 'resource-1',
  enabled: true,
  visibility: 'public',
  ownerOrganizationId: 'org-1',
  scopeRegistry: {
    discovery: {
      sourceUrl: 'https://api.example/meta',
      etag: null,
      documentHash: 'x',
      syncedAt: now.toISOString(),
      lastError: null,
    },
    scopes: [
      { value: 'auto', description: null, grantMode: 'automatic' },
      { value: 'direct', description: null, grantMode: 'assigned' },
      { value: 'role', description: null, grantMode: 'assigned' },
    ],
  },
} as ApiResourceResponse

describe('effective Resource Server scopes', () => {
  it('combines current automatic, direct, and Role scopes', async () => {
    const authorization = {
      listUserMemberships: vi.fn().mockResolvedValue([{ organizationId: 'org-1', roles: ['operator'] }]),
      listActiveUserScopeEntitlements: vi.fn().mockResolvedValue([
        { scope: 'direct', organizationId: 'org-1' },
        { scope: 'removed', organizationId: 'org-1' },
      ]),
      listOrganizationRoleScopes: vi
        .fn()
        .mockResolvedValue(new Map([['operator', [{ resourceId: resource.id, scope: 'role' }]]])),
      findResource: vi.fn().mockResolvedValue(resource),
    }
    await expect(
      userEffectiveResourceScopes(
        { authorization } as unknown as Deps,
        'user-1',
        { ...resource, visibility: 'private' },
        now,
        'org-1',
      ),
    ).resolves.toEqual(['auto', 'direct', 'role'])
  })

  it('[spec: agent-identity/native-api-resource-access-request] isolates direct and Role scopes by selected Context', async () => {
    const contextualResource = {
      ...resource,
      scopeRegistry: {
        ...resource.scopeRegistry!,
        scopes: ['auto', 'user-direct', 'org-a-direct', 'org-b-direct', 'org-a-role', 'org-b-role'].map((value) => ({
          value,
          description: null,
          grantMode: value === 'auto' ? 'automatic' : 'assigned',
        })),
      },
    } as ApiResourceResponse
    const authorization = {
      listUserMemberships: vi.fn().mockResolvedValue([
        { organizationId: 'org-a', roles: ['role-a'] },
        { organizationId: 'org-b', roles: ['role-b'] },
      ]),
      listActiveUserScopeEntitlements: vi.fn().mockResolvedValue([
        { scope: 'user-direct', organizationId: null },
        { scope: 'org-a-direct', organizationId: 'org-a' },
        { scope: 'org-b-direct', organizationId: 'org-b' },
      ]),
      listOrganizationRoleScopes: vi
        .fn()
        .mockImplementation(async (organizationId: string) =>
          organizationId === 'org-a'
            ? new Map([['role-a', [{ resourceId: resource.id, scope: 'org-a-role' }]]])
            : new Map([['role-b', [{ resourceId: resource.id, scope: 'org-b-role' }]]]),
        ),
      findResource: vi.fn().mockResolvedValue(contextualResource),
    }
    const deps = { authorization } as unknown as Deps

    await expect(userEffectiveResourceScopes(deps, 'user-1', contextualResource, now, null)).resolves.toEqual([
      'auto',
      'user-direct',
    ])
    await expect(userEffectiveResourceScopes(deps, 'user-1', contextualResource, now, 'org-a')).resolves.toEqual([
      'auto',
      'org-a-direct',
      'org-a-role',
    ])
    await expect(userEffectiveResourceScopes(deps, 'user-1', contextualResource, now, 'org-b')).resolves.toEqual([
      'auto',
      'org-b-direct',
      'org-b-role',
    ])
  })

  it('uses only the Resource owner membership for an implicit private Resource Context', async () => {
    const authorization = {
      listUserMemberships: vi.fn().mockResolvedValue([
        { organizationId: 'org-1', roles: ['owner-role'] },
        { organizationId: 'org-2', roles: ['other-role'] },
      ]),
      listActiveUserScopeEntitlements: vi.fn().mockResolvedValue([]),
      listOrganizationRoleScopes: vi
        .fn()
        .mockImplementation(async (organizationId: string) =>
          organizationId === 'org-1'
            ? new Map([['owner-role', [{ resourceId: resource.id, scope: 'role' }]]])
            : new Map([['other-role', [{ resourceId: resource.id, scope: 'direct' }]]]),
        ),
      findResource: vi.fn().mockResolvedValue(resource),
    }

    await expect(
      userEffectiveResourceScopes(
        { authorization } as unknown as Deps,
        'user-1',
        { ...resource, visibility: 'private' },
        now,
      ),
    ).resolves.toEqual(['auto', 'role'])
    expect(authorization.listOrganizationRoleScopes).toHaveBeenCalledOnce()
    expect(authorization.listOrganizationRoleScopes).toHaveBeenCalledWith('org-1')
  })

  it('fails closed for invisible and empty registries', async () => {
    const authorization = {
      listUserMemberships: vi.fn().mockResolvedValue([]),
      listActiveUserScopeEntitlements: vi.fn().mockResolvedValue([{ scope: 'removed' }]),
    }
    const deps = { authorization } as unknown as Deps
    await expect(
      userEffectiveResourceScopes(deps, 'user-1', { ...resource, visibility: 'private' }, now),
    ).resolves.toEqual([])
    await expect(
      userEffectiveResourceScopes(deps, 'user-1', { ...resource, scopeRegistry: null }, now),
    ).resolves.toEqual([])
  })

  it('combines Application scopes only for visible owners', async () => {
    const authorization = {
      listActiveApplicationScopeEntitlements: vi.fn().mockResolvedValue([{ scope: 'direct' }, { scope: 'removed' }]),
    }
    const deps = { authorization } as unknown as Deps
    const app = { id: 'app-1', ownerOrganizationId: 'org-1' } as ApplicationAggregate
    await expect(applicationEffectiveResourceScopes(deps, app, resource, now)).resolves.toEqual(['auto', 'direct'])
    await expect(
      applicationEffectiveResourceScopes(
        deps,
        { ...app, ownerOrganizationId: 'other' },
        { ...resource, visibility: 'private' },
        now,
      ),
    ).resolves.toEqual([])
  })
})
