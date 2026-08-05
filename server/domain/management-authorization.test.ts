import {
  authorizesManagementOwner,
  boundaryOwns,
  type ManagementActor,
  type ManagementBoundary,
  type ManagementOwner,
  ownerFilterForBoundary,
} from '@server/domain/management-authorization'
import { describe, expect, it } from 'vitest'

const session: ManagementActor = { kind: 'session', userId: 'user-1', capabilities: ['agents:read'] }
const agent: ManagementActor = {
  kind: 'agent',
  identityId: 'agent-1',
  issuer: 'https://auth.example.com/api/auth',
  subject: 'agt_1',
  capabilities: ['agents:read'],
}

const boundaries: Record<string, ManagementBoundary> = {
  account: { kind: 'account', accountId: 'user-1' },
  organization: { kind: 'organization', organizationIds: ['org-1'] },
  realm: { kind: 'realm' },
}

const owners: Record<string, ManagementOwner> = {
  account: { kind: 'account', accountId: 'user-1' },
  otherAccount: { kind: 'account', accountId: 'user-2' },
  organization: { kind: 'organization', organizationId: 'org-1' },
  otherOrganization: { kind: 'organization', organizationId: 'org-2' },
  realm: { kind: 'realm' },
}

describe('management authorization policy', () => {
  it.each([
    session,
    agent,
  ])('uses the same Account, Organization, and Realm owner matrix for $kind actors [spec: management-api/management-canonical-authority-inventory]', (actor) => {
    const policy = { capability: 'agents:read', ownerKinds: ['account', 'organization', 'realm'] as const }
    expect(authorizesManagementOwner({ actor, boundary: boundaries.account, policy }, owners.account)).toBe(true)
    expect(authorizesManagementOwner({ actor, boundary: boundaries.account, policy }, owners.otherAccount)).toBe(false)
    expect(authorizesManagementOwner({ actor, boundary: boundaries.account, policy }, owners.organization)).toBe(false)
    expect(authorizesManagementOwner({ actor, boundary: boundaries.organization, policy }, owners.organization)).toBe(
      true,
    )
    expect(
      authorizesManagementOwner({ actor, boundary: boundaries.organization, policy }, owners.otherOrganization),
    ).toBe(false)
    expect(authorizesManagementOwner({ actor, boundary: boundaries.organization, policy }, owners.account)).toBe(false)
    expect(authorizesManagementOwner({ actor, boundary: boundaries.realm, policy }, owners.account)).toBe(true)
    expect(authorizesManagementOwner({ actor, boundary: boundaries.realm, policy }, owners.organization)).toBe(true)
    expect(authorizesManagementOwner({ actor, boundary: boundaries.realm, policy }, owners.realm)).toBe(true)
  })

  it('keeps capability independent from owner boundary', () => {
    expect(
      authorizesManagementOwner(
        {
          actor: { ...agent, capabilities: ['applications:read'] },
          boundary: boundaries.account,
          policy: { capability: 'agents:read', ownerKinds: ['account'] },
        },
        owners.account,
      ),
    ).toBe(false)
    expect(
      authorizesManagementOwner(
        {
          actor: session,
          boundary: boundaries.realm,
          policy: { capability: 'agents:read', ownerKinds: ['account'] },
        },
        owners.organization,
      ),
    ).toBe(false)
    expect(boundaryOwns(boundaries.account, owners.account)).toBe(true)
  })

  it('builds collection filters from the same exact owner boundary used for items', () => {
    expect(ownerFilterForBoundary(boundaries.realm)).toBeUndefined()
    expect(ownerFilterForBoundary(boundaries.realm, 'org-1')).toEqual({ ownerOrganizationIds: ['org-1'] })
    expect(ownerFilterForBoundary(boundaries.organization)).toEqual({ ownerOrganizationIds: ['org-1'] })
    expect(ownerFilterForBoundary(boundaries.organization, 'org-1')).toEqual({ ownerOrganizationIds: ['org-1'] })
    expect(ownerFilterForBoundary(boundaries.organization, 'org-2')).toEqual({ ownerOrganizationIds: [] })
    expect(ownerFilterForBoundary(boundaries.account)).toEqual({ ownerUserId: 'user-1', ownerOrganizationIds: [] })
  })
})
