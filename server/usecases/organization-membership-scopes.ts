import { type AuthorizationContext, canAuthorize } from '@server/domain/authorization-context'
import { realmrootResourceServer } from '@server/domain/realmroot-resource-server'
import type { Deps } from '@server/usecases/deps'
import { readDeclaredScopes } from '@server/usecases/resource-openapi'
import type { ApiResourceResponse } from '@shared/api/authorization'
import { predefinedOrganizationRoleScopes } from '@shared/organization-access'
import { type RealmrootOrganizationScope, realmrootScopeRegistry } from '@shared/scope-registry'
import { activeResourceEligibleForOrganization } from './resource-eligibility'

export async function resolveOrganizationMembershipScopes(
  deps: Deps,
  organizationId: string,
  roles: string[],
  resourceId: string,
) {
  const scopes = new Set<string>()
  if (resourceId === realmrootResourceServer.id) {
    for (const role of roles) {
      if (role in predefinedOrganizationRoleScopes) {
        for (const scope of predefinedOrganizationRoleScopes[role as keyof typeof predefinedOrganizationRoleScopes]) {
          scopes.add(scope)
        }
      }
    }
  }

  const dynamicRoles = await deps.authorization.listOrganizationRoleScopes(organizationId)
  for (const role of roles) {
    for (const item of dynamicRoles.get(role) ?? []) {
      if (item.resourceId === resourceId) scopes.add(item.scope)
    }
  }

  if (resourceId === realmrootResourceServer.id) {
    return [...scopes].filter((scope) => scope in realmrootScopeRegistry).sort()
  }
  if (scopes.size === 0) return []

  const resource = await deps.authorization.findResource(resourceId)
  return resource ? filterCurrentResourceScopes(deps, resource, organizationId, scopes) : []
}

export async function filterCurrentResourceScopes(
  deps: Deps,
  resource: ApiResourceResponse,
  organizationId: string,
  scopes: Iterable<string>,
) {
  const candidates = [...scopes]
  if (candidates.length === 0) return []
  if (!activeResourceEligibleForOrganization(resource, organizationId)) return []
  if (resource.id === realmrootResourceServer.id) {
    return candidates.filter((scope) => scope in realmrootScopeRegistry).sort()
  }
  const declaredScopes = new Set((await readDeclaredScopes(deps, resource.resourceUrl)).map((scope) => scope.value))
  return candidates.filter((scope) => declaredScopes.has(scope)).sort()
}

export async function organizationUserHasScope(
  deps: Deps,
  organizationId: string,
  userId: string,
  requiredScope: RealmrootOrganizationScope,
) {
  const target = { type: 'organization' as const, id: organizationId }
  return canAuthorize(
    await resolveOrganizationUserAuthorizationContext(deps, organizationId, userId),
    target,
    requiredScope,
  )
}

export async function resolveOrganizationUserAuthorizationContext(
  deps: Deps,
  organizationId: string,
  userId: string,
): Promise<AuthorizationContext> {
  const member = await deps.authorization.findMemberByOrganizationUser(organizationId, userId)
  return {
    subject: { type: 'user', id: userId },
    tenant: { type: 'organization', id: organizationId },
    scopes: new Set(
      member
        ? await resolveOrganizationMembershipScopes(deps, organizationId, member.roles, realmrootResourceServer.id)
        : [],
    ),
  }
}
