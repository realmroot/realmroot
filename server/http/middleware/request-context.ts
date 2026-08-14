import type { Context, MiddlewareHandler } from 'hono'
import { readCorrelationId } from '../correlation'

export interface RequestContext {
  id: string
  correlationId: string
  startedAt: number
}

declare module 'hono' {
  interface ContextVariableMap {
    requestContext: RequestContext
  }
}

export const requestContext = (): MiddlewareHandler => async (c, next) => {
  const id = c.req.header('cf-ray') || crypto.randomUUID()
  c.set('requestContext', {
    id,
    correlationId: readCorrelationId(c.req.header('x-correlation-id')) ?? id,
    startedAt: Date.now(),
  })

  c.header('Request-Id', id)

  await next()
}

export function getRequestContext(c: Context): RequestContext {
  return c.get('requestContext')
}
