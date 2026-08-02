import {
  createId,
  dedupe,
  isAuthorizationClaim,
  selectTokenClaims,
  toTokenClaims,
} from '@server/usecases/authorization-utils'
import type { RoleAssignmentRecord } from '@server/usecases/ports'
import type { ApiResourceResponse, OrganizationResponse, RoleResponse } from '@shared/api/authorization'
import { describe, expect, it } from 'vitest'

const timestamp = '2026-07-30T00:00:00.000Z'
const role: RoleResponse = {
  id: 'role-1',
  key: 'reader',
  name: 'Reader',
  description: null,
  system: false,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const resource: ApiResourceResponse = {
  id: 'resource-1',
  identifier: 'projects',
  name: 'Projects',
  resourceUrl: 'https://api.example.com',
  connectorId: null,
  authorizationDetails: [],
  description: null,
  enabled: true,
  ownerOrganizationId: 'org-1',
  accessEligibility: { mode: 'realm', organizationIds: [] },
  availableToAgents: true,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const organization: OrganizationResponse = {
  id: 'org-1',
  slug: 'acme',
  name: 'Acme',
  displayName: null,
  logo: null,
  disabled: false,
  disabledReason: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const assignments = [{ role, scopes: ['projects:read'] }] as RoleAssignmentRecord[]

describe('authorization claim helpers', () => {
  it('creates entity identifiers and deduplicates claim values', () => {
    expect(createId('resource')).toMatch(/^resource_[a-f0-9]{32}$/)
    expect(dedupe(['reader', 'reader', 'writer'])).toEqual(['reader', 'writer'])
  })

  it('emits fixed claims with optional organization and resource metadata', () => {
    expect(
      toTokenClaims(
        { organizationId: organization.id, scopes: ['projects:read'] },
        assignments,
        resource,
        organization,
      ),
    ).toEqual({
      authorization: {
        scopes: ['projects:read'],
        groups: [organization.id],
        roles: [role.key],
        organization_id: organization.id,
        organization_name: organization.name,
        resource: resource.identifier,
        audience: resource.resourceUrl,
      },
      groups: [organization.id],
      roles: [role.key],
    })
    expect(toTokenClaims({ scopes: [] }, [], null)).toEqual({
      authorization: { scopes: [], groups: [], roles: [] },
      groups: [],
      roles: [],
    })
  })

  it('selects every supported token claim and ignores unavailable values', () => {
    const claims = toTokenClaims(
      {
        organizationId: organization.id,
        scopes: ['projects:read'],
        claimSelection: {
          authorization: true,
          groups: true,
          roles: true,
          scopes: true,
          organizationId: true,
          organizationName: true,
        },
      },
      assignments,
      resource,
      organization,
    )
    expect(claims).toEqual({
      authorization: expect.any(Object),
      groups: [organization.id],
      roles: [role.key],
      scope: 'projects:read',
      organization_id: organization.id,
      organization_name: organization.name,
    })
    expect(
      selectTokenClaims(
        { authorization: null, groups: undefined, roles: undefined },
        {
          authorization: true,
          groups: true,
          roles: true,
          scopes: true,
          organizationId: true,
          organizationName: true,
        },
      ),
    ).toEqual({ authorization: null })
  })

  it('recognizes only authorization claim objects with scope arrays', () => {
    expect(isAuthorizationClaim({ scopes: [] })).toBe(true)
    expect(isAuthorizationClaim(null)).toBe(false)
    expect(isAuthorizationClaim({ scopes: 'read' })).toBe(false)
    expect(isAuthorizationClaim([])).toBe(false)
  })
})
