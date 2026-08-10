import { forbidden, unauthorized } from '@server/domain/errors'
import type { MutationActor } from '@server/domain/mutation-actor'
import type { ProtocolAgentSession } from '@server/usecases/agent-session'
import type { Deps } from '@server/usecases/deps'
import { validateDpopResourceProof } from '@server/usecases/dpop'
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
  application?: {
    id: string
    clientId: string
    ownerOrganizationId: string
    scopes: string[]
  } | null
  agent?: {
    issuer: string
    subject: string
    identityId: string
    protocolAgentId: string
    hostId: string
    scopes: string[]
    authority: { kind: 'organization'; organizationId: string } | { kind: 'user'; userId: string } | null
  } | null
}

export interface SessionReader {
  api: {
    getSession: (context: { headers: Headers; asResponse: false }) => Promise<AuthSessionResult | null>
    getAgentSession?: (context: { headers: Headers; asResponse: false }) => Promise<ProtocolAgentSession | null>
    verifyJWT?: (context: {
      body: { token: string; issuer?: string; audience?: string | string[] }
      asResponse?: false
    }) => Promise<{ payload: Record<string, unknown> | null }>
  }
}

declare module 'hono' {
  interface ContextVariableMap {
    principal: PrincipalContext
  }
}

interface AuthnOptions {
  allowAgent?: boolean
  allowApplication?: boolean
  oauth?: {
    issuer(requestUrl: string): string
    audience(requestUrl: string): string
    resourceRequestUrl(requestUrl: string): string
  }
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
      c.set('principal', { session, user, application: null, agent: null })
      await next()
      return
    }

    if (options.allowAgent) {
      const agent =
        current?.agent ??
        (options.oauth ? await authenticateOAuthAgent(auth, c, options.oauth) : await authenticateAgent(auth, c))
      if (agent) {
        c.set('principal', { session: null, user: null, application: null, agent })
        await next()
        return
      }
    }

    if (options.allowApplication && options.oauth) {
      const application = current?.application ?? (await authenticateOAuthApplication(auth, c, options.oauth))
      if (application) {
        c.set('principal', { session: null, user: null, application, agent: null })
        await next()
        return
      }
    }

    c.set('principal', { session, user: null, application: null, agent: null })
    if (options.required) throw unauthorized()
    await next()
  }
}

async function authenticateOAuthApplication(
  auth: SessionReader,
  c: Context,
  oauth: NonNullable<AuthnOptions['oauth']>,
): Promise<NonNullable<PrincipalContext['application']> | null> {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('DPoP ')) return null
  if (!auth.api.verifyJWT) throw unauthorized('OAuth access-token verification is unavailable.')
  const accessToken = authorization.slice('DPoP '.length).trim()
  const issuer = oauth.issuer(c.req.url)
  const audience = oauth.audience(c.req.url)
  const verified = await auth.api
    .verifyJWT({ body: { token: accessToken, issuer, audience }, asResponse: false })
    .catch(() => null)
  const payload = verified?.payload
  if (!payload) throw unauthorized('OAuth access token is invalid.')
  const applicationId = stringClaim(payload, 'sub')
  const clientId = stringClaim(payload, 'client_id')
  const confirmationJkt = objectStringClaim(payload, 'cnf', 'jkt')
  const proof = c.req.header('DPoP')
  if (
    stringClaim(payload, 'sub_profile') !== 'application' ||
    !applicationId ||
    !clientId ||
    !confirmationJkt ||
    !proof
  ) {
    throw unauthorized('OAuth access token is missing its Application or DPoP binding.')
  }
  await validateDpopResourceProof(c.get('deps') as Deps, {
    proof,
    accessToken,
    method: c.req.method,
    url: oauth.resourceRequestUrl(c.req.url),
    confirmationJkt,
  }).catch((error: unknown) => {
    throw unauthorized(error instanceof Error ? error.message : 'DPoP proof is invalid.')
  })
  const application = await (c.get('deps') as Deps).applications.findByClientId(clientId)
  if (!application || application.disabled || application.id !== applicationId) {
    throw forbidden('The OAuth token does not belong to an active Application.')
  }
  return {
    id: application.id,
    clientId: application.clientId,
    ownerOrganizationId: application.ownerOrganizationId,
    scopes: scopeClaim(payload),
  }
}

