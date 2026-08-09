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
      listActiveUserScopeEntitlements: vi.fn().mockResolvedValue([{ scope: 'direct' }, { scope: 'removed' }]),
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
      ),
    ).resolves.toEqual(['auto', 'direct', 'role'])
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
