import { forbidden, unauthorized } from '@server/domain/errors'
import { resolveDeveloperAccess } from '@server/usecases/developer-access'
import { type ProtectedResource, requiredResourceCapability } from '@shared/authz'
import type { MiddlewareHandler } from 'hono'
import { getPrincipal } from './authn'
import { getDeps } from './deps'

declare module 'hono' {
  interface ContextVariableMap {
    consoleOrganizationIds: string[] | null
  }
}

export function authz(resource: ProtectedResource): MiddlewareHandler {
  return async (c, next) => {
    const { user, agent } = getPrincipal(c)
    if (!user && !agent) throw unauthorized()

    if (user) {
      if (hasRole(user.role, 'admin')) {
        c.set('consoleOrganizationIds', null)
        await next()
        return
      }
      const deps = getDeps(c)
      const access = await resolveDeveloperAccess(deps, await deps.users.getUser(user.id))
      const organizationIds = access.consoleOrganizations.map((item) => item.organizationId)
      if (!organizationIds.length || !developerResourceAllowed(c.req.method, c.req.path, resource)) throw forbidden()
      c.set('consoleOrganizationIds', organizationIds)
      await next()
      return
    }

    const required = requiredResourceCapability(c.req.method, resource)
    if (!required || !agent!.capabilities.includes(required)) {
      throw forbidden(required ? `Agent capability "${required}" is required.` : 'This resource is read-only.')
    }

    await next()
  }
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
  return resource === 'roles' && path.startsWith('/api/role-assignments')
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
