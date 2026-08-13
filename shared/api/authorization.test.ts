import {
  apiResourceVisibilitySchema,
  createApiResourceRequestSchema,
  replaceMemberRolesRequestSchema,
} from '@shared/api/authorization'
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

  it('requires one Connector for external authorization and forbids it for native authorization', () => {
    const input = {
      identifier: 'projects',
      resourceUrl: 'https://api.example.com',
      authorizationModel: 'external' as const,
      ownerOrganizationId: 'organization-1',
    }

    expect(createApiResourceRequestSchema.safeParse(input).success).toBe(false)
    expect(
      createApiResourceRequestSchema.safeParse({
        ...input,
        connectorId: 'connector-1',
      }).success,
    ).toBe(true)
    expect(
      createApiResourceRequestSchema.safeParse({
        ...input,
        authorizationModel: 'native',
        connectorId: null,
      }).success,
    ).toBe(true)
  })
})
