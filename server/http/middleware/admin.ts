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
  const { user } = getAuthContext(c)

  if (!user) {
    throw unauthorized()
  }

  if (user.role !== 'admin') {
    throw forbidden()
  }

  await next()
}
