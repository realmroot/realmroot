import type { Deps } from '@server/usecases/deps'
import type { ApplicationAggregate } from '@server/usecases/ports'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { describe, expect, it, vi } from 'vitest'
import { filterOAuthAccessTokenScopes } from './auth-helpers'

const resource: ApiResourceResponse = {
  id: 'res_orders',
  identifier: 'orders',
  name: 'Orders',
  resourceUrl: 'https://api.example.com/orders',
  connectorId: null,
  authorizationDetails: [],
  description: null,
  enabled: true,
  ownerOrganizationId: 'org_owner',
  visibility: 'public',
  scopeRegistry: {
    discovery: {
      sourceUrl: 'https://api.example.com/openapi.json',
      etag: null,
      documentHash: 'registry',
      syncedAt: '2026-08-01T00:00:00.000Z',
      lastError: null,
    },
    scopes: [
      { value: 'orders:read', description: null, grantMode: 'automatic' },
      { value: 'orders:admin', description: null, grantMode: 'assigned' },
    ],
  },
  availableToAgents: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

const application = {
  id: 'app_orders',
  disabled: false,
  trusted: false,
  ownerOrganizationId: 'org_client',
  oidcScopes: ['openid'],
  resourceScopes: [{ resourceServerId: resource.id, scopes: ['orders:admin', 'orders:read'] }],
} as ApplicationAggregate

function createDeps(input?: {
  memberships?: Array<{ organizationId: string; roles: string[] }>
  directScopes?: string[]
}) {
  return {
    applications: {
      findById: vi.fn().mockResolvedValue(application),
      findConsent: vi.fn().mockResolvedValue({
        id: 'consent_1',
        resourceServerId: resource.id,
        scopes: ['orders:admin', 'orders:read'],
        grantedAt: new Date(),
      }),
    },
    authorization: {
      findResourceByResourceUrl: vi.fn().mockResolvedValue(resource),
      listUserMemberships: vi.fn().mockResolvedValue(
        (input?.memberships ?? []).map((membership, index) => ({
          id: `mem_${index}`,
          userId: 'user_1',
          title: null,
          createdAt: '',
          updatedAt: '',
          ...membership,
        })),
      ),
      listActiveUserScopeGrants: vi
        .fn()
        .mockResolvedValue(
          input?.directScopes ? [{ id: 'grant_1', scopes: input.directScopes, expiresAt: null, revokedAt: null }] : [],
        ),
      listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
      findResource: vi.fn().mockResolvedValue(resource),
    },
  } as unknown as Deps
}

describe('filterOAuthAccessTokenScopes', () => {
  it('issues a consented automatic scope to any eligible authenticated user [spec: hosted-auth/resource-scope-consent-boundary]', async () => {
    await expect(
      filterOAuthAccessTokenScopes(createDeps(), {
        user: { id: 'user_1' },
        scopes: ['openid', 'orders:read'],
        resource: resource.resourceUrl,
        metadata: { applicationId: application.id },
      }),
    ).resolves.toEqual(['openid', 'orders:read'])
  })

  it('attenuates an assigned scope when the user has no direct grant or Role', async () => {
    await expect(
      filterOAuthAccessTokenScopes(createDeps(), {
        user: { id: 'user_1' },
        scopes: ['openid', 'orders:admin'],
        resource: resource.resourceUrl,
        metadata: { applicationId: application.id },
      }),
    ).resolves.toEqual(['openid'])
  })

  it('combines direct grants with effective scopes without treating public visibility as authority [spec: admin-console/admin-resource-scope-grants]', async () => {
    await expect(
      filterOAuthAccessTokenScopes(createDeps({ directScopes: ['orders:admin'] }), {
        user: { id: 'user_1' },
        scopes: ['openid', 'orders:admin', 'orders:read'],
        resource: resource.resourceUrl,
        metadata: { applicationId: application.id },
      }),
    ).resolves.toEqual(['openid', 'orders:admin', 'orders:read'])
  })

  it('rejects a private Resource Server target for a non-member', async () => {
    const privateResource = { ...resource, visibility: 'private' as const }
    const deps = createDeps({ directScopes: ['orders:admin'] })
    vi.mocked(deps.authorization.findResourceByResourceUrl).mockResolvedValue(privateResource)
    await expect(
      filterOAuthAccessTokenScopes(deps, {
        user: { id: 'user_1' },
        scopes: ['openid', 'orders:admin', 'orders:read'],
        resource: resource.resourceUrl,
        metadata: { applicationId: application.id },
      }),
    ).rejects.toMatchObject({ body: { error: 'invalid_target' } })
  })
})
