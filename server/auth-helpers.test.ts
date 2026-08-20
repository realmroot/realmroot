import type { Deps } from '@server/usecases/deps'
import type { ApplicationAggregate } from '@server/usecases/ports'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { describe, expect, it, vi } from 'vitest'
import { applicationUserHasAccess, filterOAuthAccessTokenScopes } from './auth-helpers'

const resource: ApiResourceResponse = {
  id: 'res_orders',
  identifier: 'orders',
  name: 'Orders',
  resourceUrl: 'https://api.example.com/orders',
  authorizationModel: 'native',
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
  consentRequired: true,
  ownerOrganizationId: 'org_client',
  visibility: 'public',
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
        authorizationSource: 'user_consent',
        grantedAt: new Date(),
      }),
      recordPolicyAuthorization: vi.fn(),
    },
    authorization: {
      findOrganization: vi.fn().mockImplementation(async (id: string) => ({ id, disabled: false })),
      findMemberByOrganizationUser: vi
        .fn()
        .mockImplementation(async (organizationId: string) =>
          (input?.memberships ?? []).some((membership) => membership.organizationId === organizationId)
            ? { id: `mem_${organizationId}` }
            : null,
        ),
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
      listActiveUserScopeEntitlements: vi
        .fn()
        .mockResolvedValue(
          input?.directScopes
            ? input.directScopes.map((scope) => ({ id: `ent_${scope}`, scope, organizationId: null }))
            : [],
        ),
      listOrganizationRoleScopes: vi.fn().mockResolvedValue(new Map()),
      findResource: vi.fn().mockResolvedValue(resource),
    },
  } as unknown as Deps
}

describe('filterOAuthAccessTokenScopes', () => {
  it('rejects public Applications owned by a disabled Organization', async () => {
    const deps = {
      authorization: {
        findOrganization: vi.fn().mockResolvedValue({ id: 'org_client', disabled: true }),
        findMemberByOrganizationUser: vi.fn(),
      },
    } as unknown as Deps

    await expect(applicationUserHasAccess(deps, { ...application, visibility: 'public' }, 'user_1')).resolves.toBe(
      false,
    )
    expect(deps.authorization.findMemberByOrganizationUser).not.toHaveBeenCalled()
  })

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

  it('downscopes an interactive multi-resource grant to the selected resource [spec: hosted-auth/oauth-multi-resource-grant]', async () => {
    await expect(
      filterOAuthAccessTokenScopes(createDeps(), {
        user: { id: 'user_1' },
        scopes: ['openid', 'orders:read', 'contacts:read'],
        resource: resource.resourceUrl,
        metadata: { applicationId: application.id },
        grantType: 'authorization_code',
      }),
    ).resolves.toEqual(['openid', 'orders:read'])
  })

  it('combines direct Permissions with effective scopes without treating public visibility as authority [spec: admin-console/admin-resource-permissions]', async () => {
    await expect(
      filterOAuthAccessTokenScopes(createDeps({ directScopes: ['orders:admin'] }), {
        user: { id: 'user_1' },
        scopes: ['openid', 'orders:admin', 'orders:read'],
        resource: resource.resourceUrl,
        metadata: { applicationId: application.id },
      }),
    ).resolves.toEqual(['openid', 'orders:admin', 'orders:read'])
  })

  it('keeps User and Organization Context scope authorization isolated', async () => {
    const deps = createDeps({ memberships: [{ organizationId: 'org-a', roles: [] }] })
    vi.mocked(deps.authorization.listActiveUserScopeEntitlements).mockResolvedValue([
      { id: 'ent-user', scope: 'orders:admin', organizationId: null },
      { id: 'ent-org', scope: 'orders:read', organizationId: 'org-a' },
    ] as never)
    const input = {
      user: { id: 'user_1' },
      scopes: ['openid', 'orders:admin', 'orders:read'],
      resource: resource.resourceUrl,
      metadata: { applicationId: application.id },
      grantType: 'authorization_code',
    }

    await expect(filterOAuthAccessTokenScopes(deps, { ...input, referenceId: 'user:user_1' })).resolves.toEqual([
      'openid',
      'orders:admin',
      'orders:read',
    ])
    await expect(filterOAuthAccessTokenScopes(deps, { ...input, referenceId: 'organization:org-a' })).resolves.toEqual([
      'openid',
      'orders:read',
    ])
  })

  it('fails closed for stale Organization Contexts in authorization-code and refresh grants', async () => {
    const deps = createDeps({ memberships: [{ organizationId: 'org-a', roles: [] }] })
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue(null)
    const input = {
      user: { id: 'user_1' },
      scopes: ['openid', 'orders:read'],
      resource: resource.resourceUrl,
      referenceId: 'organization:org-a',
      metadata: { applicationId: application.id },
    }

    await expect(
      filterOAuthAccessTokenScopes(deps, { ...input, grantType: 'authorization_code' }),
    ).rejects.toMatchObject({ body: { error: 'access_denied' } })
    await expect(filterOAuthAccessTokenScopes(deps, { ...input, grantType: 'refresh_token' })).rejects.toMatchObject({
      body: { error: 'invalid_grant' },
    })

    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ id: 'member-a' } as never)
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({ id: 'org-a', disabled: true } as never)
    await expect(
      filterOAuthAccessTokenScopes(deps, { ...input, grantType: 'authorization_code' }),
    ).rejects.toMatchObject({ body: { error: 'access_denied' } })
    await expect(filterOAuthAccessTokenScopes(deps, { ...input, grantType: 'refresh_token' })).rejects.toMatchObject({
      body: { error: 'invalid_grant' },
    })
  })

  it('revalidates private Application owner membership for authorization-code and refresh grants', async () => {
    const deps = createDeps()
    vi.mocked(deps.applications.findById).mockResolvedValue({ ...application, visibility: 'private' })
    const input = {
      user: { id: 'user_1' },
      scopes: ['openid'],
      metadata: { applicationId: application.id },
    }

    await expect(
      filterOAuthAccessTokenScopes(deps, { ...input, grantType: 'authorization_code' }),
    ).rejects.toMatchObject({ body: { error: 'access_denied' } })
    await expect(filterOAuthAccessTokenScopes(deps, { ...input, grantType: 'refresh_token' })).rejects.toMatchObject({
      body: { error: 'invalid_grant' },
    })
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
    ).rejects.toMatchObject({ body: { error: 'access_denied' } })
  })

  it('rejects a private Resource Server owned by a disabled Organization', async () => {
    const privateResource = { ...resource, visibility: 'private' as const }
    const deps = createDeps({ memberships: [{ organizationId: 'org_owner', roles: [] }] })
    vi.mocked(deps.authorization.findResourceByResourceUrl).mockResolvedValue(privateResource)
    vi.mocked(deps.authorization.findOrganization).mockImplementation(async (id) => ({
      id,
      slug: id,
      name: id,
      displayName: null,
      logo: null,
      disabled: id === 'org_owner',
      disabledReason: id === 'org_owner' ? 'suspended' : null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }))

    await expect(
      filterOAuthAccessTokenScopes(deps, {
        user: { id: 'user_1' },
        scopes: ['openid', 'orders:read'],
        resource: resource.resourceUrl,
        metadata: { applicationId: application.id },
      }),
    ).rejects.toMatchObject({ body: { error: 'access_denied' } })
  })
})
