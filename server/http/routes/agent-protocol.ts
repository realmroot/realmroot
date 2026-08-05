import { badRequest, forbidden, unauthorized } from '@server/domain/errors'
import {
  approveAgentEnrollment,
  createAdditionalAgentEnrollmentIntent,
  createAgentEnrollmentIntent,
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
  getAgentResourceServerResource,
  listAgentResourceServerResources,
} from '@server/usecases/external-resources'
import {
  accessRequestSchema,
  agentEnrollmentSchema,
  agentInstallationEnrollmentResponseSchema,
  agentInstallationEnrollmentSchema,
  agentStatusSchema,
  createAccessRequestSchema,
  createAgentSelfEnrollmentSchema,
  createResourceConnectionRequestSchema,
  credentialOfferProfile,
  interactiveResourceProfile,
  resourceConnectionRequestSchema,
  resourceServerResourceSchema,
  resourceServerResourcesResponseSchema,
  targetCredentialProofSchema,
  targetTokenSchema,
} from '@shared/api/agent-api'
import { idempotencyKeySchema } from '@shared/api/idempotency'
import { paginationQuerySchema } from '@shared/api/pagination'
import { type Context, Hono } from 'hono'
import { getPrincipal } from '../middleware/authn'
import { requireAgentScope } from '../middleware/authz'
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

  app.get('/agent/status', async (c) => {
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
    if (body.kind === 'new_identity') {
      const intent = await createAgentEnrollmentIntent(
        getDeps(c),
        {
          protocolAgentId: session.agent.id,
          name: body.name,
          organizationId: body.organizationId,
        },
        session.host.userId,
      )
      await approveAgentEnrollment(getDeps(c), intent.id, requireOidcIssuer(), session.host.userId)
      const enrollment = await getPublicAgentEnrollment(getDeps(c), intent.id, session.host.userId)
      c.header(
        'Location',
        `${new URL(requireOidcIssuer()).origin}/api/agent/enrollments/${encodeURIComponent(intent.id)}`,
      )
      return c.json(agentEnrollmentSchema.parse(enrollment), 201)
    }
    const parsedKey = idempotencyKeySchema.safeParse(c.req.header('Idempotency-Key'))
    if (!parsedKey.success) throw badRequest('Idempotency-Key header is required and must contain 1 to 200 characters.')
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

  app.get('/resource-servers/:resourceServerId/resources', async (c) => {
    requireAgentScope(c, 'resources:read')
    const principal = await resourcePrincipal(authApi, getDeps(c), c)
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
    requireAgentScope(c, 'resources:read')
    const principal = await resourcePrincipal(authApi, getDeps(c), c)
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
    requireAgentScope(c, 'connection-requests:write')
    const principal = await resourcePrincipal(authApi, getDeps(c), c)
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

  app.get('/resource-servers/:resourceServerId/connection-requests/:requestId', async (c) => {
    requireAgentScope(c, 'connection-requests:read')
    const principal = await resourcePrincipal(authApi, getDeps(c), c)
    const result = await getAgentConnectionRequest(
      getDeps(c),
      c.req.param('requestId'),
      principal,
      new URL(requireOidcIssuer()).origin,
    )
    if (result.resourceServerId !== c.req.param('resourceServerId')) {
      throw forbidden('Connection request does not belong to this Resource Server.')
    }
    applyInteractionHeaders(c, result)
    return c.json(resourceConnectionRequestSchema.parse(result))
  })

  app.post('/access/requests', async (c) => {
    requireAgentScope(c, 'access-requests:write')
    const principal = await resourcePrincipal(authApi, getDeps(c), c)
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

  app.get('/access/requests/:requestId', async (c) => {
    requireAgentScope(c, 'access-requests:read')
    const principal = await resourcePrincipal(authApi, getDeps(c), c)
    const result = await getAccessRequest(
      getDeps(c),
      c.req.param('requestId'),
      principal,
      new URL(requireOidcIssuer()).origin,
    )
    applyInteractionHeaders(c, result)
    return c.json(accessRequestSchema.parse(result))
  })

  app.post('/access/authorizations/:authorizationId/credentials', async (c) => {
    requireAgentScope(c, 'access-authorizations:issue')
    if (!authApi.signJWT) throw unauthorized('Agent assertion signing is unavailable.')
    const principal = await resourcePrincipal(authApi, getDeps(c), c)
    const { proof } = await readJson(c, targetCredentialProofSchema)
    const dpopProof = proof.value
    const grant = await getDeps(c).externalResources.findGrant(c.req.param('authorizationId'))
    if (!grant || grant.agentIdentityId !== principal.identityId) {
      throw forbidden('Agent authorization was not found.')
    }
    const request = await getDeps(c).externalResources.findAccessRequestByGrant(grant.id)
    if (!request) throw forbidden('Agent authorization has no approved request.')
    const credentialUrl = `${new URL(requireOidcIssuer()).origin}/api/access/authorizations/${encodeURIComponent(grant.id)}/credentials`
    const result = await createAccessRequestCredential(getDeps(c), request.id, dpopProof, credentialUrl, principal, {
      issuer: requireOidcIssuer(),
      sign: (payload, type) =>
        authApi.signJWT!({ body: { payload, overrideOptions: { jwt: { type } } }, asResponse: false }).then(
          ({ token }) => token,
        ),
    })
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

async function resourcePrincipal(authApi: AgentSessionApi, deps: Deps, c: Context) {
  const authenticated = getPrincipal(c).agent
  if (authenticated) {
    return {
      issuer: authenticated.issuer,
      subject: authenticated.subject,
      identityId: authenticated.identityId,
      protocolAgentId: authenticated.protocolAgentId,
      hostId: authenticated.hostId,
    }
  }
  const session = await requireAgentSession(authApi, c.req.raw.headers)
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
