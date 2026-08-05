export type ManagementActor =
  | {
      kind: 'session'
      userId: string
      capabilities: readonly string[]
    }
  | {
      kind: 'agent'
      identityId: string
      issuer: string
      subject: string
      capabilities: readonly string[]
    }

export type ManagementBoundary =
  | { kind: 'realm' }
  | { kind: 'organization'; organizationIds: readonly string[] }
  | { kind: 'account'; accountId: string }

export type ManagementOwner =
  | { kind: 'realm' }
  | { kind: 'organization'; organizationId: string }
  | { kind: 'account'; accountId: string }

export interface ManagementPolicy {
  capability: string
  ownerKinds: readonly ManagementOwner['kind'][]
}

export interface ManagementAuthorization {
  actor: ManagementActor
  boundary: ManagementBoundary
  policy: ManagementPolicy
}

export interface ManagementOwnerFilter {
  ownerUserId?: string
  ownerOrganizationIds?: string[]
}

export function authorizesManagementOwner(authorization: ManagementAuthorization, owner: ManagementOwner): boolean {
  if (!authorization.actor.capabilities.includes(authorization.policy.capability)) return false
  if (!authorization.policy.ownerKinds.includes(owner.kind)) return false
  return boundaryOwns(authorization.boundary, owner)
}

export function boundaryOwns(boundary: ManagementBoundary, owner: ManagementOwner): boolean {
  if (boundary.kind === 'realm') return true
  if (boundary.kind === 'account') return owner.kind === 'account' && owner.accountId === boundary.accountId
  return owner.kind === 'organization' && boundary.organizationIds.includes(owner.organizationId)
}

export function ownerFilterForBoundary(
  boundary: ManagementBoundary,
  requestedOrganizationId?: string,
): ManagementOwnerFilter | undefined {
  if (boundary.kind === 'realm') {
    return requestedOrganizationId ? { ownerOrganizationIds: [requestedOrganizationId] } : undefined
  }
  if (boundary.kind === 'account') return { ownerUserId: boundary.accountId, ownerOrganizationIds: [] }
  if (!requestedOrganizationId) return { ownerOrganizationIds: [...boundary.organizationIds] }
  return {
    ownerOrganizationIds: boundary.organizationIds.includes(requestedOrganizationId) ? [requestedOrganizationId] : [],
  }
}

export function organizationIdsForBoundary(
  boundary: ManagementBoundary,
  requestedOrganizationId?: string,
): string[] | undefined {
  return ownerFilterForBoundary(boundary, requestedOrganizationId)?.ownerOrganizationIds
}
