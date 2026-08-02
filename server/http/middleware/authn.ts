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
  activeOrganizationId?: string | null
}

export interface AuthSessionResult {
  session: AuthSession
  user?: AuthUser
}

export interface PrincipalContext {
  session: AuthSessionResult | null
  user: AuthUser | null
  agent?: {
    issuer: string
    subject: string
    identityId: string
    protocolAgentId: string
    hostId: string
    capabilities: string[]
  } | null
}

export interface SessionReader {
  api: {
    getSession: (context: { headers: Headers; asResponse: false }) => Promise<AuthSessionResult | null>
    getAgentSession?: (context: { headers: Headers; asResponse: false }) => Promise<ProtocolAgentSession | null>
  }
}

declare module 'hono' {
  interface ContextVariableMap {
    principal: PrincipalContext
  }
}

interface AuthnOptions {
  allowAgent?: boolean
  required?: boolean
}

export function authn(auth: SessionReader, options: AuthnOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const current = c.get('principal')
    const session =
      current?.session === undefined
        ? await auth.api.getSession({ headers: c.req.raw.headers, asResponse: false })
        : current.session
    const user = current?.user === undefined ? (session?.user ?? null) : current.user

    if (user) {
      c.set('principal', { session, user, agent: null })
      await next()
      return
    }

    if (options.allowAgent) {
      const agent = current?.agent ?? (await authenticateAgent(auth, c))
      if (agent) {
        c.set('principal', { session: null, user: null, agent })
        await next()
        return
      }
    }

    c.set('principal', { session, user: null, agent: null })
    if (options.required) throw unauthorized()
    await next()
  }
}

async function authenticateAgent(
  auth: SessionReader,
  c: Context,
): Promise<NonNullable<PrincipalContext['agent']> | null> {
  if (!auth.api.getAgentSession) return null

  const session = await auth.api
    .getAgentSession({ headers: c.req.raw.headers, asResponse: false })
    .catch((error: unknown) => {
      throw toBoundaryError(error)
    })
  if (!session) return null

  const deps = c.get('deps') as Deps
  const identity = await deps.agentIdentities.findActiveByProtocolAgent(session.agent.id)
  const binding = identity?.bindings.find(
    (candidate) =>
      candidate.protocolAgentId === session.agent.id &&
      candidate.hostId === session.agent.hostId &&
      candidate.status === 'active',
  )
  if (!identity || !binding) throw forbidden('The Agent host is not bound to an active Agent identity.')

  return {
    issuer: identity.identity.issuer,
    subject: identity.identity.subject,
    identityId: identity.identity.id,
    protocolAgentId: session.agent.id,
    hostId: session.agent.hostId,
    capabilities: [
      ...new Set(
        (session.agent.capabilityGrants ?? [])
          .filter((grant) => grant.status === 'active')
          .map((grant) => grant.capability),
      ),
    ],
  }
}

export function getPrincipal(c: Context): PrincipalContext {
  return c.get('principal') ?? { session: null, user: null, agent: null }
}

export function getActorUserId(c: Context): string | null {
  return getPrincipal(c).user?.id ?? null
}

export function isAutomationPrincipal(c: Context) {
  return Boolean(getPrincipal(c).agent)
}
