import { forbidden, unauthorized } from '@server/domain/errors'
import { resolveDeveloperAccess } from '@server/usecases/developer-access'
import {
  isProtectedResourceScope,
  type ProtectedResource,
  protectedResourceForPath,
  requiredAgentSelfServiceScope,
  requiredResourceScope,
} from '@shared/authz'
import type { MiddlewareHandler } from 'hono'
import { getPrincipal } from './authn'
import { getDeps } from './deps'

declare module 'hono' {
  interface ContextVariableMap {
    consoleOrganizationIds: string[] | null
    managementAccessScope:
      | { kind: 'realm' }
      | { kind: 'organizations'; organizationIds: string[] }
      | { kind: 'account'; userId: string; organizationIds: string[] }
  }
}

export function authz(resource: ProtectedResource): MiddlewareHandler {
  return async (c, next) => {
    const { user, agent } = getPrincipal(c)
    if (!user && !agent) throw unauthorized()

    if (user) {
      if (hasRole(user.role, 'admin')) {
        c.set('consoleOrganizationIds', null)
        c.set('managementAccessScope', { kind: 'realm' })
        await next()
        return
      }
      const deps = getDeps(c)
      const access = await resolveDeveloperAccess(deps, await deps.users.getUser(user.id))
      const organizationIds = access.consoleOrganizations.map((item) => item.organizationId)
      if (organizationIds.length && developerResourceAllowed(c.req.method, c.req.path, resource)) {
        c.set('consoleOrganizationIds', organizationIds)
        c.set('managementAccessScope', { kind: 'organizations', organizationIds })
        await next()
        return
      }
      if (!accountAuthorityReadAllowed(c.req.method, c.req.path)) throw forbidden()
      const memberships = await deps.authorization.listUserMemberships(user.id)
      const activeOrganizations = await Promise.all(
        memberships.map((membership) => deps.authorization.findOrganization(membership.organizationId)),
      )
      const accountOrganizationIds = activeOrganizations.flatMap((organization) =>
        organization && !organization.disabled ? [organization.id] : [],
      )
      c.set('consoleOrganizationIds', [])
      c.set('managementAccessScope', { kind: 'account', userId: user.id, organizationIds: accountOrganizationIds })
      await next()
      return
    }

    const selfServiceScope = requiredAgentSelfServiceScope(c.req.method, c.req.path)
    const required = selfServiceScope ?? requiredResourceScope(c.req.method, resource)
    if (!required || !agent!.scopes.includes(required)) {
      throw forbidden(required ? `OAuth scope "${required}" is required.` : 'This resource is read-only.')
    }
    if (selfServiceScope || !isProtectedResourceScope(required)) {
      c.set('consoleOrganizationIds', [])
      c.set('managementAccessScope', { kind: 'account', userId: '', organizationIds: [] })
      await next()
      return
    }
    if (!agent!.authority) throw forbidden('A Realmroot authority Resource is required for management scopes.')
    if (agent!.authority.kind === 'realm') {
      c.set('consoleOrganizationIds', null)
      c.set('managementAccessScope', { kind: 'realm' })
    } else if (agent!.authority.kind === 'organization') {
      const organizationIds = [agent!.authority.organizationId]
      c.set('consoleOrganizationIds', organizationIds)
      c.set('managementAccessScope', { kind: 'organizations', organizationIds })
    } else {
      const memberships = await getDeps(c).authorization.listUserMemberships(agent!.authority.userId)
      const organizationIds = memberships.map((membership) => membership.organizationId)
      c.set('consoleOrganizationIds', [])
      c.set('managementAccessScope', {
        kind: 'account',
        userId: agent!.authority.userId,
        organizationIds,
      })
    }
    await next()
  }
}

export function authzForProtectedPath(): MiddlewareHandler {
  return async (c, next) => {
    if ((c.req.method === 'GET' || c.req.method === 'HEAD') && /^\/api\/assets\/[^/]+$/.test(c.req.path)) {
      await next()
      return
    }
    const resource = protectedResourceForPath(c.req.path.replace(/^\/api\/?/, ''))
    if (!resource) {
      await next()
      return
    }
    return authz(resource)(c, next)
  }
}

export function getManagementAccessScope(c: Parameters<typeof getPrincipal>[0]) {
  return c.get('managementAccessScope')
}

export function getConsoleOrganizationScope(c: Parameters<typeof getPrincipal>[0]) {
  return c.get('consoleOrganizationIds')
}

export function requireConsoleOrganizationAccess(c: Parameters<typeof getPrincipal>[0], organizationId: string) {
  const organizationIds = getConsoleOrganizationScope(c)
  if (organizationIds && !organizationIds.includes(organizationId)) throw forbidden()
}

export function requireConsoleOwnedOrganization(
  c: Parameters<typeof getPrincipal>[0],
  organizationId: string | null | undefined,
) {
  const organizationIds = getConsoleOrganizationScope(c)
  if (!organizationIds) return
  if (!organizationId || !organizationIds.includes(organizationId)) throw forbidden()
}

export async function requireConsoleUserAccess(c: Parameters<typeof getPrincipal>[0], userId: string) {
  const organizationIds = getConsoleOrganizationScope(c)
  if (!organizationIds) return
  const allowedUserIds = await getDeps(c).authorization.listMemberUserIds(organizationIds)
  if (!allowedUserIds.includes(userId)) throw forbidden()
}

export function requireRealmConsoleAccess(c: Parameters<typeof getPrincipal>[0]) {
  if (getConsoleOrganizationScope(c)) throw forbidden()
}

export function resolveOrganizationInventoryScope(
  c: Parameters<typeof getPrincipal>[0],
  requestedOrganizationId?: string,
) {
  const organizationIds = getConsoleOrganizationScope(c)
  if (!organizationIds) return requestedOrganizationId ? [requestedOrganizationId] : undefined
  if (!requestedOrganizationId) return organizationIds
  return organizationIds.includes(requestedOrganizationId) ? [requestedOrganizationId] : []
}

function developerResourceAllowed(method: string, path: string, resource: ProtectedResource) {
  if (method === 'GET' || method === 'HEAD') {
    return [
      'applications',
      'users',
      'organizations',
      'roles',
      'apiResources',
      'agents',
      'auditEvents',
      'connectors',
      'webhooks',
    ].includes(resource)
  }
  if (resource === 'applications' || resource === 'apiResources' || resource === 'webhooks') return true
  return resource === 'roles' && path.startsWith('/api/access/assignments')
}

function accountAuthorityReadAllowed(method: string, path: string) {
  if (method !== 'GET' && method !== 'HEAD') return false
  return (
    path === '/api/access/assignments' ||
    /^\/api\/access\/assignments\/[^/]+$/.test(path) ||
    /^\/api\/access\/roles\/[^/]+(?:\/scopes)?$/.test(path) ||
    path === '/api/access/authorizations' ||
    /^\/api\/access\/authorizations\/[^/]+$/.test(path)
  )
}

export function authenticatedUser(): MiddlewareHandler {
  return async (c, next) => {
    if (!getPrincipal(c).user) throw unauthorized()
    await next()
  }
}

function hasRole(value: string | null | undefined, required: string) {
  return (value ?? '')
    .split(',')
    .map((role) => role.trim())
    .includes(required)
}
