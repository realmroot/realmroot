import {
  activePublicResource,
  activeResourceVisibleToOrganization,
  resourceVisibleToOrganization,
} from '@server/usecases/resource-visibility'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { describe, expect, it } from 'vitest'

const resource = {
  enabled: true,
  ownerOrganizationId: 'org-1',
} as ApiResourceResponse

describe('Resource Server visibility', () => {
  it('makes private resources visible only to their owner Organization', () => {
    expect(resourceVisibleToOrganization({ ...resource, visibility: 'private' }, 'org-1')).toBe(true)
    expect(resourceVisibleToOrganization({ ...resource, visibility: 'private' }, 'org-2')).toBe(false)
  })

  it('makes public resources visible to every Organization without granting scopes', () => {
    expect(resourceVisibleToOrganization({ ...resource, visibility: 'public' }, 'org-1')).toBe(true)
    expect(resourceVisibleToOrganization({ ...resource, visibility: 'public' }, 'org-2')).toBe(true)
  })

  it('requires enabled resources', () => {
    const visible = { ...resource, visibility: 'public' as const }
    expect(activeResourceVisibleToOrganization(visible, 'org-1')).toBe(true)
    expect(activePublicResource(visible)).toBe(true)
    expect(activeResourceVisibleToOrganization({ ...visible, enabled: false }, 'org-1')).toBe(false)
  })
})
