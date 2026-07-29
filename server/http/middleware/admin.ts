import { forbidden, unauthorized } from '@server/domain/errors'
import type { MiddlewareHandler } from 'hono'
import { getAuthContext } from './auth-context'

export const requireAuth = (): MiddlewareHandler => async (c, next) => {
  const { user } = getAuthContext(c)

  if (!user) {
    throw unauthorized()
  }

  await next()
}

export const requireAdmin = (): MiddlewareHandler => async (c, next) => {
  const { user, agent } = getAuthContext(c)

  if (!user && !agent) {
    throw unauthorized()
  }

  if (agent) {
    const requiredScope = c.req.method === 'GET' || c.req.method === 'HEAD' ? 'management:read' : 'management:write'
    if (!agent.scopes.includes(requiredScope) && !agent.scopes.includes('management:*')) {
      throw forbidden(`Agent authority "${requiredScope}" is required.`)
    }
  } else if (user?.role !== 'admin') {
    throw forbidden()
  }

  await next()
}
