import { forbidden, unauthorized } from '@server/domain/errors'
import {
  authorizesManagementOwner,
  type ManagementActor,
  type ManagementAuthorization,
  type ManagementBoundary,
  type ManagementOwner,
  organizationIdsForBoundary,
  ownerFilterForBoundary,
} from '@server/domain/management-authorization'
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
    managementAuthorization: ManagementAuthorization
  }
}

export function authz(resource: ProtectedResource): MiddlewareHandler {
  return async (c, next) => {
    const principal = getPrincipal(c)
    if (!principal.user && !principal.agent) throw unauthorized()

    const selfServiceCapability = requiredAgentSelfServiceScope(c.req.method, c.req.path)
    const capability = selfServiceCapability ?? requiredResourceScope(c.req.method, resource)
    if (!capability) throw forbidden('This resource is read-only.')

    const { actor, boundary } = await resolveAuthorizationInputs(c, capability, resource)
    c.set('managementAuthorization', {
      actor,
      boundary,
      policy: { capability, ownerKinds: ['realm', 'organization', 'account'] },
    })

    if (actor.kind === 'agent' && !actor.capabilities.includes(capability)) {
      throw forbidden(`OAuth scope "${capability}" is required.`)
    }
    if (
      actor.kind === 'agent' &&
      !selfServiceCapability &&
      isProtectedResourceScope(capability) &&
      !principal.agent!.authority
    ) {
      throw forbidden('A Realmroot authority Resource is required for management scopes.')
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

export function getManagementAuthorization(c: Parameters<typeof getPrincipal>[0]) {
  return c.get('managementAuthorization')
}

export function requireManagementOwner(c: Parameters<typeof getPrincipal>[0], owner: ManagementOwner) {
  if (!authorizesManagementOwner(getManagementAuthorization(c), owner)) throw forbidden()
}

export function requireManagementOrganization(c: Parameters<typeof getPrincipal>[0], organizationId: string) {
  requireManagementOwner(c, { kind: 'organization', organizationId })
}

export function requireManagementOrganizationOwner(
  c: Parameters<typeof getPrincipal>[0],
  organizationId: string | null | undefined,
) {
  requireManagementOwner(c, organizationId ? { kind: 'organization', organizationId } : { kind: 'realm' })
}

export function requireManagementRealm(c: Parameters<typeof getPrincipal>[0]) {
  requireManagementOwner(c, { kind: 'realm' })
}

export function managementOrganizationIds(c: Parameters<typeof getPrincipal>[0], requestedOrganizationId?: string) {
  return organizationIdsForBoundary(getManagementAuthorization(c).boundary, requestedOrganizationId)
}

export function managementOwnerFilter(c: Parameters<typeof getPrincipal>[0], requestedOrganizationId?: string) {
  return ownerFilterForBoundary(getManagementAuthorization(c).boundary, requestedOrganizationId)
}

export async function requireManagementUser(c: Parameters<typeof getPrincipal>[0], userId: string) {
  const { boundary } = getManagementAuthorization(c)
  if (boundary.kind === 'realm') {
    requireManagementOwner(c, { kind: 'realm' })
    return
  }
  if (boundary.kind === 'account') {
    requireManagementOwner(c, { kind: 'account', accountId: userId })
    return
  }
  const allowedUserIds = await getDeps(c).authorization.listMemberUserIds([...boundary.organizationIds])
  if (!allowedUserIds.includes(userId)) throw forbidden()
}

async function resolveAuthorizationInputs(
  c: Parameters<typeof getPrincipal>[0],
  capability: string,
  resource: ProtectedResource,
): Promise<{ actor: ManagementActor; boundary: ManagementBoundary }> {
  const principal = getPrincipal(c)
  if (principal.agent) {
    const actor: ManagementActor = {
      kind: 'agent',
      identityId: principal.agent.identityId,
      issuer: principal.agent.issuer,
      subject: principal.agent.subject,
      capabilities: principal.agent.scopes,
    }
    if (principal.agent.authority?.kind === 'realm') return { actor, boundary: { kind: 'realm' } }
    if (principal.agent.authority?.kind === 'organization') {
      return {
        actor,
        boundary: { kind: 'organization', organizationIds: [principal.agent.authority.organizationId] },
      }
    }
    if (principal.agent.authority?.kind === 'account') {
      return { actor, boundary: { kind: 'account', accountId: principal.agent.authority.userId } }
    }
    return {
      actor,
      boundary:
        principal.agent.owner.kind === 'account'
          ? { kind: 'account', accountId: principal.agent.owner.accountId }
          : { kind: 'organization', organizationIds: [principal.agent.owner.organizationId] },
    }
  }

  const user = principal.user!
  const actor: ManagementActor = { kind: 'session', userId: user.id, capabilities: [capability] }
  if (hasRole(user.role, 'admin')) return { actor, boundary: { kind: 'realm' } }
  const access = await resolveDeveloperAccess(getDeps(c), await getDeps(c).users.getUser(user.id))
  if (access.consoleOrganizations.length && developerResourceAllowed(c.req.method, c.req.path, resource)) {
    return {
      actor,
      boundary: {
        kind: 'organization',
        organizationIds: access.consoleOrganizations.map((item) => item.organizationId),
      },
    }
  }
  if (!accountAuthorityReadAllowed(c.req.method, c.req.path)) throw forbidden()
  const requestedOrganizationId = new URL(c.req.url).searchParams.get('organizationId')
  if (
    requestedOrganizationId &&
    (await getDeps(c).authorization.findMemberByOrganizationUser(requestedOrganizationId, user.id))
  ) {
    return { actor, boundary: { kind: 'organization', organizationIds: [requestedOrganizationId] } }
  }
  return { actor, boundary: { kind: 'account', accountId: user.id } }
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
    path === '/api/agents' ||
    /^\/api\/agents\/[^/]+(?:\/installations)?$/.test(path) ||
    path === '/api/access/requests' ||
    /^\/api\/access\/requests\/[^/]+(?:\/decision)?$/.test(path) ||
    path === '/api/access/authorizations' ||
    /^\/api\/access\/authorizations\/[^/]+(?:\/revocation)?$/.test(path) ||
    path === '/api/access/assignments' ||
    /^\/api\/access\/assignments\/[^/]+$/.test(path) ||
    /^\/api\/access\/roles\/[^/]+(?:\/scopes)?$/.test(path)
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
