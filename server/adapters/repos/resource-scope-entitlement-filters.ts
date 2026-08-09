import { resourceScopeEntitlement } from '@server/db/schema'
import type { ListScopeEntitlementsQuery } from '@shared/api/authorization'
import { and, gt, isNotNull, isNull, lte, or } from 'drizzle-orm'

export function scopeEntitlementStatusCondition(status: ListScopeEntitlementsQuery['status'], now: Date) {
  if (status === 'inactive') {
    return or(
      isNotNull(resourceScopeEntitlement.endedAt),
      and(isNotNull(resourceScopeEntitlement.expiresAt), lte(resourceScopeEntitlement.expiresAt, now)),
    )
  }
  return and(
    isNull(resourceScopeEntitlement.endedAt),
    or(isNull(resourceScopeEntitlement.expiresAt), gt(resourceScopeEntitlement.expiresAt, now)),
  )
}
