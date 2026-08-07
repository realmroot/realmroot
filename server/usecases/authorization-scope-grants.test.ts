import { describe, expect, it, vi } from 'vitest'
import * as subject from './authorization'
import type { Deps } from './deps'

const now = new Date('2026-08-06T00:00:00.000Z')
const pagination = { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null }
const resource: any = {
  id: 'resource-1',
  enabled: true,
  archivedAt: null,
  visibility: 'public',
  ownerOrganizationId: 'org-1',
  scopeRegistry: {
    scopes: [
      { value: 'read', grantMode: 'assigned' },
      { value: 'auto', grantMode: 'automatic' },
    ],
  },
}

function setup() {
  const userGrant: any = {
    id: 'usg-1',
    userId: 'user-1',
    organizationId: 'org-1',
    resourceServerId: resource.id,
    scopes: ['read'],
    grantedByUserId: 'admin',
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
  }
  const appGrant: any = {
    id: 'asg-1',
    applicationId: 'app-1',
    resourceServerId: resource.id,
    scopes: ['read'],
    grantedByUserId: 'admin',
    expiresAt: new Date('2020-01-01'),
    revokedAt: null,
    createdAt: now,
  }
  const authorization: any = {
    findResource: vi.fn().mockResolvedValue(resource),
    findMemberByOrganizationUser: vi.fn().mockResolvedValue({ id: 'member' }),
    createUserScopeGrant: vi.fn().mockResolvedValue(userGrant),
    findUserScopeGrant: vi.fn().mockResolvedValue(userGrant),
    listUserScopeGrants: vi.fn().mockResolvedValue({ items: [userGrant], pagination }),
    revokeUserScopeGrant: vi.fn().mockResolvedValue(true),
    createApplicationScopeGrant: vi.fn().mockResolvedValue(appGrant),
    findApplicationScopeGrant: vi.fn().mockResolvedValue(appGrant),
    listApplicationScopeGrants: vi.fn().mockResolvedValue({ items: [appGrant], pagination }),
    revokeApplicationScopeGrant: vi.fn().mockResolvedValue(true),
  }
  const applications: any = {
    findById: vi
      .fn()
      .mockResolvedValue({ id: 'app-1', ownerOrganizationId: 'org-1', allowedGrantTypes: ['client_credentials'] }),
  }
  return {
    deps: { authorization, applications, users: { getUser: vi.fn() } } as unknown as Deps,
    authorization,
    applications,
    userGrant,
    appGrant,
  }
}

