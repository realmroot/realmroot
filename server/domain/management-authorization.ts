import { forbidden } from './errors'

export type ManagementBoundary =
  | { kind: 'realm' }
  | {
      kind: 'restricted'
      accountUserId: string | null
      organizationIds: readonly string[]
    }

export type ManagementOwner =
  | { kind: 'realm' }
  | { kind: 'organization'; organizationId: string }
  | { kind: 'account'; userId: string }

export type ManagementActor =
  | { kind: 'user'; userId: string }
  | {
      kind: 'agent'
      issuer: string
      subject: string
      identityId: string
      protocolAgentId: string
      hostId: string
      authority: ManagementOwner
    }

export function userManagementActor(userId: string): ManagementActor {
  return { kind: 'user', userId }
}

export interface ManagementOwnerKinds {
  realm?: boolean
  organization?: boolean
  account?: boolean
}

export interface ManagementOwnerFilter {
  includeRealmOwned: boolean
  ownerOrganizationIds?: string[]
  ownerUserId?: string
}

export function managementOwnerColumns(owner: ManagementOwner) {
  if (owner.kind === 'account') return { ownerUserId: owner.userId, ownerOrganizationId: null }
  if (owner.kind === 'organization') return { ownerUserId: null, ownerOrganizationId: owner.organizationId }
  return { ownerUserId: null, ownerOrganizationId: null }
}

export function requireManagementOwner(boundary: ManagementBoundary, owner: ManagementOwner): void {
  if (!managementBoundaryAllowsOwner(boundary, owner)) throw forbidden()
}

export function managementBoundaryAllowsOwner(boundary: ManagementBoundary, owner: ManagementOwner): boolean {
  if (boundary.kind === 'realm') return true
  if (owner.kind === 'account') return owner.userId === boundary.accountUserId
  if (owner.kind === 'organization') return boundary.organizationIds.includes(owner.organizationId)
  return false
}

export function resolveManagementOwnerFilter(
  boundary: ManagementBoundary,
  supportedOwners: ManagementOwnerKinds,
  requestedOrganizationId?: string,
): ManagementOwnerFilter {
  if (boundary.kind === 'realm') {
    if (requestedOrganizationId) {
      if (!supportedOwners.organization) throw forbidden()
      return { includeRealmOwned: false, ownerOrganizationIds: [requestedOrganizationId] }
    }
    return {
      includeRealmOwned: supportedOwners.realm === true,
      ...(supportedOwners.organization ? { ownerOrganizationIds: undefined } : {}),
    }
  }

  if (requestedOrganizationId) {
    if (!supportedOwners.organization || !boundary.organizationIds.includes(requestedOrganizationId)) {
      throw forbidden()
    }
    return { includeRealmOwned: false, ownerOrganizationIds: [requestedOrganizationId] }
  }
  const ownerOrganizationIds = supportedOwners.organization ? [...boundary.organizationIds] : undefined
  const ownerUserId = supportedOwners.account ? boundary.accountUserId : null
  if (!ownerOrganizationIds?.length && !ownerUserId) throw forbidden()
  return {
    includeRealmOwned: false,
    ...(ownerOrganizationIds?.length ? { ownerOrganizationIds } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
  }
}

export function ownerFromColumns(
  ownerUserId: string | null | undefined,
  ownerOrganizationId: string | null | undefined,
): ManagementOwner {
  if (ownerUserId && !ownerOrganizationId) return { kind: 'account', userId: ownerUserId }
  if (ownerOrganizationId && !ownerUserId) return { kind: 'organization', organizationId: ownerOrganizationId }
  if (!ownerUserId && !ownerOrganizationId) return { kind: 'realm' }
  throw new Error('A management resource must have exactly one canonical owner boundary.')
}

export function ownerFromAgentHomeSpace(
  homeSpace: { type: 'personal'; userId: string } | { type: 'organization'; organizationId: string },
): ManagementOwner {
  return homeSpace.type === 'personal'
    ? { kind: 'account', userId: homeSpace.userId }
    : { kind: 'organization', organizationId: homeSpace.organizationId }
}
