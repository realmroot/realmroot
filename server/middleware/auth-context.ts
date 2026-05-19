import type { Context, MiddlewareHandler } from 'hono'

export interface AuthUser {
  id: string
  email?: string
  name?: string | null
  username?: string | null
  image?: string | null
  role?: string | null
}

export interface AuthSession {
  id: string
}

export interface AuthSessionResult {
  session: AuthSession
  user?: AuthUser
}

export interface AuthContext {
  session: AuthSessionResult | null
  user: AuthUser | null
}

export interface SessionReader {
  api: {
    getSession: (context: { headers: Headers; asResponse: false }) => Promise<AuthSessionResult | null>
  }
}

declare module 'hono' {
  interface ContextVariableMap {
    authContext: AuthContext
  }
}

export function authContext(auth: SessionReader): MiddlewareHandler {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers, asResponse: false })
    c.set('authContext', {
      session,
      user: session?.user ?? null,
    })
    await next()
  }
}

export function getAuthContext(c: Context): AuthContext {
  return c.get('authContext') ?? { session: null, user: null }
}
