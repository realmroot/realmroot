import { forbidden, unauthorized } from '@server/domain/errors'
import { type ProtectedResource, requiredResourceCapability } from '@shared/authz'
import type { MiddlewareHandler } from 'hono'
import { getPrincipal } from './authn'

export function authz(resource: ProtectedResource): MiddlewareHandler {
  return async (c, next) => {
    const { user, agent } = getPrincipal(c)
    if (!user && !agent) throw unauthorized()

    if (user) {
      if (!hasRole(user.role, 'admin')) throw forbidden()
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
