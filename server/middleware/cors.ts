import type { MiddlewareHandler } from 'hono'
import { forbidden } from '../lib/errors'

const corsMethods = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
const corsHeaders = 'authorization,content-type'

export function trustedOriginCors(trustedOrigins: string[]): MiddlewareHandler {
  const allowedOrigins = new Set(trustedOrigins)

  return async (c, next) => {
    const origin = c.req.header('origin')

    if (!origin) {
      await next()
      return
    }

    if (!allowedOrigins.has(origin)) {
      throw forbidden('Origin is not trusted for this issuer.')
    }

    c.header('Access-Control-Allow-Origin', origin)
    c.header('Access-Control-Allow-Credentials', 'true')
    c.header('Vary', 'Origin')

    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', corsMethods)
      c.header('Access-Control-Allow-Headers', c.req.header('access-control-request-headers') || corsHeaders)
      return c.body(null, 204)
    }

    await next()
  }
}
