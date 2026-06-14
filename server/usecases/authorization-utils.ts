import { badRequest } from '@server/domain/errors'
import type { RoleAssignmentInput, RoleAssignmentRecord } from '@server/usecases/ports'
import type { ApplicationOidcClaims } from '@shared/api/applications'
import type {
  ApiResourceResponse,
  ApiScopeResponse,
  AssignRoleRequest,
  OrganizationResponse,
} from '@shared/api/authorization'

export interface AuthorizationTokenClaimInput {
  userId?: string | null
  applicationId?: string | null
  organizationId?: string
  resource?: string
  scopes: string[]
  destination?: 'access_token' | 'id_token' | 'userinfo'
  claimSelection?: ApplicationOidcClaims['accessToken']
}

export function toAssignmentInput(input: AssignRoleRequest, actorUserId: string | null): RoleAssignmentInput {
  return {
    ...input,
    id: createId('assign'),
    assignedByUserId: actorUserId,
  }
}

// Names a custom role/assignment claim may not occupy: the authorization claims
// we synthesize, plus the OIDC/JWT registered claims an issuer owns — so an
// assignment can't shadow `sub`, `email`, etc. in a token. Mirrors the reserved
// set stripped from subject tokens in token-exchange.ts.
const reservedClaimNames = new Set([
  'authorization',
  'roles',
  'permissions',
  'iss',
  'sub',
  'aud',
  'exp',
  'nbf',
  'iat',
  'jti',
  'email',
  'email_verified',
  'name',
  'given_name',
  'family_name',
  'preferred_username',
  'picture',
  'phone_number',
])

function isReservedClaimName(name: string) {
  return reservedClaimNames.has(name) || /^https?:\/\//.test(name)
}

export function assertTokenClaims(tokenClaims: Record<string, unknown> | undefined) {
  if (!tokenClaims) return
  for (const key of Object.keys(tokenClaims)) {
    if (isReservedClaimName(key)) {
      throw badRequest(`Assignment token claim is reserved: ${key}`)
    }
  }
}

export function assertRoleTokenClaimName(tokenClaimName: string | null | undefined) {
  if (!tokenClaimName) return
  if (isReservedClaimName(tokenClaimName)) {
    throw badRequest(`Role token claim name is reserved: ${tokenClaimName}`)
  }
}

export function toTokenClaims(
  input: AuthorizationTokenClaimInput,
  assignments: RoleAssignmentRecord[],
  resource: ApiResourceResponse | null,
  organization: OrganizationResponse | null = null,
) {
  const roles = dedupe(assignments.map((assignment) => assignment.role.key))
  const permissions = dedupe(
    assignments.flatMap((assignment) => assignment.permissions.map((permission) => permission.key)),
  )
  const roleClaims = Object.fromEntries(
    assignments
      .map((assignment) => [assignment.role.tokenClaimName, assignment.role.tokenClaimValue ?? assignment.role.key])
      .filter((entry): entry is [string, string] => !!entry[0]),
  )
  const explicitClaims: Record<string, unknown> = {}
  for (const assignment of assignments) {
    Object.assign(explicitClaims, assignment.tokenClaims)
  }
  const authorization = {
    scopes: input.scopes,
    roles,
    permissions,
    ...(input.organizationId ? { organization_id: input.organizationId } : {}),
    ...(organization ? { organization_name: organization.displayName ?? organization.name } : {}),
    ...(resource ? { resource: resource.identifier, audience: resource.audience } : {}),
  }
  const namespaced =
    resource?.tokenClaimsNamespace && Object.keys(roleClaims).length > 0
      ? { [resource.tokenClaimsNamespace]: roleClaims }
      : roleClaims

  const claims = {
    ...explicitClaims,
    authorization,
    roles,
    permissions,
    ...namespaced,
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
  if (selection.roles && claims.roles !== undefined) selected.roles = claims.roles
  if (selection.permissions && claims.permissions !== undefined) selected.permissions = claims.permissions
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

export function filterScopes(
  values: string[],
  destination: NonNullable<AuthorizationTokenClaimInput['destination']>,
  scopes: ApiScopeResponse[],
) {
  if (scopes.length === 0) return values
  const scopesByValue = new Map(scopes.map((scope) => [scope.value, scope]))
  return values.filter((value) => {
    const scope = scopesByValue.get(value)
    if (!scope) return true
    if (destination === 'id_token') return scope.includeInIdToken
    if (destination === 'access_token') return scope.includeInAccessToken
    return true
  })
}

export function dedupe(values: string[]) {
  return [...new Set(values)]
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}
