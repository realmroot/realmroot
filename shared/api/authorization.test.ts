import { apiResourceVisibilitySchema, replaceMemberRolesRequestSchema } from '@shared/api/authorization'
import { describe, expect, it } from 'vitest'

describe('authorization API schemas', () => {
  it('accepts only private and public Resource Server visibility', () => {
    expect(apiResourceVisibilitySchema.parse('private')).toBe('private')
    expect(apiResourceVisibilitySchema.parse('public')).toBe('public')
    expect(apiResourceVisibilitySchema.safeParse('organizations').success).toBe(false)
  })

  it('deduplicates and deterministically orders member Roles', () => {
    expect(replaceMemberRolesRequestSchema.parse({ roles: ['developer', 'admin', 'developer'] })).toEqual({
      roles: ['admin', 'developer'],
    })
  })
})