describe('direct scope grants', () => {
  it('manages user grants', async () => {
    const { deps, authorization, userGrant } = setup()
    await expect(
      subject.createUserScopeGrant(
        deps,
        'user-1',
        {
          organizationId: 'org-1',
          resourceServerId: resource.id,
          scopes: ['read', 'read'],
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        'admin',
      ),
    ).resolves.toMatchObject({ status: 'active' })
    await expect(subject.getUserScopeGrant(deps, 'usg-1')).resolves.toBeDefined()
    await expect(subject.listUserScopeGrants(deps, 'user-1', { limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'usg-1' }],
    })
    await subject.revokeUserScopeGrant(deps, 'usg-1')
    authorization.findUserScopeGrant.mockResolvedValueOnce({ ...userGrant, expiresAt: new Date('2020-01-01') })
    await expect(subject.getUserScopeGrant(deps, 'old')).resolves.toMatchObject({ status: 'expired' })
  })

  it('manages Application grants', async () => {
    const { deps, authorization, appGrant } = setup()
    await expect(
      subject.createApplicationScopeGrant(
        deps,
        'app-1',
        { resourceServerId: resource.id, scopes: ['read'], expiresAt: null },
        'admin',
      ),
    ).resolves.toMatchObject({ status: 'expired' })
    await expect(subject.getApplicationScopeGrant(deps, 'asg-1')).resolves.toBeDefined()
    await expect(subject.listApplicationScopeGrants(deps, 'app-1', { limit: 20, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'asg-1' }],
    })
    await subject.revokeApplicationScopeGrant(deps, 'asg-1')
    authorization.findApplicationScopeGrant.mockResolvedValueOnce({ ...appGrant, expiresAt: null })
    await expect(subject.getApplicationScopeGrant(deps, 'active')).resolves.toMatchObject({ status: 'active' })
  })

  it('rejects invalid targets, scopes, expiry, and revocation state', async () => {
    const { deps, authorization, applications, userGrant } = setup()
    authorization.findResource.mockResolvedValueOnce({ ...resource, enabled: false })
    await expect(
      subject.createUserScopeGrant(
        deps,
        'user-1',
        { organizationId: null, resourceServerId: resource.id, scopes: ['read'], expiresAt: null },
        'admin',
      ),
    ).rejects.toThrow('active')
    await expect(
      subject.createUserScopeGrant(
        deps,
        'user-1',
        { organizationId: null, resourceServerId: resource.id, scopes: ['auto'], expiresAt: null },
        'admin',
      ),
    ).rejects.toThrow('assigned')
    authorization.findResource.mockResolvedValueOnce({ ...resource, visibility: 'private' })
    authorization.findMemberByOrganizationUser.mockResolvedValueOnce(null)
    await expect(
      subject.createUserScopeGrant(
        deps,
        'user-1',
        { organizationId: null, resourceServerId: resource.id, scopes: ['read'], expiresAt: null },
        'admin',
      ),
    ).rejects.toThrow('owner Organization')
    authorization.findMemberByOrganizationUser.mockResolvedValueOnce(null)
    await expect(
      subject.createUserScopeGrant(
        deps,
        'user-1',
        { organizationId: 'other', resourceServerId: resource.id, scopes: ['read'], expiresAt: null },
        'admin',
      ),
    ).rejects.toThrow('target user')
    authorization.findResource.mockResolvedValueOnce({
      ...resource,
      visibility: 'private',
      ownerOrganizationId: 'another-org',
    })
    await expect(
      subject.createUserScopeGrant(
        deps,
        'user-1',
        { organizationId: 'org-1', resourceServerId: resource.id, scopes: ['read'], expiresAt: null },
        'admin',
      ),
    ).rejects.toThrow('not visible')
    await expect(
      subject.createUserScopeGrant(
        deps,
        'user-1',
        {
          organizationId: null,
          resourceServerId: resource.id,
          scopes: ['read'],
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
        'admin',
      ),
    ).rejects.toThrow('future')
    authorization.findResource.mockResolvedValueOnce({ ...resource, scopeRegistry: null })
    await expect(
      subject.createUserScopeGrant(
        deps,
        'user-1',
        { organizationId: null, resourceServerId: resource.id, scopes: ['read'], expiresAt: null },
        'admin',
      ),
    ).rejects.toThrow('assigned')
    applications.findById.mockResolvedValueOnce(null)
    await expect(
      subject.createApplicationScopeGrant(
        deps,
        'missing',
        { resourceServerId: resource.id, scopes: ['read'], expiresAt: null },
        'admin',
      ),
    ).rejects.toThrow('not found')
    applications.findById.mockResolvedValueOnce({ id: 'app-1', ownerOrganizationId: 'org-1', allowedGrantTypes: [] })
    await expect(
      subject.createApplicationScopeGrant(
        deps,
        'app-1',
        { resourceServerId: resource.id, scopes: ['read'], expiresAt: null },
        'admin',
      ),
    ).rejects.toThrow('machine-principal')
    applications.findById.mockResolvedValueOnce({
      id: 'app-1',
      ownerOrganizationId: 'other',
      allowedGrantTypes: ['urn:ietf:params:oauth:grant-type:token-exchange'],
    })
    authorization.findResource.mockResolvedValueOnce({ ...resource, visibility: 'private' })
    await expect(
      subject.createApplicationScopeGrant(
        deps,
        'app-1',
        { resourceServerId: resource.id, scopes: ['read'], expiresAt: null },
        'admin',
      ),
    ).rejects.toThrow('not visible')
    applications.findById.mockResolvedValueOnce({
      id: 'app-1',
      ownerOrganizationId: 'org-1',
      allowedGrantTypes: ['urn:ietf:params:oauth:grant-type:token-exchange'],
    })
    await expect(
      subject.createApplicationScopeGrant(
        deps,
        'app-1',
        { resourceServerId: resource.id, scopes: ['read'], expiresAt: '2020-01-01T00:00:00.000Z' },
        'admin',
      ),
    ).rejects.toThrow('future')
    authorization.findUserScopeGrant.mockResolvedValueOnce(null)
    await expect(subject.getUserScopeGrant(deps, 'missing')).rejects.toThrow('not found')
    authorization.findApplicationScopeGrant.mockResolvedValueOnce({ ...userGrant, revokedAt: now })
    await expect(subject.getApplicationScopeGrant(deps, 'revoked')).rejects.toThrow('not found')
    authorization.revokeUserScopeGrant.mockResolvedValueOnce(false)
    await expect(subject.revokeUserScopeGrant(deps, 'usg-1')).rejects.toThrow('already revoked')
    authorization.revokeApplicationScopeGrant.mockResolvedValueOnce(false)
    await expect(subject.revokeApplicationScopeGrant(deps, 'asg-1')).rejects.toThrow('already revoked')
  })
})
