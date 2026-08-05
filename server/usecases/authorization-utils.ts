import type { ApplicationOidcClaims } from '@shared/api/applications'
import type { ApiResourceResponse, OrganizationResponse } from '@shared/api/authorization'

export interface AuthorizationTokenClaimInput {
  userId?: string | null
  applicationId?: string | null
  organizationId?: string
  resource?: string
  scopes: string[]
  authorizedScopes?: string[]
  destination?: 'access_token' | 'id_token' | 'userinfo'
  claimSelection?: ApplicationOidcClaims['accessToken']
}

export function toTokenClaims(
  input: AuthorizationTokenClaimInput,
  roleAuthorization: { roles: string[]; scopes: string[] } | null,
  resource: ApiResourceResponse | null,
  organization: OrganizationResponse | null = null,
) {
  const roles = dedupe(roleAuthorization?.roles ?? [])
  const assignedScopes = new Set(roleAuthorization?.scopes ?? [])
  const scopes = roleAuthorization ? input.scopes.filter((scope) => assignedScopes.has(scope)) : input.scopes
  const groups = input.organizationId ? [input.organizationId] : []
  const authorization = {
    scopes,
    groups,
    roles,
    ...(input.organizationId ? { organization_id: input.organizationId } : {}),
    ...(organization ? { organization_name: organization.displayName ?? organization.name } : {}),
    ...(resource ? { resource: resource.identifier, audience: resource.resourceUrl } : {}),
  }
  const claims = {
    authorization,
    groups,
    roles,
  }
  return input.claimSelection ? selectTokenClaims(claims, input.claimSelection) : claims
}

export function selectTokenClaims(
  claims: Record<string, unknown>,
  selection: ApplicationOidcClaims['accessToken'],
): Record<string, unknown> {
  const selected: Record<string, unknown> = {}
  const authorization = claims.authorization
  if (selection.authorization && authorization !== undefined) selected.authorization = authorization
  if (selection.groups && claims.groups !== undefined) selected.groups = claims.groups
  if (selection.roles && claims.roles !== undefined) selected.roles = claims.roles
  if (selection.scopes && isAuthorizationClaim(authorization)) selected.scope = authorization.scopes.join(' ')
  if (selection.organizationId && isAuthorizationClaim(authorization) && authorization.organization_id) {
    selected.organization_id = authorization.organization_id
  }
  if (selection.organizationName && isAuthorizationClaim(authorization) && authorization.organization_name) {
    selected.organization_name = authorization.organization_name
  }
  return selected
}

export function isAuthorizationClaim(value: unknown): value is {
  scopes: string[]
  organization_id?: string
  organization_name?: string
} {
  return typeof value === 'object' && value !== null && 'scopes' in value && Array.isArray(value.scopes)
}

export function dedupe(values: string[]) {
  return [...new Set(values)]
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}
