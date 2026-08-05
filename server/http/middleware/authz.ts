import { type AuthorizationContext, type AuthorizationTenant, authorize } from '@server/domain/authorization-context'
import { forbidden, unauthorized } from '@server/domain/errors'
import { realmrootResourceServer } from '@server/domain/realmroot-resource-server'
import { resolveOrganizationMembershipScopes } from '@server/usecases/organization-membership-scopes'
import { type ProtectedResource, requiredResourceScope } from '@shared/authz'
import { predefinedOrganizationRoleScopes } from '@shared/organization-access'
import type { RealmrootOrganizationScope } from '@shared/scope-registry'
import type { Context, MiddlewareHandler } from 'hono'
import { getPrincipal } from './authn'
import { getDeps } from './deps'

export function authz(resource: ProtectedResource): MiddlewareHandler {
  return async (c, next) => {
    const { user, agent } = getPrincipal(c)
    if (!user && !agent) throw unauthorized()
    if (agent) {
      const required = requiredResourceScope(c.req.method, resource)
      if (!required || !agent.scopes.includes(required)) {
        throw forbidden(required ? `OAuth scope "${required}" is required.` : 'This resource is read-only.')
      }
    }
    await next()
  }
}

export function requireAgentScope(c: Context, requiredScope: string) {
  const agent = getPrincipal(c).agent
  if (agent && !agent.scopes.includes(requiredScope)) {
    throw forbidden(`OAuth scope "${requiredScope}" is required.`)
  }
}

export async function authorizeOrganization(
  c: Context,
  organizationId: string,
  requiredScope: RealmrootOrganizationScope,
) {
  const target = { type: 'organization' as const, id: organizationId }
  authorize(await resolveAuthorizationContext(c, target), target, requiredScope)
}

export async function authorizedOrganizationIds(
  c: Context,
  requiredScope: RealmrootOrganizationScope,
): Promise<string[] | undefined> {
  const tenants = await authorizedTenantInventory(c, requiredScope)
  if (!tenants) return undefined
  return [...new Set(tenants.filter((tenant) => tenant.type === 'organization').map((tenant) => tenant.id))].sort()
}

export async function authorizedTenantInventory(
  c: Context,
  requiredScope: RealmrootOrganizationScope,
): Promise<AuthorizationTenant[] | undefined> {
  const principal = getPrincipal(c)
  if (principal.user && hasRealmAdminRole(principal.user.role)) return undefined
  if (principal.user) {
    const memberships = await getDeps(c).authorization.listUserMemberships(principal.user.id)
    const userTenant = { type: 'user' as const, id: principal.user.id }
    const userContext = await resolveAuthorizationContext(c, userTenant)
    const tenants: AuthorizationTenant[] = userContext.scopes.has(requiredScope) ? [userTenant] : []
    for (const membership of memberships) {
      const target = { type: 'organization' as const, id: membership.organizationId }
      const context = await resolveAuthorizationContext(c, target)
      if (context.scopes.has(requiredScope)) tenants.push(target)
    }
    return tenants
  }
  const agent = principal.agent
  if (!agent?.scopes.includes(requiredScope)) {
    throw forbidden(`OAuth scope "${requiredScope}" is required.`)
  }
  if (agent.authority?.kind === 'organization') {
    return [{ type: 'organization', id: agent.authority.organizationId }]
  }
  if (agent.authority?.kind === 'user') return [{ type: 'user', id: agent.authority.userId }]
  return []
}

export function requirePlatformAccess(c: Context, requiredScope: string) {
  if (hasPlatformAccess(c, requiredScope)) return
  throw forbidden('Platform administrator access is required.')
}

export function hasPlatformAccess(c: Context, _requiredScope: string) {
  const principal = getPrincipal(c)
  return Boolean(principal.user && hasRealmAdminRole(principal.user.role))
}

export async function authorizeUser(c: Context, userId: string, requiredScope: string) {
  const target = { type: 'user' as const, id: userId }
  authorize(await resolveAuthorizationContext(c, target), target, requiredScope)
}

export async function resolveAuthorizationContext(
  c: Context,
  targetTenant: AuthorizationTenant,
): Promise<AuthorizationContext> {
  const principal = getPrincipal(c)
  if (principal.user) {
    if (targetTenant.type === 'user') {
      const platformAdministrator = hasRealmAdminRole(principal.user.role)
      return {
        subject: { type: 'user', id: principal.user.id },
        tenant: platformAdministrator ? targetTenant : { type: 'user', id: principal.user.id },
        scopes: new Set(
          platformAdministrator || principal.user.id === targetTenant.id
            ? ['self:read', 'self:write', 'agents:read', 'agents:write']
            : [],
        ),
      }
    }
    if (hasRealmAdminRole(principal.user.role)) {
      return {
        subject: { type: 'user', id: principal.user.id },
        tenant: targetTenant,
        scopes: new Set(Object.values(predefinedOrganizationRoleScopes).flat()),
      }
    }
    const membership = await getDeps(c).authorization.findMemberByOrganizationUser(targetTenant.id, principal.user.id)
    return {
      subject: { type: 'user', id: principal.user.id },
      tenant: targetTenant,
      scopes: new Set(
        membership
          ? await resolveOrganizationMembershipScopes(
              getDeps(c),
              targetTenant.id,
              membership.roles,
              realmrootResourceServer.id,
            )
          : [],
      ),
    }
  }
  const agent = principal.agent
  if (!agent) throw unauthorized()
  const authority = agent.authority
  const tenant: AuthorizationTenant =
    authority?.kind === 'organization'
      ? { type: 'organization', id: authority.organizationId }
      : authority?.kind === 'user'
        ? { type: 'user', id: authority.userId }
        : { type: 'user', id: '' }
  return {
    subject: { type: 'agent', id: agent.identityId },
    tenant,
    scopes: new Set(agent.scopes),
  }
}

export function authenticatedUser(): MiddlewareHandler {
  return async (c, next) => {
    if (!getPrincipal(c).user) throw unauthorized()
    await next()
  }
}

function hasRealmAdminRole(value: string | null | undefined) {
  return (value ?? '')
    .split(',')
    .map((role) => role.trim())
    .includes('admin')
}
