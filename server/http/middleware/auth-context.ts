import { forbidden, unauthorized } from '@server/domain/errors'
import type { ProtocolAgentSession } from '@server/usecases/agent-session'
import type { Deps } from '@server/usecases/deps'
import type { Context, MiddlewareHandler } from 'hono'
import { toBoundaryError } from '../routes/auth-api'

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
  agent?: {
    issuer: string
    subject: string
    identityId: string
    protocolAgentId: string
    hostId: string
    scopes: string[]
  } | null
}

export interface SessionReader {
  handler?: (request: Request) => Promise<Response>
  api: {
    getSession: (context: { headers: Headers; asResponse: false }) => Promise<AuthSessionResult | null>
    getAgentSession?: (context: { headers: Headers; asResponse: false }) => Promise<ProtocolAgentSession | null>
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

export function agentPrincipalAuth(auth: SessionReader, options: { allowSession?: boolean } = {}): MiddlewareHandler {
  return async (c, next) => {
    const current = getAuthContext(c)
    if (current.agent || (options.allowSession !== false && current.session)) {
      await next()
      return
    }
    if (!auth.api.getAgentSession) throw unauthorized('Agent authentication is unavailable.')

    const session = await auth.api
      .getAgentSession({ headers: c.req.raw.headers, asResponse: false })
      .catch((error: unknown) => {
        throw toBoundaryError(error)
      })
    if (!session) throw unauthorized('An active Agent identity is required.')

    const deps = c.get('deps') as Deps
    const identity = await deps.agentIdentities.findActiveByProtocolAgent(session.agent.id)
    const binding = identity?.bindings.find(
      (candidate) =>
        candidate.protocolAgentId === session.agent.id &&
        candidate.hostId === session.agent.hostId &&
        candidate.status === 'active',
    )
    if (!identity || !binding) throw forbidden('The Agent host is not bound to an active Agent identity.')

    const scopes = [
      ...new Set(
        (session.agent.capabilityGrants ?? [])
          .filter((grant) => grant.status === 'active' && grant.capability.startsWith('management:'))
          .map((grant) => grant.capability),
      ),
    ]

    c.set('authContext', {
      session: null,
      user: null,
      agent: {
        issuer: identity.identity.issuer,
        subject: identity.identity.subject,
        identityId: identity.identity.id,
        protocolAgentId: session.agent.id,
        hostId: session.agent.hostId,
        scopes,
      },
    })
    await next()
  }
}

export function getActorUserId(c: Context): string | null {
  return getAuthContext(c).user?.id ?? null
}

export function isAutomationPrincipal(c: Context) {
  const auth = getAuthContext(c)
  return Boolean(auth.agent)
}
