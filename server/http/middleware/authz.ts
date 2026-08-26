import {
  type AuthorizationContext,
  type AuthorizationTenant,
  type AuthorizedOwner,
  authorize,
  authorizeOwner,
  canAuthorize,
} from '@server/domain/authorization-context'
import { forbidden, unauthorized } from '@server/domain/errors'
import { resolveOrganizationUserAuthorizationContext } from '@server/usecases/organization-membership-scopes'
import { requirePlatformOrganization } from '@server/usecases/system-resources'
import { type ProtectedResource, requiredResourceScope } from '@shared/authz'
import type { RealmrootOrganizationScope } from '@shared/scope-registry'
import type { Context, MiddlewareHandler } from 'hono'
import { getPrincipal } from './authn'
import { getDeps } from './deps'

export function authz(resource: ProtectedResource): MiddlewareHandler {
  return async (c, next) => {
    const { user, agent, application } = getPrincipal(c)
    if (!user && !agent && !application) throw unauthorized()
    if (agent || application) {
      const required = requiredResourceScope(c.req.method, resource)
      if (!required || !(agent ?? application)!.scopes.includes(required)) {
        throw forbidden(required ? `OAuth scope "${required}" is required.` : 'This resource is read-only.')
      }
    }
    await next()
  }
}

export function requireAgentScope(c: Context, requiredScope: string) {
  const agent = getPrincipal(c).agent
  if (!agent) throw unauthorized('An OAuth-authenticated Agent is required.')
  if (!agent.scopes.includes(requiredScope)) {
    throw forbidden(`OAuth scope "${requiredScope}" is required.`)
  }
}

export async function authorizeOrganization(
  c: Context,
  organizationId: string,
  requiredScope: RealmrootOrganizationScope,
) {
  const target = organizationBoundary(organizationId)
  authorize(await resolveAuthorizationContext(c, target), target, requiredScope)
}

export async function authorizeOrganizationOwner(
  c: Context,
  organizationId: string,
  requiredScope: RealmrootOrganizationScope,
): Promise<AuthorizedOwner> {
  const target = organizationBoundary(organizationId)
  return authorizeOwner(await resolveAuthorizationContext(c, target), target, requiredScope)
}

export function authorizedOrganizationOwnerId(owner: AuthorizedOwner) {
  if (owner.type === 'organization') return owner.id
  throw new Error('Only an Organization tenant can own an Organization-owned resource.')
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
  const platform = await requirePlatformOrganization(getDeps(c))
  if (
    canAuthorize(await resolvePlatformOrganizationContext(c, platform.id), platformBoundary(platform.id), requiredScope)
  ) {
    return undefined
  }
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
  if (principal.application) {
    if (!principal.application.scopes.includes(requiredScope)) {
      throw forbidden(`OAuth scope "${requiredScope}" is required.`)
    }
    return [{ type: 'organization', id: principal.application.ownerOrganizationId }]
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

export async function authorizePlatformOrganization(c: Context, requiredScope: RealmrootOrganizationScope) {
  await authorizeOrganization(c, (await requirePlatformOrganization(getDeps(c))).id, requiredScope)
}

export async function hasPlatformOrganizationAccess(c: Context, requiredScope: RealmrootOrganizationScope) {
  const platform = await requirePlatformOrganization(getDeps(c))
  const target = platformBoundary(platform.id)
  return canAuthorize(await resolvePlatformOrganizationContext(c, platform.id), target, requiredScope)
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
    const platformContext = await resolvePlatformOrganizationContext(c)
    if (targetTenant.type === 'user') {
      const scopes = new Set(platformContext.scopes)
      if (principal.user.id === targetTenant.id) {
        for (const scope of ['self:read', 'self:write', 'agents:read', 'agents:write', 'audit-events:read']) {
          scopes.add(scope)
        }
      }
      return restrictUserContextToApplicationScopes(principal, {
        subject: { type: 'user', id: principal.user.id },
        tenant: platformContext.scopes.size > 0 ? targetTenant : { type: 'user', id: principal.user.id },
        scopes,
      })
    }
    if (platformContext.scopes.size > 0) return { ...platformContext, tenant: targetTenant }
    return restrictUserContextToApplicationScopes(
      principal,
      await resolveOrganizationUserAuthorizationContext(getDeps(c), targetTenant.id, principal.user.id),
    )
  }
  if (principal.application) {
    return {
      subject: { type: 'application', id: principal.application.id },
      tenant: {
        type: 'organization',
        id: principal.application.ownerOrganizationId,
      },
      scopes: new Set(principal.application.scopes),
    }
  }
  const agent = principal.agent
  if (!agent) throw unauthorized()
  const authority = agent.authority
  const platform = await requirePlatformOrganization(getDeps(c))
  if (authority?.kind === 'organization' && authority.organizationId === platform.id) {
    return {
      subject: { type: 'agent', id: agent.identityId },
      tenant: targetTenant,
      scopes: new Set(agent.scopes),
    }
  }
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

function organizationBoundary(organizationId: string): AuthorizationTenant {
  return { type: 'organization', id: organizationId }
}

function platformBoundary(platformOrganizationId: string): AuthorizationTenant {
  return organizationBoundary(platformOrganizationId)
}

async function resolvePlatformOrganizationContext(
  c: Context,
  platformOrganizationId?: string,
): Promise<AuthorizationContext> {
  const platformId = platformOrganizationId ?? (await requirePlatformOrganization(getDeps(c))).id
  const principal = getPrincipal(c)
  if (principal.user) {
    return restrictUserContextToApplicationScopes(
      principal,
      await resolveOrganizationUserAuthorizationContext(getDeps(c), platformId, principal.user.id),
    )
  }
  if (principal.application) {
    return {
      subject: { type: 'application', id: principal.application.id },
      tenant: {
        type: 'organization',
        id: principal.application.ownerOrganizationId,
      },
      scopes:
        principal.application.ownerOrganizationId === platformId ? new Set(principal.application.scopes) : new Set(),
    }
  }
  const agent = principal.agent
  if (agent?.authority?.kind === 'organization' && agent.authority.organizationId === platformId) {
    return {
      subject: { type: 'agent', id: agent.identityId },
      tenant: platformBoundary(platformId),
      scopes: new Set(agent.scopes),
    }
  }
  if (!agent) throw unauthorized()
  return {
    subject: { type: 'agent', id: agent.identityId },
    tenant: platformBoundary(platformId),
    scopes: new Set(),
  }
}

function restrictUserContextToApplicationScopes(
  principal: ReturnType<typeof getPrincipal>,
  context: AuthorizationContext,
): AuthorizationContext {
  if (!principal.application) return context
  const applicationScopes = new Set(principal.application.scopes)
  return {
    ...context,
    scopes: new Set([...context.scopes].filter((scope) => applicationScopes.has(scope))),
  }
}

export function authenticatedUser(): MiddlewareHandler {
  return async (c, next) => {
    if (!getPrincipal(c).user) throw unauthorized()
    await next()
  }
}
