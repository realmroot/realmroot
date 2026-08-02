import { apiResourceEligibilitySchema, replaceRolePermissionsRequestSchema } from '@shared/api/authorization'
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

  it('deduplicates and deterministically orders role permissions', () => {
    expect(
      replaceRolePermissionsRequestSchema.parse({
        permissions: [
          { resourceId: 'resource-b', scope: 'read' },
          { resourceId: 'resource-a', scope: 'write' },
          { resourceId: 'resource-a', scope: 'read' },
          { resourceId: 'resource-a', scope: 'read' },
        ],
      }),
    ).toEqual({
      permissions: [
        { resourceId: 'resource-a', scope: 'read' },
        { resourceId: 'resource-a', scope: 'write' },
        { resourceId: 'resource-b', scope: 'read' },
      ],
    })
  })
})
