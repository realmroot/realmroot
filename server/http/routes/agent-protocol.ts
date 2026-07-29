import { forbidden, unauthorized } from '@server/domain/errors'
import { createAgentLoginIdentity, getAgentIdentityByProtocolAgent, toAgent } from '@server/usecases/agent-identities'
import type { ProtocolAgentSession } from '@server/usecases/agent-tokens'
import type { Deps } from '@server/usecases/deps'
import {
  createAccessRequest,
  getAccessRequest,
  getAgentAccessGrant,
  issueExternalAccessToken,
  listAgentAccessGrants,
  listAgentApiResources,
} from '@server/usecases/external-resources'
import {
  accessGrantSchema,
  accessGrantsResponseSchema,
  accessRequestSchema,
  agentApiResourcesResponseSchema,
  agentResponseSchema,
  createAccessRequestSchema,
  createAgentEnrollmentSchema,
  createTargetTokenSchema,
  targetTokenSchema,
} from '@shared/api/agent-api'
import { paginationQuerySchema } from '@shared/api/pagination'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { toBoundaryError } from './auth-api'
import { readJson, readQuery } from './validation'

interface AgentSessionApi {
  getAgentSession?: (context: { headers: Headers; asResponse: false }) => Promise<ProtocolAgentSession | null>
  signJWT?: (context: {
    body: { payload: Record<string, unknown>; overrideOptions?: { jwt?: { type?: string } } }
    asResponse: false
  }) => Promise<{ token: string }>
}

export function createAgentProtocolRoutes(authApi: AgentSessionApi, oidcIssuer?: string) {
  const app = new Hono()

  app.get('/', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    const identity = await getAgentIdentityByProtocolAgent(getDeps(c), session.agent.id)
    return c.json(agentResponseSchema.parse({ agent: toAgent(identity) }))
  })

  app.post('/enrollments', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    if (!session.host?.userId) {
      throw forbidden('A controller-approved delegated Agent session is required.')
    }
    const body = await readJson(c, createAgentEnrollmentSchema)
    const identity = await createAgentLoginIdentity(
      getDeps(c),
      { protocolAgentId: session.agent.id, name: body.name },
      requireOidcIssuer(),
      session.host.userId,
    )
    c.header('Location', '/api/agent')
    return c.json(agentResponseSchema.parse({ agent: toAgent(identity) }), 201)
  })

  app.get('/api-resources', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(
      agentApiResourcesResponseSchema.parse(
        await listAgentApiResources(getDeps(c), principal, readQuery(c, paginationQuerySchema)),
      ),
    )
  })

  app.post('/access-requests', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    const result = await createAccessRequest(
      getDeps(c),
      await readJson(c, createAccessRequestSchema),
      principal,
      new URL(requireOidcIssuer()).origin,
    )
    c.header('Location', `/api/agent/access-requests/${encodeURIComponent(result.id)}`)
    return c.json(accessRequestSchema.parse(result), 201)
  })

  app.get('/access-requests/:requestId', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(accessRequestSchema.parse(await getAccessRequest(getDeps(c), c.req.param('requestId'), principal)))
  })

  app.get('/access-grants', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(
      accessGrantsResponseSchema.parse(
        await listAgentAccessGrants(getDeps(c), principal, readQuery(c, paginationQuerySchema)),
      ),
    )
  })

  app.get('/access-grants/:grantId', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(accessGrantSchema.parse(await getAgentAccessGrant(getDeps(c), c.req.param('grantId'), principal)))
  })

  app.post('/access-grants/:grantId/tokens', async (c) => {
    if (!authApi.signJWT) throw unauthorized('Agent assertion signing is unavailable.')
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    const input = await readJson(c, createTargetTokenSchema)
    const result = await issueExternalAccessToken(getDeps(c), c.req.param('grantId'), input.dpopProof, principal, {
      sign: (payload) =>
        authApi.signJWT!({ body: { payload, overrideOptions: { jwt: { type: 'JWT' } } }, asResponse: false }).then(
          ({ token }) => token,
        ),
    })
    return c.json(targetTokenSchema.parse(result))
  })

  return app

  function requireOidcIssuer() {
    if (!oidcIssuer) throw new Error('Agent operations require the configured OIDC issuer.')
    return oidcIssuer
  }
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
