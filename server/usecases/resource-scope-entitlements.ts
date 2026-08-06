import type { Deps } from '@server/usecases/deps'
import type { ApplicationAggregate } from '@server/usecases/ports'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { resolveOrganizationMembershipScopes } from './organization-membership-scopes'
import { activeResourceVisibleToOrganization } from './resource-visibility'

export async function userEffectiveResourceScopes(
  deps: Deps,
  userId: string,
  resource: ApiResourceResponse,
  now = new Date(),
) {
  const memberships = await deps.authorization.listUserMemberships(userId)
  const visibleMemberships =
    resource.visibility === 'private'
      ? memberships.filter((membership) => membership.organizationId === resource.ownerOrganizationId)
      : memberships
  if (resource.visibility === 'private' && visibleMemberships.length === 0) return []

  const scopes = automaticScopes(resource)
  for (const grant of await deps.authorization.listActiveUserScopeGrants(userId, resource.id, now)) {
    for (const scope of grant.scopes) scopes.add(scope)
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
  for (const grant of await deps.authorization.listActiveApplicationScopeGrants(application.id, resource.id, now)) {
    for (const scope of grant.scopes) scopes.add(scope)
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
