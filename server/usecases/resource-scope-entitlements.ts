import type { Deps } from '@server/usecases/deps'
import type { ApplicationAggregate, ResourceScopeEntitlementRecord } from '@server/usecases/ports'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { resolveOrganizationMembershipScopes } from './organization-membership-scopes'
import { activeResourceVisibleToOrganization } from './resource-visibility'

export function resourceScopeEntitlementLifecycle(
  entitlement: Pick<ResourceScopeEntitlementRecord, 'endedAt' | 'endReason' | 'expiresAt'>,
  now = new Date(),
) {
  if (entitlement.endedAt) {
    return { status: 'ended' as const, endReason: entitlement.endReason! }
  }
  if (entitlement.expiresAt && entitlement.expiresAt.getTime() <= now.getTime()) {
    return { status: 'ended' as const, endReason: 'expired' as const }
  }
  return { status: 'active' as const, endReason: null }
}

export async function userEffectiveResourceScopes(
  deps: Deps,
  userId: string,
  resource: ApiResourceResponse,
  now = new Date(),
  tenantOrganizationId?: string | null,
) {
  const memberships = await deps.authorization.listUserMemberships(userId)
  const tenantMemberships =
    tenantOrganizationId === undefined
      ? memberships
      : tenantOrganizationId === null
        ? []
        : memberships.filter((membership) => membership.organizationId === tenantOrganizationId)
  const visibleMemberships =
    resource.visibility === 'private'
      ? tenantMemberships.filter((membership) => membership.organizationId === resource.ownerOrganizationId)
      : tenantMemberships
  if (resource.visibility === 'private' && visibleMemberships.length === 0) return []

  const scopes = automaticScopes(resource)
  for (const entitlement of await deps.authorization.listActiveUserScopeEntitlements(userId, resource.id, now)) {
    scopes.add(entitlement.scope)
  }
  for (const membership of visibleMemberships) {
    for (const scope of await resolveOrganizationMembershipScopes(
      deps,
      membership.organizationId,
      membership.roles,
      resource.id,
    )) {
      scopes.add(scope)
    }
  }
  return currentRegistryScopes(resource, scopes)
}

export async function applicationEffectiveResourceScopes(
  deps: Deps,
  application: ApplicationAggregate,
  resource: ApiResourceResponse,
  now = new Date(),
) {
  if (!activeResourceVisibleToOrganization(resource, application.ownerOrganizationId)) return []
  const scopes = automaticScopes(resource)
  for (const entitlement of await deps.authorization.listActiveApplicationScopeEntitlements(
    application.id,
    resource.id,
    now,
  )) {
    scopes.add(entitlement.scope)
  }
  return currentRegistryScopes(resource, scopes)
}

function automaticScopes(resource: ApiResourceResponse) {
  return new Set(
    resource.scopeRegistry?.scopes.filter((scope) => scope.grantMode === 'automatic').map((scope) => scope.value) ?? [],
  )
}

function currentRegistryScopes(resource: ApiResourceResponse, scopes: Iterable<string>) {
  const declared = new Set(resource.scopeRegistry?.scopes.map((scope) => scope.value) ?? [])
  return [...new Set(scopes)].filter((scope) => declared.has(scope)).sort()
}
