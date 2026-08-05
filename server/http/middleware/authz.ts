import { forbidden, unauthorized } from '@server/domain/errors'
import {
  type ManagementActor,
  type ManagementBoundary,
  type ManagementOwner,
  requireManagementOwner,
  resolveManagementOwnerFilter,
} from '@server/domain/management-authorization'
import { resolveDeveloperAccess } from '@server/usecases/developer-access'
import { protectedResourceForPath, requiredAgentSelfServiceScope } from '@shared/authz'
import { managementOperationPolicy } from '@shared/management-authorization'
import type { MiddlewareHandler } from 'hono'
import { getPrincipal } from './authn'
import { getDeps } from './deps'

declare module 'hono' {
  interface ContextVariableMap {
    managementBoundary: ManagementBoundary
    managementActor: ManagementActor
  }
}

export function authzForProtectedPath(): MiddlewareHandler {
  return async (c, next) => {
    if ((c.req.method === 'GET' || c.req.method === 'HEAD') && /^\/api\/assets\/[^/]+$/.test(c.req.path)) {
      await next()
      return
    }
    const selfServiceScope = requiredAgentSelfServiceScope(c.req.method, c.req.path)
    if (selfServiceScope) {
      const principal = getPrincipal(c).agent
      if (!principal) throw forbidden('An OAuth-authenticated Agent is required.')
      if (!principal.scopes.includes(selfServiceScope)) {
        throw forbidden(`OAuth scope "${selfServiceScope}" is required.`)
      }
      await next()
      return
    }
    const normalizedPath = c.req.path.replace(/^\/api\/?/, '')
    const policy = managementOperationPolicy(c.req.method, normalizedPath)
    if (policy) return authorizeManagement(c, policy, next)
    if (!protectedResourceForPath(normalizedPath)) {
      await next()
      return
    }
    throw new Error(`Protected operation ${c.req.method.toUpperCase()} ${c.req.path} has no authorization policy.`)
  }
}

export function getManagementBoundary(c: Parameters<typeof getPrincipal>[0]): ManagementBoundary {
  const boundary = c.get('managementBoundary')
  if (!boundary) throw new Error('Management authorization boundary was not established before route execution.')
  return boundary
}

export function getManagementActor(c: Parameters<typeof getPrincipal>[0]): ManagementActor {
  const actor = c.get('managementActor')
  if (!actor) throw new Error('Management actor was not established before route execution.')
  return actor
}

export function requireHumanManagementActor(c: Parameters<typeof getPrincipal>[0]): string {
  const actor = getManagementActor(c)
  if (actor.kind !== 'user') throw forbidden('This operation requires an authenticated human controller.')
  return actor.userId
}

export function accountManagementBoundary(userId: string): ManagementBoundary {
  return { kind: 'restricted', accountUserId: userId, organizationIds: [] }
}

export function requireManagementOrganization(c: Parameters<typeof getPrincipal>[0], organizationId: string) {
  requireManagementOwner(getManagementBoundary(c), { kind: 'organization', organizationId })
}

export function requireManagementOwnedOrganization(
  c: Parameters<typeof getPrincipal>[0],
  organizationId: string | null | undefined,
) {
  requireManagementOwner(
    getManagementBoundary(c),
    organizationId ? { kind: 'organization', organizationId } : { kind: 'realm' },
  )
}

export function requireRealmManagement(c: Parameters<typeof getPrincipal>[0]) {
  requireManagementOwner(getManagementBoundary(c), { kind: 'realm' })
}

export function resolveManagementOrganizationIds(
  c: Parameters<typeof getPrincipal>[0],
  requestedOrganizationId?: string,
): string[] | undefined {
  return resolveManagementOwnerFilter(
    getManagementBoundary(c),
    { realm: true, organization: true },
    requestedOrganizationId,
  ).ownerOrganizationIds
}

async function sessionManagementBoundary(
  c: Parameters<typeof getPrincipal>[0],
  userId: string,
  role: string | null | undefined,
  policy: NonNullable<ReturnType<typeof managementOperationPolicy>>,
): Promise<ManagementBoundary> {
  if (hasRole(role, 'admin')) {
    if (!policy.sessionAuthorities.includes('realm')) throw forbidden()
    return { kind: 'realm' }
  }

  const deps = getDeps(c)
  const access = await resolveDeveloperAccess(deps, await deps.users.getUser(userId))
  const organizationIds = policy.sessionAuthorities.includes('organization')
    ? access.consoleOrganizations.map((item) => item.organizationId)
    : []
  const accountUserId = policy.sessionAuthorities.includes('account') ? userId : null
  if (organizationIds.length || accountUserId) {
    return { kind: 'restricted', accountUserId, organizationIds }
  }
  throw forbidden()
}

async function authorizeManagement(
  c: Parameters<typeof getPrincipal>[0],
  policy: NonNullable<ReturnType<typeof managementOperationPolicy>>,
  next: () => Promise<void>,
) {
  const { user, agent } = getPrincipal(c)
  if (!user && !agent) throw unauthorized()

  if (user) {
    const boundary = await sessionManagementBoundary(c, user.id, user.role, policy)
    c.set('managementBoundary', boundary)
    c.set('managementActor', { kind: 'user', userId: user.id })
    await next()
    return
  }

  if (!agent!.scopes.includes(policy.scope)) throw forbidden(`OAuth scope "${policy.scope}" is required.`)
  if (!agent!.authority) throw forbidden('A Realmroot authority Resource is required for management scopes.')
  if (!policy.authorities.includes(agent!.authority.kind)) throw forbidden()
  if (policy.actor === 'human-controller') {
    throw forbidden('This operation requires an authenticated human controller.')
  }

  c.set('managementBoundary', boundaryFromAgentAuthority(agent!.authority))
  c.set('managementActor', {
    kind: 'agent',
    issuer: agent!.issuer,
    subject: agent!.subject,
    identityId: agent!.identityId,
    protocolAgentId: agent!.protocolAgentId,
    hostId: agent!.hostId,
    authority: ownerFromAgentAuthority(agent!.authority),
  })
  await next()
}

function boundaryFromAgentAuthority(
  authority: NonNullable<NonNullable<ReturnType<typeof getPrincipal>['agent']>['authority']>,
): ManagementBoundary {
  if (authority.kind === 'realm') return { kind: 'realm' }
  if (authority.kind === 'organization') {
    return { kind: 'restricted', accountUserId: null, organizationIds: [authority.organizationId] }
  }
  return { kind: 'restricted', accountUserId: authority.userId, organizationIds: [] }
}

function ownerFromAgentAuthority(
  authority: NonNullable<NonNullable<ReturnType<typeof getPrincipal>['agent']>['authority']>,
): ManagementOwner {
  if (authority.kind === 'realm') return { kind: 'realm' }
  if (authority.kind === 'organization') return { kind: 'organization', organizationId: authority.organizationId }
  return { kind: 'account', userId: authority.userId }
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
