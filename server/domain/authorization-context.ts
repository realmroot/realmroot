import { forbidden } from '@server/domain/errors'
import type { RealmrootOrganizationScope } from '@shared/scope-registry'

export type AuthorizationSubject =
  | { type: 'user'; id: string }
  | { type: 'agent'; id: string }
  | { type: 'application'; id: string }
  | { type: 'workload'; id: string }

export type AuthorizationTenant = { type: 'user'; id: string } | { type: 'organization'; id: string }

export interface AuthorizationContext {
  subject: AuthorizationSubject
  tenant: AuthorizationTenant
  scopes: ReadonlySet<string>
}

export function authorize(
  context: AuthorizationContext,
  targetTenant: AuthorizationTenant,
  requiredScope: RealmrootOrganizationScope | string,
) {
  if (context.tenant.type !== targetTenant.type || context.tenant.id !== targetTenant.id) {
    throw forbidden('The authenticated subject cannot access the target tenant.')
  }
  if (!context.scopes.has(requiredScope)) {
    throw forbidden(`OAuth scope "${requiredScope}" is required.`)
  }
}
