import type { ResourceScopeEntitlementRecord } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'
import * as subject from './authorization'
import type { Deps } from './deps'

const now = new Date('2026-08-06T00:00:00.000Z')
const adminActor = { controllerUserId: 'admin', agent: null }
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
    grantedByAgentIdentityId: null,
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
    listUserPermissions: vi.fn().mockResolvedValue({
      items: [entitlement()],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null },
    }),
    listApplicationPermissions: vi.fn().mockResolvedValue({
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
  it('[spec: admin-console/admin-resource-permissions] creates exactly one persistent User scope', async () => {
    const { deps, authorization } = setup()
    const result = await subject.createUserPermission(
      deps,
      'user-1',
      { organizationId: 'org-1', resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
      adminActor,
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
    const result = await subject.createApplicationPermission(
      deps,
      'app-1',
      {
        resourceServerId: resource.id,
        scope: 'read',
        mode: 'until',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      adminActor,
    )

    expect(result).toMatchObject({ applicationId: 'app-1', scope: 'read', mode: 'until' })
  })

  it('records a delegated Agent as the Application Permission grantor', async () => {
    const { deps, authorization } = setup()
    const agentActor = {
      controllerUserId: null,
      agent: {
        issuer: 'https://agent.example.com',
        subject: 'agent-subject',
        identityId: 'agent-admin',
        hostId: 'host-1',
      },
    }

    const result = await subject.createApplicationPermission(
      deps,
      'app-1',
      { resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
      agentActor,
    )

    expect(result.grantedBy).toEqual({ type: 'agent', id: 'agent-admin' })
    expect(authorization.createScopeEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ grantedByUserId: null, grantedByAgentIdentityId: 'agent-admin' }),
      expect.any(Date),
    )
  })

  it('rejects automatic scopes and invalid lifetime combinations', async () => {
    const { deps, authorization } = setup()
    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'auto', mode: 'persistent' },
        adminActor,
      ),
    ).rejects.toThrow('assigned')
    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'until' },
        adminActor,
      ),
    ).rejects.toThrow('expiry')
    await expect(
      subject.createApplicationPermission(
        deps,
        'app-1',
        {
          resourceServerId: resource.id,
          scope: 'read',
          mode: 'persistent',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        adminActor,
      ),
    ).rejects.toThrow('cannot expire')
    vi.mocked(authorization.findResource).mockResolvedValueOnce({ ...resource, scopeRegistry: null })
    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).rejects.toThrow('assigned')
  })

  it('ends only the selected Entitlement', async () => {
    const { deps, authorization } = setup()
    await subject.revokeUserPermission(deps, 'ent_1')
    expect(authorization.endScopeEntitlement).toHaveBeenCalledWith('ent_1', 'revoked', expect.any(Date))
  })

  it('lists, reads, and revokes User and Application Entitlements', async () => {
    const { deps, authorization } = setup()

    await expect(subject.listUserPermissions(deps, 'user-1', { limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'ent_1', status: 'active' })],
    })
    vi.mocked(authorization.findScopeEntitlement).mockResolvedValue(
      entitlement({ userId: null, applicationId: 'app-1', endedAt: now, endReason: 'revoked' }),
    )
    await expect(subject.getApplicationPermission(deps, 'ent_1')).resolves.toMatchObject({
      applicationId: 'app-1',
      status: 'ended',
      endReason: 'revoked',
    })
    await expect(subject.listApplicationPermissions(deps, 'app-1', { limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [expect.objectContaining({ applicationId: 'app-1' })],
    })
    await subject.revokeApplicationPermission(deps, 'ent_1')
    expect(authorization.endScopeEntitlement).toHaveBeenLastCalledWith('ent_1', 'revoked', expect.any(Date))

    vi.mocked(authorization.endScopeEntitlement).mockResolvedValue(false)
    await expect(subject.revokeApplicationPermission(deps, 'ent_1')).rejects.toThrow('already ended')
    vi.mocked(authorization.findScopeEntitlement).mockResolvedValue(null)
    await expect(subject.getUserPermission(deps, 'missing')).rejects.toThrow('not found')
    await expect(subject.getApplicationPermission(deps, 'missing')).rejects.toThrow('not found')
  })

  it('enforces Resource visibility, subject, and lifetime boundaries', async () => {
    const { deps, authorization, applications } = setup()
    vi.mocked(authorization.findResource).mockResolvedValueOnce({ ...resource, enabled: false })
    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).rejects.toThrow('active')

    vi.mocked(authorization.findResource).mockResolvedValue({ ...resource, visibility: 'private' })
    vi.mocked(authorization.findMemberByOrganizationUser).mockResolvedValueOnce(null)
    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).rejects.toThrow('owner Organization member')
    vi.mocked(authorization.findMemberByOrganizationUser).mockResolvedValueOnce({ id: 'member' })
    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).resolves.toMatchObject({ scope: 'read' })

    vi.mocked(authorization.findResource).mockResolvedValue(resource)
    vi.mocked(authorization.findMemberByOrganizationUser).mockResolvedValueOnce(null)
    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { organizationId: 'org-2', resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).rejects.toThrow('contain the target user')
    vi.mocked(authorization.findResource).mockResolvedValueOnce({
      ...resource,
      visibility: 'private',
      ownerOrganizationId: 'org-1',
    })
    vi.mocked(authorization.findMemberByOrganizationUser).mockResolvedValue({ id: 'member' })
    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { organizationId: 'org-2', resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).rejects.toThrow('not visible')
    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'until', expiresAt: '2020-01-01T00:00:00.000Z' },
        adminActor,
      ),
    ).rejects.toThrow('future')

    await expect(
      subject.createUserPermission(
        deps,
        'user-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).resolves.toMatchObject({ organizationId: null })
    vi.mocked(authorization.endScopeEntitlement).mockResolvedValue(false)
    await expect(subject.revokeUserPermission(deps, 'ent_1')).rejects.toThrow('already ended')

    vi.mocked(applications.findById).mockResolvedValueOnce(null)
    await expect(
      subject.createApplicationPermission(
        deps,
        'missing',
        { resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).rejects.toThrow('not found')
    vi.mocked(applications.findById).mockResolvedValueOnce({
      id: 'app-1',
      ownerOrganizationId: 'org-1',
      allowedGrantTypes: ['authorization_code'],
    })
    await expect(
      subject.createApplicationPermission(
        deps,
        'app-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).rejects.toThrow('machine-principal')

    vi.mocked(applications.findById).mockResolvedValue({
      id: 'app-1',
      ownerOrganizationId: 'org-1',
      allowedGrantTypes: ['client_credentials'],
    })
    vi.mocked(authorization.findResource).mockResolvedValueOnce({
      ...resource,
      visibility: 'private',
      ownerOrganizationId: 'org-2',
    })
    await expect(
      subject.createApplicationPermission(
        deps,
        'app-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'persistent' },
        adminActor,
      ),
    ).rejects.toThrow('not visible')
    await expect(
      subject.createApplicationPermission(
        deps,
        'app-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'until' },
        adminActor,
      ),
    ).rejects.toThrow('expiry')
    await expect(
      subject.createApplicationPermission(
        deps,
        'app-1',
        { resourceServerId: resource.id, scope: 'read', mode: 'until', expiresAt: '2020-01-01T00:00:00.000Z' },
        adminActor,
      ),
    ).rejects.toThrow('future')

    vi.mocked(authorization.findScopeEntitlement).mockResolvedValue(
      entitlement({
        userId: null,
        applicationId: 'app-1',
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      }),
    )
    await expect(subject.getApplicationPermission(deps, 'ent_1')).resolves.toMatchObject({
      status: 'ended',
      endReason: 'expired',
    })
  })
})
