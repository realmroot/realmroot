import { apiResourceEligibilitySchema, replaceMemberRolesRequestSchema } from '@shared/api/authorization'
import { describe, expect, it } from 'vitest'

describe('authorization API schemas', () => {
  it('requires and normalizes Organization eligibility', () => {
    expect(apiResourceEligibilitySchema.safeParse({ mode: 'organizations' }).success).toBe(false)
    expect(
      apiResourceEligibilitySchema.parse({ mode: 'organizations', organizationIds: ['org-b', 'org-a', 'org-b'] }),
    ).toEqual({ mode: 'organizations', organizationIds: ['org-a', 'org-b'] })
    expect(apiResourceEligibilitySchema.parse({ mode: 'realm', organizationIds: ['ignored'] })).toEqual({
      mode: 'realm',
      organizationIds: [],
    })
  })

  it('deduplicates and deterministically orders member Roles', () => {
    expect(replaceMemberRolesRequestSchema.parse({ roles: ['developer', 'admin', 'developer'] })).toEqual({
      roles: ['admin', 'developer'],
    })
  })
})
