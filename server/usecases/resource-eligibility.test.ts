import {
  activeResourceEligibleForOrganization,
  resourceEligibleForOrganization,
} from '@server/usecases/resource-eligibility'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { describe, expect, it } from 'vitest'

const resource = {
  enabled: true,
  archivedAt: null,
  ownerOrganizationId: 'org-1',
} as ApiResourceResponse

describe('Resource Server Organization eligibility', () => {
  it('evaluates every eligibility mode independently from active state', () => {
    expect(
      resourceEligibleForOrganization(
        { ...resource, accessEligibility: { mode: 'realm', organizationIds: [] } },
        undefined,
      ),
    ).toBe(true)
    expect(
      resourceEligibleForOrganization(
        { ...resource, accessEligibility: { mode: 'owner_organization', organizationIds: [] } },
        undefined,
      ),
    ).toBe(false)
    expect(
      resourceEligibleForOrganization(
        { ...resource, accessEligibility: { mode: 'owner_organization', organizationIds: [] } },
        'org-1',
      ),
    ).toBe(true)
    expect(
      resourceEligibleForOrganization(
        { ...resource, accessEligibility: { mode: 'organizations', organizationIds: ['org-2'] } },
        'org-1',
      ),
    ).toBe(false)
    expect(
      resourceEligibleForOrganization(
        { ...resource, accessEligibility: { mode: 'organizations', organizationIds: ['org-1'] } },
        'org-1',
      ),
    ).toBe(true)
  })

  it('requires an enabled, unarchived eligible Resource Server', () => {
    const eligible = { ...resource, accessEligibility: { mode: 'realm' as const, organizationIds: [] } }
    expect(activeResourceEligibleForOrganization(eligible, 'org-1')).toBe(true)
    expect(activeResourceEligibleForOrganization({ ...eligible, enabled: false }, 'org-1')).toBe(false)
    expect(
      activeResourceEligibleForOrganization({ ...eligible, archivedAt: '2026-08-05T00:00:00.000Z' }, 'org-1'),
    ).toBe(false)
  })
})
