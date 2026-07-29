import { forbidden, unauthorized } from '@server/domain/errors'
import {
  createAgentEnrollmentIntent,
  createAgentLoginIdentity,
  getAgentIdentityByProtocolAgent,
} from '@server/usecases/agent-identities'
import type { ProtocolAgentSession } from '@server/usecases/agent-tokens'
import type { Deps } from '@server/usecases/deps'
import {
  createAgentAccessRequest,
  discoverAgentResources,
  getAgentAccessRequest,
  issueExternalTokenLease,
} from '@server/usecases/external-resources'
import {
  agentProtocolEnrollmentIntentResponseSchema,
  agentProtocolIdentityResponseSchema,
  createAgentLoginIdentityRequestSchema,
  createAgentProtocolEnrollmentIntentRequestSchema,
} from '@shared/api/agents'
import {
  agentAccessRequestSchema,
  agentResourceDiscoverySchema,
  createAgentAccessRequestSchema,
  createExternalTokenLeaseRequestSchema,
  externalTokenLeaseSchema,
} from '@shared/api/external-resources'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { toBoundaryError } from './auth-api'
import { readJson } from './validation'

interface AgentSessionApi {
  getAgentSession?: (context: { headers: Headers; asResponse: false }) => Promise<ProtocolAgentSession | null>
  verifyJWT?: (context: {
    body: { token: string; issuer?: string; audience?: string | string[] }
    asResponse: false
  }) => Promise<{ payload: Record<string, unknown> | null }>
  signJWT?: (context: {
    body: { payload: Record<string, unknown>; overrideOptions?: { jwt?: { type?: string } } }
    asResponse: false
  }) => Promise<{ token: string }>
}

export function createAgentProtocolRoutes(authApi: AgentSessionApi, oidcIssuer?: string) {
  const app = new Hono()

  app.get('/identity', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    return c.json(
      agentProtocolIdentityResponseSchema.parse({
        identity: await getAgentIdentityByProtocolAgent(getDeps(c), session.agent.id),
      }),
    )
  })

  app.post('/identity', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    if (!session.host?.userId) {
      throw forbidden('A controller-approved delegated Agent session is required.')
    }
    const body = await readJson(c, createAgentLoginIdentityRequestSchema)
    const identity = await createAgentLoginIdentity(
      getDeps(c),
      { protocolAgentId: session.agent.id, name: body.name },
      oidcIssuer ?? new URL('/api/auth', c.req.url).toString(),
      session.host.userId,
    )
    return c.json(agentProtocolIdentityResponseSchema.parse({ identity }), 201)
  })

  app.post('/enrollment-intents', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    if (!session.host?.userId) {
      throw forbidden('A controller-approved delegated Agent session is required.')
    }
    const body = await readJson(c, createAgentProtocolEnrollmentIntentRequestSchema)
    const intent = await createAgentEnrollmentIntent(
      getDeps(c),
      { ...body, protocolAgentId: session.agent.id },
      session.host.userId,
    )
    const verificationUri = `${new URL(c.req.url).origin}/agent/identity/approve`
    return c.json(
      agentProtocolEnrollmentIntentResponseSchema.parse({
        intent,
        verification_uri: verificationUri,
        verification_uri_complete: `${verificationUri}?intent_id=${encodeURIComponent(intent.id)}`,
      }),
      202,
    )
  })

  app.get('/resources', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(agentResourceDiscoverySchema.parse(await discoverAgentResources(getDeps(c), principal)))
  })

  app.post('/access-requests', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    const result = await createAgentAccessRequest(
      getDeps(c),
      await readJson(c, createAgentAccessRequestSchema),
      principal,
      new URL(c.req.url).origin,
    )
    return c.json(agentAccessRequestSchema.parse(result), 201)
  })

  app.get('/access-requests/:requestId', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(
      agentAccessRequestSchema.parse(await getAgentAccessRequest(getDeps(c), c.req.param('requestId'), principal)),
    )
  })

  app.post('/access-requests/:requestId/token-leases', async (c) => {
    if (!authApi.signJWT) throw unauthorized('Agent assertion signing is unavailable.')
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    const input = await readJson(c, createExternalTokenLeaseRequestSchema)
    const result = await issueExternalTokenLease(getDeps(c), c.req.param('requestId'), input.dpopProof, principal, {
      sign: (payload) =>
        authApi.signJWT!({ body: { payload, overrideOptions: { jwt: { type: 'JWT' } } }, asResponse: false }).then(
          ({ token }) => token,
        ),
    })
    return c.json(externalTokenLeaseSchema.parse(result), 201)
  })

  return app
}

async function resourcePrincipal(authApi: AgentSessionApi, deps: Deps, headers: Headers) {
  const session = await requireAgentSession(authApi, headers)
  const identity = await getAgentIdentityByProtocolAgent(deps, session.agent.id)
  return {
    issuer: identity.issuer,
    subject: identity.subject,
    identityId: identity.id,
    protocolAgentId: session.agent.id,
    hostId: session.agent.hostId,
  }
}

async function requireAgentSession(authApi: AgentSessionApi, headers: Headers): Promise<ProtocolAgentSession> {
  if (!authApi.getAgentSession) throw unauthorized('Agent authentication is unavailable.')
  const session = await authApi.getAgentSession({ headers, asResponse: false }).catch((error: unknown) => {
    throw toBoundaryError(error)
  })
  if (!session) throw unauthorized('An active Agent protocol session is required.')
  return session
}
