import type { ApiResourceResponse } from '@shared/api/authorization'
import type { apiResource, invitation, member, organization, role } from '../../db/schema'

export function toOrganization(row: typeof organization.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    displayName: row.displayName,
    logo: row.logo,
    disabled: row.disabled,
    disabledReason: row.disabledReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toMember(row: typeof member.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toInvitation(row: typeof invitation.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    inviterId: row.inviterId,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toResource(row: typeof apiResource.$inferSelect, organizationIds: string[] = []) {
  return {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    resourceUrl: row.resourceUrl,
    connectorId: row.connectorId,
    authorizationDetails: row.authorizationDetails,
    description: row.description,
    enabled: row.enabled,
    ownerOrganizationId: row.ownerOrganizationId,
    accessEligibility: {
      mode: toResourceEligibilityMode(row.accessEligibilityMode),
      organizationIds,
    },
    availableToAgents: row.availableToAgents,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toResourceEligibilityMode(value: string): ApiResourceResponse['accessEligibility']['mode'] {
  if (value === 'owner_organization' || value === 'organizations') return value
  return 'realm'
}

export function toRole(row: typeof role.$inferSelect) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    system: row.system,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toPagination(pagination: { limit: number; offset: number }, total: number) {
  const nextOffset = pagination.offset + pagination.limit < total ? pagination.offset + pagination.limit : null

  return {
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    hasMore: nextOffset !== null,
    nextOffset,
  }
}

export function withoutUndefined<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}
