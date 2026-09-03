import { describe, expect, it, vi } from 'vitest'
import { createApplication, createConsent, loadConsentRequest, updateApplication } from './applications'
import type { Deps } from './deps'
import { createIdentifierGeneratorFake } from './identifier-generator.fake'
import type { ApplicationAggregate } from './ports'

const now = new Date('2026-08-06T00:00:00.000Z')
const resource = {
  id: 'resource-1',
  resourceUrl: 'https://api.example.com',
  enabled: true,
  archivedAt: null,
  visibility: 'private',
  ownerOrganizationId: 'org-1',
  scopeRegistry: { scopes: [{ value: 'items:read', description: null, grantMode: 'assigned' }] },
}
const targetResource = {
  ...resource,
  id: 'resource-2',
  resourceUrl: 'https://target.example.com',
  scopeRegistry: { scopes: [{ value: 'agents:create', description: null, grantMode: 'assigned' }] },
}
const tokenExchangePolicy = {
  sourceResourceServerId: resource.id,
  targetResourceServerId: targetResource.id,
  scopeMappings: [{ sourceScope: 'items:read', targetScope: 'agents:create' }],
}
const oidcApplication = {
  id: 'oidc-application',
  clientId: 'oidc-client',
  clientType: 'confidential_web',
  visibility: 'private',
  disabled: false,
  ownerOrganizationId: 'org-1',
  oidcScopes: ['openid', 'profile', 'email', 'groups', 'offline_access'],
}

function setup() {
  let application: ApplicationAggregate | undefined
  const applications = {
    create: vi.fn(async ({ application: input }) => (application = { ...input, createdAt: now, updatedAt: now })),
    listSecrets: vi.fn().mockResolvedValue({ items: [], pagination: {} }),
    findById: vi.fn(async (id) =>
      id === oidcApplication.id ? (oidcApplication as ApplicationAggregate) : application,
    ),
    findByClientId: vi.fn(async () => application),
    update: vi.fn(async (_id, patch) => {
      if (!application) throw new Error('Application fixture was not created.')
      Object.assign(application, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)))
      return 'updated' as const
    }),
    findConsent: vi.fn().mockResolvedValue(null),
    createConsent: vi.fn(async (input) => ({
      id: 'consent-1',
      resourceServerId: input.resourceServerId,
      scopes: input.scopes,
      grantedAt: now,
    })),
  }
  const authorization = {
    findOrganization: vi.fn().mockResolvedValue({ id: 'org-1', disabled: false }),
    listOrganizations: vi.fn().mockResolvedValue({
      items: [{ id: 'org-platform', slug: 'realmroot' }],
      pagination: { page: Math.floor(0 / 100) + 1, pageSize: 100, totalItems: 1, totalPages: Math.ceil(1 / 100) },
    }),
    findResources: vi
      .fn()
      .mockImplementation(async (ids: string[]) => [resource, targetResource].filter((item) => ids.includes(item.id))),
    findResource: vi.fn().mockResolvedValue(resource),
    findResourceByResourceUrl: vi.fn().mockResolvedValue(resource),
    findMemberByOrganizationUser: vi.fn().mockResolvedValue({ id: 'member-1' }),
    listUserMemberships: vi.fn().mockResolvedValue([{ organizationId: 'org-1' }]),
  }
  return {
    deps: { ids: createIdentifierGeneratorFake(), applications, authorization } as unknown as Deps,
    authorization,
  }
}

const input = {
  name: 'Scoped App',
  clientType: 'public_spa' as const,
  redirectUris: ['https://app.example/callback'],
  ownerOrganizationId: 'org-1',
  resourceScopes: [{ resourceServerId: resource.id, scopes: ['items:read'] }],
}

