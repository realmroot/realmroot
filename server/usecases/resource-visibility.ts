import type { ApiResourceResponse } from '@shared/api/authorization'

export function resourceVisibleToOrganization(resource: ApiResourceResponse, organizationId: string) {
  return resource.visibility === 'public' || resource.ownerOrganizationId === organizationId
}

export function activeResourceVisibleToOrganization(resource: ApiResourceResponse, organizationId: string) {
  return Boolean(resource.enabled && resourceVisibleToOrganization(resource, organizationId))
}

export function activePublicResource(resource: ApiResourceResponse) {
  return Boolean(resource.enabled && resource.visibility === 'public')
}
