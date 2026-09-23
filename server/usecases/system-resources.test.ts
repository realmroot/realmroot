import { createTestDeps } from '@server/http/test-deps'
import { describe, expect, it, vi } from 'vitest'
import { findPlatformOrganization, findRealmrootResourceServer, requirePlatformOrganization } from './system-resources'

describe('built-in system resource lookup', () => {
  it('resolves built-in identifiers without directory enumeration', async () => {
    const deps = createTestDeps()
    expect(await findPlatformOrganization(deps)).toMatchObject({ slug: 'realmroot' })
    expect(await findRealmrootResourceServer(deps)).toMatchObject({ identifier: 'realmroot' })
    expect(deps.authorization.findOrganizationBySlug).toHaveBeenCalledWith('realmroot')
    expect(deps.authorization.findResourceByIdentifier).toHaveBeenCalledWith('realmroot')
    expect(deps.authorization.listOrganizations).not.toHaveBeenCalled()
    expect(deps.authorization.listResources).not.toHaveBeenCalled()
  })
  it('keeps missing built-in records explicit', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findOrganizationBySlug).mockResolvedValue(null)
    vi.mocked(deps.authorization.findResourceByIdentifier).mockResolvedValue(null)
    expect(await findPlatformOrganization(deps)).toBeNull()
    expect(await findRealmrootResourceServer(deps)).toBeNull()
    await expect(requirePlatformOrganization(deps)).rejects.toThrow(
      'The built-in platform Organization is unavailable.',
    )
  })
})
