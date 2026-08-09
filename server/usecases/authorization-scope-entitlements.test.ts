import type { ResourceScopeEntitlementRecord } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'
import * as subject from './authorization'
import type { Deps } from './deps'

const now = new Date('2026-08-06T00:00:00.000Z')
const resource = {
  id: 'resource-1',
  enabled: true,
  visibility: 'public',
  ownerOrganizationId: 'org-1',
  scopeRegistry: {
    scopes: [
      { value: 'read', grantMode: 'assigned' },
      { value: 'auto', grantMode: 'automatic' },
    ],
  },
}

function entitlement(overrides: Partial<ResourceScopeEntitlementRecord> = {}): ResourceScopeEntitlementRecord {
  return {
    id: 'ent_1',
    userId: 'user-1',
    applicationId: null,
    agentIdentityId: null,
    organizationId: 'org-1',
    resourceServerId: resource.id,
    connectionId: null,
    authorizationDetails: [],
    authorizationContextHash: 'hash',
    scope: 'read',
    mode: 'persistent',
    grantedByUserId: 'admin',
    sourceAccessRequestId: null,
    expiresAt: null,
    endedAt: null,
    endReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function setup() {
  const authorization = {
    findResource: vi.fn().mockResolvedValue(resource),
    findMemberByOrganizationUser: vi.fn().mockResolvedValue({ id: 'member' }),
    createScopeEntitlement: vi.fn(async (record: ResourceScopeEntitlementRecord) => record),
    findScopeEntitlement: vi.fn().mockResolvedValue(entitlement()),
    listUserScopeEntitlements: vi.fn().mockResolvedValue({
      items: [entitlement()],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null },
    }),
    listApplicationScopeEntitlements: vi.fn().mockResolvedValue({
      items: [entitlement({ userId: null, applicationId: 'app-1' })],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null },
    }),
    endScopeEntitlement: vi.fn().mockResolvedValue(true),
  }
  const applications = {
    findById: vi
      .fn()
      .mockResolvedValue({ id: 'app-1', ownerOrganizationId: 'org-1', allowedGrantTypes: ['client_credentials'] }),
  }
  return {
    deps: { authorization, applications, users: { getUser: vi.fn() } } as unknown as Deps,
    authorization,
    applications,
  }
}

describe('direct scope Entitlements', () => {
  it('[spec: admin-console/admin-resource-scope-entitlements] creates exactly one persistent User scope', async () => {
    const { deps, authorization } = setup()
    const result = await subject.createUserScopeEntitlement(
      deps,
      'user-1',
      { organizationId: 'org-1', resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
      'admin',
    )

    expect(result).toMatchObject({ scope: 'read', mode: 'persistent', status: 'active' })
    expect(authorization.createScopeEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^ent_/),
        userId: 'user-1',
        applicationId: null,
        scope: 'read',
        expiresAt: null,
      }),
      expect.any(Date),
    )
  })

  it('creates one limited Application scope and exposes its independent lifetime', async () => {
    const { deps } = setup()
    const result = await subject.createApplicationScopeEntitlement(
      deps,
      'app-1',
      {
        resourceServerId: resource.id,
        scope: 'read',
        mode: 'until',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      'admin',
    )

    expect(result).toMatchObject({ applicationId: 'app-1', scope: 'read', mode: 'until' })
  })

  it('rejects automatic scopes and invalid lifetime combinations', async () => {
    const { deps } = setup()
    await expect(
      subject.createUserScopeEntitlement(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'auto', mode: 'persistent' },
        'admin',
      ),
    ).rejects.toThrow('assigned')
    await expect(
      subject.createUserScopeEntitlement(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'until' },
        'admin',
      ),
    ).rejects.toThrow('expiry')
    await expect(
      subject.createApplicationScopeEntitlement(
        deps,
        'app-1',
        {
          resourceServerId: resource.id,
          scope: 'read',
          mode: 'persistent',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        'admin',
      ),
    ).rejects.toThrow('cannot expire')
  })

  it('ends only the selected Entitlement', async () => {
    const { deps, authorization } = setup()
    await subject.revokeUserScopeEntitlement(deps, 'ent_1')
    expect(authorization.endScopeEntitlement).toHaveBeenCalledWith('ent_1', 'revoked', expect.any(Date))
  })
})
