import { forbidden } from '@server/domain/errors'
import type { Context, MiddlewareHandler } from 'hono'

const corsMethods = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
const corsHeaders = 'authorization,content-type'

interface TrustedOriginCorsOptions {
  isPublicPath?: (path: string) => boolean
  resolveAllowedOrigins?: (context: { path: string; context: Context }) => Promise<string[]>
}

export function trustedOriginCors(trustedOrigins: string[], options: TrustedOriginCorsOptions = {}): MiddlewareHandler {
  const allowedOrigins = new Set(trustedOrigins)

  return async (c, next) => {
    const origin = c.req.header('origin')

    if (!origin) {
      await next()
      return
    }

    if (options.isPublicPath?.(c.req.path)) {
      const setPublicCorsHeaders = () => {
        c.header('Access-Control-Allow-Origin', origin)
        c.header('Vary', 'Origin')
      }

      setPublicCorsHeaders()

      if (c.req.method === 'OPTIONS') {
        c.header('Access-Control-Allow-Methods', 'GET,OPTIONS')
        c.header('Access-Control-Allow-Headers', c.req.header('access-control-request-headers') || corsHeaders)
        return c.body(null, 204)
      }

      await next()
      setPublicCorsHeaders()
      return
    }

    const dynamicOrigins = allowedOrigins.has(origin)
      ? []
      : await (options.resolveAllowedOrigins?.({ path: c.req.path, context: c }) ?? [])

    if (!allowedOrigins.has(origin) && !dynamicOrigins.includes(origin)) {
      throw forbidden('Origin is not trusted for this issuer.')
    }

    const setCorsHeaders = () => {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Access-Control-Allow-Credentials', 'true')
      c.header('Vary', 'Origin')
    }

    setCorsHeaders()

    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', corsMethods)
      c.header('Access-Control-Allow-Headers', c.req.header('access-control-request-headers') || corsHeaders)
      return c.body(null, 204)
    }

    await next()
    setCorsHeaders()
  }
}
