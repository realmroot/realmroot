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

export function toResource(row: typeof apiResource.$inferSelect) {
  return {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    resourceUrl: row.resourceUrl,
    authorizationMode: row.authorizationMode as 'native' | 'external',
    description: row.description,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toRole(row: typeof role.$inferSelect) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    resourceId: row.resourceId,
    organizationId: row.organizationId,
    applicationId: row.applicationId,
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
