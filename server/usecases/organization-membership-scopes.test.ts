import { realmrootResourceServer } from '@server/domain/realmroot-resource-server'
import type { Deps } from '@server/usecases/deps'
import {
  filterCurrentResourceScopes,
  organizationUserHasScope,
  resolveOrganizationMembershipScopes,
} from '@server/usecases/organization-membership-scopes'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { describe, expect, it, vi } from 'vitest'

const externalResource: ApiResourceResponse = {
  id: 'resource-1',
  identifier: 'contacts',
  name: 'Contacts',
  resourceUrl: 'https://contacts.example.com',
  connectorId: null,
  authorizationDetails: [],
  description: null,
  enabled: true,
  ownerOrganizationId: 'org-1',
  visibility: 'private',
  scopeRegistry: {
    discovery: {
      sourceUrl: 'https://contacts.example.com/openapi.json',
      etag: null,
      documentHash: 'contacts-registry',
      syncedAt: '2026-08-05T00:00:00.000Z',
      lastError: null,
    },
    scopes: [{ value: 'contacts:read', description: 'Read contacts', grantMode: 'assigned' }],
  },
  availableToAgents: true,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
}

describe('Organization membership scope resolution', () => {
  it('unions predefined and dynamic Realmroot scopes through one resolver', async () => {
    const deps = dependencies()
    deps.authorization.listOrganizationRoleScopes = vi.fn().mockResolvedValue(
      new Map([
        [
          'operator',
          [
            { resourceId: realmrootResourceServer.id, scope: 'applications:write' },
            { resourceId: realmrootResourceServer.id, scope: 'removed:scope' },
          ],
        ],
      ]),
    )
    deps.authorization.findMemberByOrganizationUser = vi.fn().mockResolvedValue({ roles: ['member', 'operator'] })

    await expect(
      resolveOrganizationMembershipScopes(deps, 'org-1', ['member', 'operator'], realmrootResourceServer.id),
    ).resolves.toEqual(['applications:write', 'organizations:read', 'users:read'])
    await expect(organizationUserHasScope(deps, 'org-1', 'user-1', 'applications:write')).resolves.toBe(true)
  })

  it('keeps only scopes declared by the current external Resource Server contract', async () => {
    const deps = dependencies()
    deps.authorization.findResource = vi.fn().mockResolvedValue(externalResource)
    deps.authorization.listOrganizationRoleScopes = vi.fn().mockResolvedValue(
      new Map([
        [
          'contact-reader',
          [
            { resourceId: externalResource.id, scope: 'contacts:read' },
            { resourceId: externalResource.id, scope: 'contacts:removed' },
            { resourceId: 'another-resource', scope: 'contacts:read' },
          ],
        ],
      ]),
    )
    await expect(
      resolveOrganizationMembershipScopes(deps, 'org-1', ['contact-reader'], externalResource.id),
    ).resolves.toEqual(['contacts:read'])
  })

  it('returns no scopes for missing or inactive resources and allows public Role scopes', async () => {
    const deps = dependencies()
    const roleScopes = new Map([['contact-reader', [{ resourceId: externalResource.id, scope: 'contacts:read' }]]])
    deps.authorization.listOrganizationRoleScopes = vi.fn().mockResolvedValue(roleScopes)

    await expect(resolveOrganizationMembershipScopes(deps, 'org-1', ['member'], externalResource.id)).resolves.toEqual(
      [],
    )
    expect(deps.authorization.findResource).not.toHaveBeenCalled()

    deps.authorization.findResource = vi.fn().mockResolvedValue(null)
    await expect(
      resolveOrganizationMembershipScopes(deps, 'org-1', ['contact-reader'], externalResource.id),
    ).resolves.toEqual([])

    deps.authorization.findResource = vi.fn().mockResolvedValue({ ...externalResource, enabled: false })
    await expect(
      resolveOrganizationMembershipScopes(deps, 'org-1', ['contact-reader'], externalResource.id),
    ).resolves.toEqual([])

    deps.authorization.findResource = vi.fn().mockResolvedValue({
      ...externalResource,
      visibility: 'public',
    })
    await expect(
      resolveOrganizationMembershipScopes(deps, 'org-1', ['contact-reader'], externalResource.id),
    ).resolves.toEqual(['contacts:read'])
    expect(deps.externalHttp.fetch).not.toHaveBeenCalled()
  })

  it('denies a user without an Organization membership', async () => {
    const deps = dependencies()
    await expect(organizationUserHasScope(deps, 'org-1', 'user-1', 'organizations:read')).resolves.toBe(false)
  })

  it('filters direct internal Resource Server scopes without external discovery', async () => {
    const deps = dependencies()
    const internalResource: ApiResourceResponse = {
      ...externalResource,
      ...realmrootResourceServer,
      resourceUrl: 'https://auth.example.com/api',
      enabled: true,
      visibility: 'public',
    }

    expect(filterCurrentResourceScopes(internalResource, 'org-1', [])).toEqual([])
    expect(filterCurrentResourceScopes(internalResource, 'org-1', ['organizations:read', 'removed:scope'])).toEqual([
      'organizations:read',
    ])
    expect(deps.externalHttp.fetch).not.toHaveBeenCalled()
  })
})

function dependencies() {
  return {
    authorization: {
      findMemberByOrganizationUser: vi.fn().mockResolvedValue(null),
      findResource: vi.fn().mockResolvedValue(null),
      listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
    },
    externalHttp: { fetch: vi.fn() },
  } as unknown as Deps
}