async function authenticateOAuthAgent(
  auth: SessionReader,
  c: Context,
  oauth: NonNullable<AuthnOptions['oauth']>,
): Promise<NonNullable<PrincipalContext['agent']> | null> {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('DPoP ')) return null
  if (!auth.api.verifyJWT) throw unauthorized('OAuth access-token verification is unavailable.')
  const accessToken = authorization.slice('DPoP '.length).trim()
  const issuer = oauth.issuer(c.req.url)
  const audience = oauth.audience(c.req.url)
  const verified = await auth.api
    .verifyJWT({ body: { token: accessToken, issuer, audience }, asResponse: false })
    .catch(() => null)
  const payload = verified?.payload
  if (!payload) throw unauthorized('OAuth access token is invalid.')
  const subject = stringClaim(payload, 'sub')
  const protocolAgentId = stringClaim(payload, 'client_id')
  const hostId = stringClaim(payload, 'host_id')
  const confirmationJkt = objectStringClaim(payload, 'cnf', 'jkt')
  const proof = c.req.header('DPoP')
  if (!subject || !protocolAgentId || !hostId || !confirmationJkt || !proof) {
    throw unauthorized('OAuth access token is missing its Agent or DPoP binding.')
  }
  await validateDpopResourceProof(c.get('deps') as Deps, {
    proof,
    accessToken,
    method: c.req.method,
    url: oauth.resourceRequestUrl(c.req.url),
    confirmationJkt,
  }).catch((error: unknown) => {
    throw unauthorized(error instanceof Error ? error.message : 'DPoP proof is invalid.')
  })
  const aggregate = await (c.get('deps') as Deps).agentIdentities.findActiveByProtocolAgent(protocolAgentId)
  const binding = aggregate?.bindings.find(
    (candidate) =>
      candidate.protocolAgentId === protocolAgentId && candidate.hostId === hostId && candidate.status === 'active',
  )
  if (!aggregate || !binding || aggregate.identity.issuer !== issuer || aggregate.identity.subject !== subject) {
    throw forbidden('The OAuth token does not belong to an active Agent identity and Host binding.')
  }
  const scopes = typeof payload.scope === 'string' ? [...new Set(payload.scope.split(/\s+/).filter(Boolean))] : []
  const authority = authorityClaim(payload.realmroot_authority)
  return {
    issuer,
    subject,
    identityId: aggregate.identity.id,
    protocolAgentId,
    hostId,
    scopes,
    authority,
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
    scopes: [],
    authority: null,
  }
}

function authorityClaim(value: unknown): NonNullable<PrincipalContext['agent']>['authority'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const detail = value as Record<string, unknown>
  if (detail.type !== 'realmroot_authority' || typeof detail.id !== 'string') return null
  if (detail.authority === 'organization') return { kind: 'organization', organizationId: detail.id }
  if (detail.authority === 'user') return { kind: 'user', userId: detail.id }
  return null
}

function stringClaim(payload: Record<string, unknown>, name: string) {
  return typeof payload[name] === 'string' ? payload[name] : null
}

function objectStringClaim(payload: Record<string, unknown>, objectName: string, memberName: string) {
  const value = payload[objectName]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const member = (value as Record<string, unknown>)[memberName]
  return typeof member === 'string' ? member : null
}

function scopeClaim(payload: Record<string, unknown>) {
  return typeof payload.scope === 'string' ? [...new Set(payload.scope.split(/\s+/).filter(Boolean))] : []
}

export function getPrincipal(c: Context): PrincipalContext {
  return c.get('principal') ?? { session: null, user: null, application: null, agent: null }
}

export function getActorUserId(c: Context): string | null {
  return getPrincipal(c).user?.id ?? null
}

export function getMutationActor(c: Context): MutationActor {
  const principal = getPrincipal(c)
  return {
    controllerUserId: principal.user?.id ?? null,
    agent: principal.agent
      ? {
          issuer: principal.agent.issuer,
          subject: principal.agent.subject,
          identityId: principal.agent.identityId,
          hostId: principal.agent.hostId,
        }
      : null,
  }
}

export function isAutomationPrincipal(c: Context) {
  return Boolean(getPrincipal(c).agent)
}
