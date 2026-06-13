import { forbidden, unauthorized } from '@server/domain/errors'
import { systemCliClientId } from '@shared/api/applications'
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
  bearer?: {
    clientId: string | null
    scopes: string[]
  } | null
}

export interface SessionReader {
  handler?: (request: Request) => Promise<Response>
  api: {
    getSession: (context: { headers: Headers; asResponse: false }) => Promise<AuthSessionResult | null>
    oauth2UserInfo?: (context: { headers: Headers; asResponse: false }) => Promise<OAuthUserInfo>
  }
}

interface OAuthUserInfo {
  sub: string
  email?: string
  name?: string
  picture?: string
  role?: string | null
  scope?: string
  client_id?: string
  authorization?: {
    roles?: unknown
  }
  roles?: unknown
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

export function managementBearerAuth(auth: SessionReader): MiddlewareHandler {
  return async (c, next) => {
    const token = bearerToken(c.req.raw.headers)
    if (!token) {
      await next()
      return
    }

    const userInfo = await readOAuthUserInfo(auth, c)

    const scopes = scopeList(userInfo.scope)
    const clientId = userInfo.client_id ?? null
    if (clientId !== systemCliClientId) {
      throw forbidden()
    }
    if (!hasRequiredManagementScope(c.req.method, scopes)) {
      throw forbidden()
    }

    c.set('authContext', {
      session: null,
      user: {
        id: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name ?? null,
        image: userInfo.picture ?? null,
        role: managementRole(userInfo),
      },
      bearer: {
        clientId,
        scopes,
      },
    })

    await next()
  }
}

async function readOAuthUserInfo(auth: SessionReader, c: Context) {
  if (auth.handler) {
    const url = new URL('/api/auth/oauth2/userinfo', c.req.url)
    try {
      const response = await auth.handler(new Request(url, { headers: c.req.raw.headers }))
      if (!response.ok) throw unauthorized('Invalid bearer token.')
      return (await response.json()) as OAuthUserInfo
    } catch {
      throw unauthorized('Invalid bearer token.')
    }
  }

  if (!auth.api.oauth2UserInfo) {
    throw unauthorized('Invalid bearer token.')
  }

  try {
    return await auth.api.oauth2UserInfo({ headers: c.req.raw.headers, asResponse: false })
  } catch {
    throw unauthorized('Invalid bearer token.')
  }
}

function bearerToken(headers: Headers) {
  const authorization = headers.get('authorization')
  if (!authorization) return null
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  if (!match?.[1]) {
    throw unauthorized('Invalid bearer token.')
  }
  return match[1]
}

function scopeList(scope: string | undefined) {
  return (scope ?? '').split(/\s+/).filter(Boolean)
}

function hasRequiredManagementScope(method: string, scopes: string[]) {
  if (method === 'GET' || method === 'HEAD') {
    return scopes.includes('management:read') || scopes.includes('management:write')
  }
  return scopes.includes('management:write')
}

function managementRole(userInfo: OAuthUserInfo) {
  if (userInfo.role === 'admin') return 'admin'
  if (stringList(userInfo.authorization?.roles).includes('admin') || stringList(userInfo.roles).includes('admin')) {
    return 'admin'
  }
  return userInfo.role ?? null
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
