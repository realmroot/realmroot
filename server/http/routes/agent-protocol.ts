import { badRequest, forbidden, unauthorized } from '@server/domain/errors'
import {
  approveAgentEnrollment,
  createAdditionalAgentEnrollmentIntent,
  createAgentEnrollmentIntent,
  getProtocolAgentEnrollment,
  getPublicAgentEnrollment,
  toAgent,
} from '@server/usecases/agent-identities'
import type { ProtocolAgentSession } from '@server/usecases/agent-session'
import {
  createAccessRequest,
  createAccessRequestCredential,
  getAccessRequest,
  listAgentResourceServerAuthorizationDetails,
} from '@server/usecases/external-resources'
import {
  accessRequestSchema,
  agentEnrollmentProfile,
  agentEnrollmentSchema,
  agentInstallationEnrollmentResponseSchema,
  agentInstallationEnrollmentSchema,
  agentStatusSchema,
  createAccessRequestSchema,
  createAgentSelfEnrollmentSchema,
  credentialOfferProfile,
  interactiveResourceProfile,
  resourceServerAuthorizationDetailsResponseSchema,
  targetCredentialProofSchema,
  targetTokenSchema,
} from '@shared/api/agent-api'
import { idempotencyKeySchema } from '@shared/api/idempotency'
import { paginationInput, paginationQuerySchema } from '@shared/api/pagination'
import { type Context, Hono } from 'hono'
import { getPrincipal } from '../middleware/authn'
import { requireAgentScope } from '../middleware/authz'
import { getDeps } from '../middleware/deps'
import { trustedRequestOrigin } from '../trusted-request-origin'
import { toBoundaryError } from './auth-api'
import { readJson, readQuery } from './validation'

interface AgentSessionApi {
  getAgentSession?: (context: { headers: Headers; asResponse: false }) => Promise<ProtocolAgentSession | null>
  signJWT?: (context: {
    body: { payload: Record<string, unknown>; overrideOptions?: { jwt?: { type?: string } } }
    asResponse: false
  }) => Promise<{ token: string }>
}

