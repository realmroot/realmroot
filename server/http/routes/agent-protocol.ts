import { badRequest, forbidden, unauthorized } from '@server/domain/errors'
import {
  createAdditionalAgentEnrollmentIntent,
  createAgentLoginIdentity,
  getAgentIdentityByProtocolAgent,
  getProtocolAgentEnrollment,
  getPublicAgentEnrollment,
  toAgent,
} from '@server/usecases/agent-identities'
import type { ProtocolAgentSession } from '@server/usecases/agent-session'
import type { Deps } from '@server/usecases/deps'
import {
  createAccessRequest,
  createAccessRequestCredential,
  createAgentConnectionRequest,
  getAccessRequest,
  getAgentConnectionRequest,
  getAgentResourceServer,
  getAgentResourceServerResource,
  listAgentResourceServerResources,
  listAgentResourceServers,
} from '@server/usecases/external-resources'
import {
  accessRequestSchema,
  agentInstallationEnrollmentResponseSchema,
  agentInstallationEnrollmentSchema,
  agentResponseSchema,
  createAccessRequestSchema,
  createAgentEnrollmentSchema,
  createAgentInstallationEnrollmentSchema,
  createResourceConnectionRequestSchema,
  credentialOfferProfile,
  interactiveResourceProfile,
  resourceConnectionRequestSchema,
  resourceServerResourceSchema,
  resourceServerResourcesResponseSchema,
  resourceServerSchema,
  resourceServersResponseSchema,
  targetTokenSchema,
} from '@shared/api/agent-api'
import { idempotencyKeySchema } from '@shared/api/idempotency'
import { paginationQuerySchema } from '@shared/api/pagination'
import { type Context, Hono } from 'hono'
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

  app.get('/agent-identities/current', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    const identity = await getAgentIdentityByProtocolAgent(getDeps(c), session.agent.id)
    return c.json(agentResponseSchema.parse({ agent: toAgent(identity) }))
  })

  app.post('/agent-identities/current/enrollments', async (c) => {
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
    c.header('Location', `${new URL(requireOidcIssuer()).origin}/api/agent-identities/current`)
    return c.json(agentResponseSchema.parse({ agent: toAgent(identity) }), 201)
  })

  app.post('/installation-enrollments', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    if (!session.host?.userId) {
      throw forbidden('A controller-approved delegated Agent session is required.')
    }
    const parsedKey = idempotencyKeySchema.safeParse(c.req.header('Idempotency-Key'))
    if (!parsedKey.success) throw badRequest('Idempotency-Key header is required and must contain 1 to 200 characters.')
    const body = await readJson(c, createAgentInstallationEnrollmentSchema)
    const { intent, replayed } = await createAdditionalAgentEnrollmentIntent(
      getDeps(c),
      body.agentId,
      session.agent.id,
      session.host.userId,
      parsedKey.data,
    )
    const verificationUri = hostedEnrollmentUrl(intent.id)
    c.header(
      'Location',
      `${new URL(requireOidcIssuer()).origin}/api/installation-enrollments/${encodeURIComponent(intent.id)}`,
    )
    if (replayed) c.header('Idempotency-Replayed', 'true')
    return c.json(
      agentInstallationEnrollmentResponseSchema.parse({
        enrollment: await getPublicAgentEnrollment(getDeps(c), intent.id, session.host.userId),
        verificationUri,
      }),
      201,
    )
  })

  app.get('/installation-enrollments/:enrollmentId', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    return c.json(
      agentInstallationEnrollmentSchema.parse(
        await getProtocolAgentEnrollment(getDeps(c), c.req.param('enrollmentId'), session.agent.id),
      ),
    )
  })

  app.get('/resource-servers', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(
      resourceServersResponseSchema.parse(
        await listAgentResourceServers(
          getDeps(c),
          principal,
          readQuery(c, paginationQuerySchema),
          new URL(requireOidcIssuer()).origin,
        ),
      ),
    )
  })

  app.get('/resource-servers/:resourceServerId', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(
      resourceServerSchema.parse(
        await getAgentResourceServer(
          getDeps(c),
          c.req.param('resourceServerId'),
          principal,
          new URL(requireOidcIssuer()).origin,
        ),
      ),
    )
  })

  app.get('/resource-servers/:resourceServerId/resources', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(
      resourceServerResourcesResponseSchema.parse(
        await listAgentResourceServerResources(
          getDeps(c),
          c.req.param('resourceServerId'),
          principal,
          readQuery(c, paginationQuerySchema),
          new URL(requireOidcIssuer()).origin,
        ),
      ),
    )
  })

  app.get('/resource-servers/:resourceServerId/resources/:resourceId', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    return c.json(
      resourceServerResourceSchema.parse(
        await getAgentResourceServerResource(
          getDeps(c),
          c.req.param('resourceServerId'),
          c.req.param('resourceId'),
          principal,
          new URL(requireOidcIssuer()).origin,
        ),
      ),
    )
  })

  app.post('/resource-servers/:resourceServerId/connection-requests', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    const result = await createAgentConnectionRequest(
      getDeps(c),
      c.req.param('resourceServerId'),
      await readJson(c, createResourceConnectionRequestSchema),
      principal,
      new URL(requireOidcIssuer()).origin,
    )
    c.header('Location', result.links.self)
    applyInteractionHeaders(c, result)
    return c.json(resourceConnectionRequestSchema.parse(result), 201)
  })

  app.get('/connection-requests/:requestId', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    const result = await getAgentConnectionRequest(
      getDeps(c),
      c.req.param('requestId'),
      principal,
      new URL(requireOidcIssuer()).origin,
    )
    applyInteractionHeaders(c, result)
    return c.json(resourceConnectionRequestSchema.parse(result))
  })

  app.post('/access-requests', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    const result = await createAccessRequest(
      getDeps(c),
      await readJson(c, createAccessRequestSchema),
      principal,
      new URL(requireOidcIssuer()).origin,
    )
    c.header('Location', result.links.self)
    applyInteractionHeaders(c, result)
    return c.json(accessRequestSchema.parse(result), 201)
  })

  app.get('/access-requests/:requestId', async (c) => {
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    const result = await getAccessRequest(
      getDeps(c),
      c.req.param('requestId'),
      principal,
      new URL(requireOidcIssuer()).origin,
    )
    applyInteractionHeaders(c, result)
    return c.json(accessRequestSchema.parse(result))
  })

  app.post('/access-requests/:requestId/credentials', async (c) => {
    if (!authApi.signJWT) throw unauthorized('Agent assertion signing is unavailable.')
    const principal = await resourcePrincipal(authApi, getDeps(c), c.req.raw.headers)
    const dpopProof = c.req.header('DPoP')
    if (!dpopProof) throw unauthorized('A DPoP proof is required.')
    const credentialUrl = `${new URL(requireOidcIssuer()).origin}/api/access-requests/${encodeURIComponent(c.req.param('requestId'))}/credentials`
    const result = await createAccessRequestCredential(
      getDeps(c),
      c.req.param('requestId'),
      dpopProof,
      credentialUrl,
      principal,
      {
        issuer: requireOidcIssuer(),
        sign: (payload, type) =>
          authApi.signJWT!({ body: { payload, overrideOptions: { jwt: { type } } }, asResponse: false }).then(
            ({ token }) => token,
          ),
      },
    )
    c.header('Link', `<${credentialOfferProfile}>; rel="profile"`)
    return c.json(targetTokenSchema.parse(result))
  })

  return app

  function requireOidcIssuer() {
    if (!oidcIssuer) throw new Error('Agent operations require the configured OIDC issuer.')
    return oidcIssuer
  }

  function hostedEnrollmentUrl(intentId: string) {
    const url = new URL('/agent/enrollments/approve', new URL(requireOidcIssuer()).origin)
    url.searchParams.set('intent_id', intentId)
    return url.toString()
  }

  function applyInteractionHeaders(c: Context, result: { interaction: { status: string }; credentialOffer?: unknown }) {
    const profiles = [`<${interactiveResourceProfile}>; rel="profile"`]
    if (result.credentialOffer) profiles.push(`<${credentialOfferProfile}>; rel="profile"`)
    c.header('Link', profiles.join(', '))
    if (result.interaction.status === 'pending') c.header('Retry-After', '2')
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
