import { createTestDeps } from '@server/http/test-deps'
import {
  findPlatformOrganization,
  findRealmrootResourceServer,
  requirePlatformOrganization,
} from '@server/usecases/system-resources'
import { describe, expect, it, vi } from 'vitest'

describe('built-in system resource lookup', () => {
  it('continues through paginated Organizations and Resource Servers', async () => {
    const deps = createTestDeps()
    const organizationPage = await deps.authorization.listOrganizations({ limit: 100, offset: 0 })
    const resourcePage = await deps.authorization.listResources({ limit: 100, offset: 0 })
    const platform = organizationPage.items[0]
    const realmroot = resourcePage.items[0]

    vi.mocked(deps.authorization.listOrganizations)
      .mockResolvedValueOnce({
        items: [{ ...platform, id: 'org-other', slug: 'other' }],
        pagination: { limit: 100, offset: 0, total: 101, hasMore: true, nextOffset: 100 },
      })
      .mockResolvedValueOnce({
        items: [platform],
        pagination: { limit: 100, offset: 100, total: 101, hasMore: false, nextOffset: null },
      })
    vi.mocked(deps.authorization.listResources)
      .mockResolvedValueOnce({
        items: [{ ...realmroot, id: 'resource-other', identifier: 'other' }],
        pagination: { limit: 100, offset: 0, total: 101, hasMore: true, nextOffset: 100 },
      })
      .mockResolvedValueOnce({
        items: [realmroot],
        pagination: { limit: 100, offset: 100, total: 101, hasMore: false, nextOffset: null },
      })

    await expect(findPlatformOrganization(deps)).resolves.toEqual(platform)
    await expect(findRealmrootResourceServer(deps)).resolves.toEqual(realmroot)
    expect(deps.authorization.listOrganizations).toHaveBeenLastCalledWith({ limit: 100, offset: 100 })
    expect(deps.authorization.listResources).toHaveBeenLastCalledWith({ limit: 100, offset: 100 })
  })

  it('returns null for a completed search and requires the platform Organization when requested', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.listOrganizations).mockResolvedValue({
      items: [],
      pagination: { limit: 100, offset: 0, total: 0, hasMore: false, nextOffset: null },
    })
    vi.mocked(deps.authorization.listResources).mockResolvedValue({
      items: [],
      pagination: { limit: 100, offset: 0, total: 0, hasMore: false, nextOffset: null },
    })

    await expect(findPlatformOrganization(deps)).resolves.toBeNull()
    await expect(findRealmrootResourceServer(deps)).resolves.toBeNull()
    await expect(requirePlatformOrganization(deps)).rejects.toThrow(
      'The built-in platform Organization is unavailable.',
    )
  })
})