export function createAgentProtocolRoutes(authApi: AgentSessionApi, oidcIssuer?: string, trustedOrigins?: string[]) {
  const app = new Hono()
  const requestOriginConfig = {
    baseURL: oidcIssuer ? new URL(oidcIssuer).origin : undefined,
    trustedOrigins,
  }
  const apiOrigin = (c: Context) => trustedRequestOrigin(requestOriginConfig, c.req.url)

  app.get('/agent', async (c) => {
    const principal = getPrincipal(c).agent
    if (!principal) throw unauthorized('An OAuth-authenticated Agent is required.')
    if (!principal.scopes.includes('agent:read')) throw forbidden('OAuth scope "agent:read" is required.')
    const aggregate = await getDeps(c).agentIdentities.findIdentity(principal.identityId)
    const binding = aggregate?.bindings.find(
      (candidate) => candidate.protocolAgentId === principal.protocolAgentId && candidate.hostId === principal.hostId,
    )
    return c.json(
      agentStatusSchema.parse({
        enrollment: { state: aggregate ? 'enrolled' : 'unenrolled', pending: null },
        agent: aggregate ? toAgent(aggregate) : null,
        installation: binding ? { id: binding.id, status: binding.status } : null,
      }),
    )
  })

  app.post('/agent/enrollments', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    if (!session.host?.userId) {
      throw forbidden('A controller-approved delegated Agent session is required.')
    }
    const body = await readJson(c, createAgentSelfEnrollmentSchema)
    const parsedKey = idempotencyKeySchema.safeParse(c.req.header('Idempotency-Key'))
    if (!parsedKey.success) throw badRequest('Idempotency-Key header is required and must contain 1 to 200 characters.')
    if (body.kind === 'new_identity') {
      const { intent, replayed } = await createAgentEnrollmentIntent(
        getDeps(c),
        {
          protocolAgentId: session.agent.id,
          username: body.username,
          nickname: body.nickname,
          runtime: body.runtime,
          organizationId: body.organizationId,
        },
        session.host.userId,
        parsedKey.data,
      )
      if (intent.status === 'pending') {
        await approveAgentEnrollment(getDeps(c), intent.id, requireOidcIssuer(), session.host.userId)
      }
      const enrollment = await getPublicAgentEnrollment(getDeps(c), intent.id, session.host.userId)
      c.header(
        'Location',
        `${new URL(requireOidcIssuer()).origin}/api/agent/enrollments/${encodeURIComponent(intent.id)}`,
      )
      c.header('Link', `<${agentEnrollmentProfile}>; rel="profile"`)
      if (replayed) c.header('Idempotency-Replayed', 'true')
      return c.json(agentEnrollmentSchema.parse(enrollment), 201)
    }
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
      `${new URL(requireOidcIssuer()).origin}/api/agent/enrollments/${encodeURIComponent(intent.id)}`,
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

  app.get('/agent/enrollments/:enrollmentId', async (c) => {
    const session = await requireAgentSession(authApi, c.req.raw.headers)
    return c.json(
      agentInstallationEnrollmentSchema.parse(
        await getProtocolAgentEnrollment(getDeps(c), c.req.param('enrollmentId'), session.agent.id),
      ),
    )
  })

  app.get('/resource-servers/:resourceServerId/authorization-details', async (c) => {
    requireAgentScope(c, 'authorization-details:read')
    const principal = resourcePrincipal(c)
    return c.json(
      resourceServerAuthorizationDetailsResponseSchema.parse(
        await listAgentResourceServerAuthorizationDetails(
          getDeps(c),
          c.req.param('resourceServerId'),
          principal,
          paginationInput(readQuery(c, paginationQuerySchema)),
        ),
      ),
    )
  })

  app.post('/agent/access-requests', async (c) => {
    requireAgentScope(c, 'access-requests:write')
    const principal = resourcePrincipal(c)
    const result = await createAccessRequest(
      getDeps(c),
      await readJson(c, createAccessRequestSchema),
      principal,
      apiOrigin(c),
    )
    c.header('Location', result.links.self)
    applyInteractionHeaders(c, result)
    return c.json(accessRequestSchema.parse(result), 201)
  })

  app.get('/agent/access-requests/:requestId', async (c) => {
    requireAgentScope(c, 'access-requests:read')
    const principal = resourcePrincipal(c)
    const result = await getAccessRequest(getDeps(c), c.req.param('requestId'), principal, apiOrigin(c))
    applyInteractionHeaders(c, result)
    return c.json(accessRequestSchema.parse(result))
  })

  app.post('/agent/access-requests/:requestId/credentials', async (c) => {
    requireAgentScope(c, 'access-requests:write')
    if (!authApi.signJWT) throw unauthorized('Agent assertion signing is unavailable.')
    const principal = resourcePrincipal(c)
    const { proof } = await readJson(c, targetCredentialProofSchema)
    const requestId = c.req.param('requestId')
    const credentialUrl = `${apiOrigin(c)}/api/agent/access-requests/${encodeURIComponent(requestId)}/credentials`
    const result = await createAccessRequestCredential(getDeps(c), requestId, proof.value, credentialUrl, principal, {
      issuer: requireOidcIssuer(),
      sign: (payload, type) =>
        authApi.signJWT!({ body: { payload, overrideOptions: { jwt: { type } } }, asResponse: false }).then(
          ({ token }) => token,
        ),
    })
    c.header('Link', `<${credentialOfferProfile}>; rel="profile"`)
    if (result.dpopNonce) c.header('DPoP-Nonce', result.dpopNonce)
    return c.json(targetTokenSchema.parse(result), 201)
  })

  return app

  function requireOidcIssuer() {
    if (!oidcIssuer) throw new Error('Agent operations require the configured OIDC issuer.')
    return oidcIssuer
  }

  function hostedEnrollmentUrl(intentId: string) {
    const url = new URL('/agent/enrollment', new URL(requireOidcIssuer()).origin)
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

function resourcePrincipal(c: Context) {
  const authenticated = getPrincipal(c).agent
  if (!authenticated) throw unauthorized('An OAuth-authenticated Agent is required.')
  return {
    issuer: authenticated.issuer,
    subject: authenticated.subject,
    identityId: authenticated.identityId,
    protocolAgentId: authenticated.protocolAgentId,
    hostId: authenticated.hostId,
    runtime: authenticated.runtime,
    sessionId: authenticated.sessionId,
    identity: authenticated.identity,
    binding: authenticated.binding,
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