describe('Application Resource Server scopes', () => {
  it('validates create and update allowlists', async () => {
    const { deps, authorization } = setup()
    const created = await createApplication(deps, 'https://auth.example', input, 'admin-1')
    await expect(
      updateApplication(deps, 'https://auth.example', created.id, { resourceScopes: input.resourceScopes }),
    ).resolves.toBeDefined()
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        { ...input, resourceScopes: [...input.resourceScopes, ...input.resourceScopes] },
        'admin-1',
      ),
    ).rejects.toThrow('only once')
    authorization.findResources.mockResolvedValueOnce([])
    await expect(createApplication(deps, 'https://auth.example', input, 'admin-1')).rejects.toThrow('not active')
    authorization.findResources.mockResolvedValueOnce([{ ...resource, ownerOrganizationId: 'other' }])
    await expect(createApplication(deps, 'https://auth.example', input, 'admin-1')).rejects.toThrow('not visible')
    authorization.findResources.mockResolvedValueOnce([resource])
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        { ...input, resourceScopes: [{ resourceServerId: resource.id, scopes: ['unknown'] }] },
        'admin-1',
      ),
    ).rejects.toThrow('undeclared')
  })

  it('allows only confidential token-exchange clients to configure unique, active, tenant-visible sources', async () => {
    const { deps, authorization } = setup()
    const confidentialInput = {
      ...input,
      clientType: 'confidential_web' as const,
      resourceScopes: [{ resourceServerId: targetResource.id, scopes: ['agents:create'] }],
      tokenExchangePolicies: [tokenExchangePolicy],
    }

    await expect(createApplication(deps, 'https://auth.example', confidentialInput, 'admin-1')).resolves.toMatchObject({
      allowedGrantTypes: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
      tokenExchangePolicies: [tokenExchangePolicy],
    })
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        { ...confidentialInput, clientType: 'machine', redirectUris: [] },
        'admin-1',
      ),
    ).resolves.toMatchObject({ tokenExchangePolicies: [tokenExchangePolicy] })
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        { ...confidentialInput, tokenExchangePolicies: [tokenExchangePolicy, tokenExchangePolicy] },
        'admin-1',
      ),
    ).rejects.toThrow('pair must appear only once')
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        {
          ...confidentialInput,
          tokenExchangePolicies: [
            {
              ...tokenExchangePolicy,
              scopeMappings: [...tokenExchangePolicy.scopeMappings, ...tokenExchangePolicy.scopeMappings],
            },
          ],
        },
        'admin-1',
      ),
    ).rejects.toThrow('scope mappings must be unique')
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        {
          ...confidentialInput,
          tokenExchangePolicies: [
            { ...tokenExchangePolicy, scopeMappings: [{ sourceScope: 'unknown', targetScope: 'agents:create' }] },
          ],
        },
        'admin-1',
      ),
    ).rejects.toThrow('undeclared source')
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        {
          ...confidentialInput,
          tokenExchangePolicies: [
            { ...tokenExchangePolicy, scopeMappings: [{ sourceScope: 'items:read', targetScope: 'unknown' }] },
          ],
        },
        'admin-1',
      ),
    ).rejects.toThrow('undeclared target')
    await expect(
      createApplication(deps, 'https://auth.example', { ...confidentialInput, resourceScopes: [] }, 'admin-1'),
    ).rejects.toThrow('target scopes must be configured')
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        {
          ...input,
          resourceScopes: confidentialInput.resourceScopes,
          tokenExchangePolicies: [tokenExchangePolicy],
        },
        'admin-1',
      ),
    ).rejects.toThrow('Only confidential Applications')

    authorization.findResources.mockResolvedValueOnce([targetResource]).mockResolvedValueOnce([targetResource])
    await expect(createApplication(deps, 'https://auth.example', confidentialInput, 'admin-1')).rejects.toThrow(
      'must be active',
    )
    authorization.findResources
      .mockResolvedValueOnce([targetResource])
      .mockResolvedValueOnce([{ ...resource, enabled: false }, targetResource])
    await expect(createApplication(deps, 'https://auth.example', confidentialInput, 'admin-1')).rejects.toThrow(
      'must be active',
    )
    authorization.findResources
      .mockResolvedValueOnce([targetResource])
      .mockResolvedValueOnce([{ ...resource, ownerOrganizationId: 'org-2' }, targetResource])
    await expect(createApplication(deps, 'https://auth.example', confidentialInput, 'admin-1')).rejects.toThrow(
      'must be visible',
    )
  })

  it('reuses token exchange policies for a same-Organization OIDC Application target', async () => {
    const { deps } = setup()
    const identityPolicy = {
      sourceResourceServerId: resource.id,
      targetApplicationId: oidcApplication.id,
    }
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        {
          ...input,
          clientType: 'machine',
          redirectUris: [],
          tokenExchangePolicies: [identityPolicy],
        },
        'admin-1',
      ),
    ).resolves.toMatchObject({ tokenExchangePolicies: [identityPolicy] })

    vi.mocked(deps.applications.findById).mockResolvedValueOnce({
      ...oidcApplication,
      ownerOrganizationId: 'org-2',
    } as ApplicationAggregate)
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        {
          ...input,
          clientType: 'machine',
          redirectUris: [],
          tokenExchangePolicies: [identityPolicy],
        },
        'admin-1',
      ),
    ).rejects.toThrow('active private OIDC Application in the same Organization')

    vi.mocked(deps.applications.findById).mockResolvedValueOnce(null)
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        {
          ...input,
          clientType: 'machine',
          redirectUris: [],
          tokenExchangePolicies: [identityPolicy],
        },
        'admin-1',
      ),
    ).rejects.toThrow('active private OIDC Application in the same Organization')
  })

  it('enables token exchange when an existing confidential web Application adds a source policy', async () => {
    const { deps } = setup()
    const created = await createApplication(
      deps,
      'https://auth.example',
      {
        ...input,
        clientType: 'confidential_web',
        resourceScopes: [{ resourceServerId: targetResource.id, scopes: ['agents:create'] }],
      },
      'admin-1',
    )
    const existing = await deps.applications.findById(created.id)
    if (!existing) throw new Error('Application fixture was not created.')
    existing.allowedGrantTypes = ['authorization_code', 'refresh_token']

    await expect(
      updateApplication(deps, 'https://auth.example', created.id, {
        tokenExchangePolicies: [tokenExchangePolicy],
      }),
    ).resolves.toMatchObject({
      allowedGrantTypes: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
      tokenExchangePolicies: [tokenExchangePolicy],
    })

    await expect(
      updateApplication(deps, 'https://auth.example', created.id, { tokenExchangePolicies: [] }),
    ).resolves.toMatchObject({
      allowedGrantTypes: ['authorization_code', 'refresh_token'],
      tokenExchangePolicies: [],
    })

    await expect(
      updateApplication(deps, 'https://auth.example', created.id, { name: 'Renamed web app' }),
    ).resolves.toMatchObject({
      name: 'Renamed web app',
      tokenExchangePolicies: [],
    })
  })

  it('removes an existing deleted Resource Server allowlist when the Application is saved [spec: admin-console/admin-application-detail]', async () => {
    const { deps, authorization } = setup()
    const created = await createApplication(deps, 'https://auth.example', input, 'admin-1')

    authorization.findResources.mockResolvedValueOnce([{ ...resource, enabled: false }])
    await expect(
      updateApplication(deps, 'https://auth.example', created.id, { resourceScopes: input.resourceScopes }),
    ).rejects.toThrow('not active')

    authorization.findResources.mockResolvedValueOnce([])
    await expect(
      updateApplication(deps, 'https://auth.example', created.id, { resourceScopes: input.resourceScopes }),
    ).resolves.toMatchObject({ resourceScopes: [] })
  })

  it('binds consent to an active visible resource', async () => {
    const { deps, authorization } = setup()
    const created = await createApplication(deps, 'https://auth.example', input, 'admin-1')
    await expect(
      loadConsentRequest(
        deps,
        'https://auth.example',
        {
          clientId: created.clientId,
          redirectUri: input.redirectUris[0],
          scope: 'items:read',
          state: 'state',
          authorizationParams: { resource: resource.resourceUrl },
        },
        { id: 'user-1', username: 'user' },
      ),
    ).resolves.toMatchObject({ resourceServerId: resource.id, requestedScopes: ['items:read'] })
    await expect(
      createConsent(
        deps,
        { clientId: created.clientId, resourceServerId: resource.id, scopes: ['items:read'] },
        'user-1',
      ),
    ).resolves.toBeDefined()
    authorization.findMemberByOrganizationUser.mockResolvedValueOnce(null)
    await expect(
      createConsent(
        deps,
        { clientId: created.clientId, resourceServerId: resource.id, scopes: ['items:read'] },
        'outsider',
      ),
    ).rejects.toThrow('not visible')
    authorization.findResourceByResourceUrl.mockResolvedValueOnce(null)
    await expect(
      loadConsentRequest(
        deps,
        'https://auth.example',
        {
          clientId: created.clientId,
          redirectUri: input.redirectUris[0],
          authorizationParams: { resource: resource.resourceUrl },
        },
        { id: 'user-1' },
      ),
    ).rejects.toThrow('not active')
  })
})
