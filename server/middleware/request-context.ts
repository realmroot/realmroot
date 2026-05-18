import type { Context, MiddlewareHandler } from 'hono'

export interface RequestContext {
  id: string
  startedAt: number
}

declare module 'hono' {
  interface ContextVariableMap {
    requestContext: RequestContext
  }
}

export const requestContext = (): MiddlewareHandler => async (c, next) => {
  c.set('requestContext', {
    id: c.req.header('cf-ray') || crypto.randomUUID(),
    startedAt: Date.now(),
  })

  await next()
}

export function getRequestContext(c: Context): RequestContext {
  return c.get('requestContext')
}
