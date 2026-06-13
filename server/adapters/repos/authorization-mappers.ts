import type { ApiPermissionRecordInput, ApiScopeRecordInput } from '@server/usecases/ports'
import type { apiPermission, apiResource, apiScope, invitation, member, organization, role } from '../../db/schema'

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
    audience: row.audience,
    description: row.description,
    enabled: row.enabled,
    tokenClaimsNamespace: row.tokenClaimsNamespace,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toScope(row: typeof apiScope.$inferSelect): ApiScopeRecordInput {
  return {
    id: row.id,
    resourceId: row.resourceId,
    value: row.value,
    description: row.description,
    required: row.required,
    tokenClaimName: row.tokenClaimName,
    includeInAccessToken: row.includeInAccessToken,
    includeInIdToken: row.includeInIdToken,
  }
}

export function toPermission(row: typeof apiPermission.$inferSelect): ApiPermissionRecordInput {
  return {
    id: row.id,
    resourceId: row.resourceId,
    scopeId: row.scopeId,
    key: row.key,
    description: row.description,
    tokenClaimValue: row.tokenClaimValue,
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
    tokenClaimName: row.tokenClaimName,
    tokenClaimValue: row.tokenClaimValue,
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
