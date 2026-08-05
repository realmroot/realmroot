import type { ApiResourceResponse } from '@shared/api/authorization'

export function resourceEligibleForOrganization(resource: ApiResourceResponse, organizationId?: string) {
  if (resource.accessEligibility.mode === 'realm') return true
  if (!organizationId) return false
  if (resource.accessEligibility.mode === 'owner_organization') {
    return resource.ownerOrganizationId === organizationId
  }
  return resource.accessEligibility.organizationIds.includes(organizationId)
}

export function activeResourceEligibleForOrganization(resource: ApiResourceResponse, organizationId?: string) {
  return Boolean(resource.enabled && !resource.archivedAt && resourceEligibleForOrganization(resource, organizationId))
}
