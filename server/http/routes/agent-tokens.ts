import { forbidden, unauthorized } from '@server/domain/errors'
import { proxyAgentEgress } from '@server/usecases/agent-egress'
import {
  createAgentEnrollmentIntent,
  createAgentLoginIdentity,
  getAgentIdentityByProtocolAgent,
} from '@server/usecases/agent-identities'
import { getAgentJwks, issueAgentAccessToken, type ProtocolAgentSession } from '@server/usecases/agent-tokens'
import {
  agentProtocolEnrollmentIntentResponseSchema,
  agentProtocolIdentityResponseSchema,
  agentTokenRequestSchema,
  createAgentLoginIdentityRequestSchema,
  createAgentProtocolEnrollmentIntentRequestSchema,
} from '@shared/api/agents'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { toBoundaryError } from './auth-api'
import { readJson } from './validation'

interface AgentSessionApi {
  getAgentSession?: (context: { headers: Headers; asResponse: false }) => Promise<ProtocolAgentSession | null>
}

export function createAgentTokenRoutes(authApi: AgentSessionApi, agentIdentityIssuer?: string) {
  const app = new Hono()

  app.get('/jwks', async (c) => c.json(await getAgentJwks(getDeps(c))))

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
      agentIdentityIssuer ?? new URL(c.req.url).origin,
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

  app.post('/oauth2/token', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    return c.json(
      await issueAgentAccessToken(getDeps(c), c.req.raw, await readJson(c, agentTokenRequestSchema), session),
    )
  })

  app.all('/egress/:externalAccountId/*', async (c) => {
    const externalAccountId = c.req.param('externalAccountId')
    const routePrefix = `/api/agent/egress/${externalAccountId}`
    const relativePath = new URL(c.req.url).pathname.slice(routePrefix.length) || '/'
    return proxyAgentEgress(getDeps(c), c.req.raw, externalAccountId, relativePath)
  })

  return app
}

async function requireAgentSession(authApi: AgentSessionApi, headers: Headers): Promise<ProtocolAgentSession> {
  if (!authApi.getAgentSession) throw unauthorized('Agent authentication is unavailable.')
  const session = await authApi.getAgentSession({ headers, asResponse: false }).catch((error: unknown) => {
    throw toBoundaryError(error)
  })
  if (!session) throw unauthorized('An active Agent protocol session is required.')
  return session
}
