import { describe, expect, it, vi } from 'vitest'
import { createApplication, createConsent, loadConsentRequest, updateApplication } from './applications'
import type { Deps } from './deps'

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

function setup() {
  let application: any
  const applications = {
    create: vi.fn(async ({ application: input }) => (application = { ...input, createdAt: now, updatedAt: now })),
    listSecrets: vi.fn().mockResolvedValue({ items: [], pagination: {} }),
    findById: vi.fn(async () => application),
    findByClientId: vi.fn(async () => application),
    update: vi.fn(async (_id, patch) =>
      Object.assign(application, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))),
    ),
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
    findResource: vi.fn().mockResolvedValue(resource),
    findResourceByResourceUrl: vi.fn().mockResolvedValue(resource),
    findMemberByOrganizationUser: vi.fn().mockResolvedValue({ id: 'member-1' }),
  }
  return { deps: { applications, authorization } as unknown as Deps, authorization }
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
    authorization.findResource.mockResolvedValueOnce(null)
    await expect(createApplication(deps, 'https://auth.example', input, 'admin-1')).rejects.toThrow('not active')
    authorization.findResource.mockResolvedValueOnce({ ...resource, ownerOrganizationId: 'other' })
    await expect(createApplication(deps, 'https://auth.example', input, 'admin-1')).rejects.toThrow('not visible')
    authorization.findResource.mockResolvedValueOnce(resource)
    await expect(
      createApplication(
        deps,
        'https://auth.example',
        { ...input, resourceScopes: [{ resourceServerId: resource.id, scopes: ['unknown'] }] },
        'admin-1',
      ),
    ).rejects.toThrow('undeclared')
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
