import { forbidden } from '@server/domain/errors'
import type { RealmrootOrganizationScope } from '@shared/scope-registry'

export type AuthorizationSubject =
  | { type: 'user'; id: string }
  | { type: 'agent'; id: string }
  | { type: 'application'; id: string }
  | { type: 'workload'; id: string }

export type AuthorizationTenant =
  | { type: 'realm' }
  | { type: 'user'; id: string }
  | { type: 'organization'; id: string }

export interface AuthorizationContext {
  subject: AuthorizationSubject
  tenant: AuthorizationTenant
  scopes: ReadonlySet<string>
}

declare const authorizedOwnerBrand: unique symbol
export type AuthorizedOwner = AuthorizationTenant & { readonly [authorizedOwnerBrand]: true }

export function authorize(
  context: AuthorizationContext,
  targetTenant: AuthorizationTenant,
  requiredScope: RealmrootOrganizationScope | string,
) {
  if (tenantKey(context.tenant) !== tenantKey(targetTenant)) {
    throw forbidden('The authenticated subject cannot access the target tenant.')
  }
  if (!context.scopes.has(requiredScope)) {
    throw forbidden(`OAuth scope "${requiredScope}" is required.`)
  }
}

export function canAuthorize(
  context: AuthorizationContext,
  targetTenant: AuthorizationTenant,
  requiredScope: RealmrootOrganizationScope | string,
) {
  return tenantKey(context.tenant) === tenantKey(targetTenant) && context.scopes.has(requiredScope)
}

export function authorizeOwner(
  context: AuthorizationContext,
  targetTenant: AuthorizationTenant,
  requiredScope: RealmrootOrganizationScope | string,
): AuthorizedOwner {
  authorize(context, targetTenant, requiredScope)
  return targetTenant as AuthorizedOwner
}

function tenantKey(tenant: AuthorizationTenant) {
  return tenant.type === 'realm' ? 'realm' : `${tenant.type}:${tenant.id}`
}
