import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
import type { Auth } from '@server/auth'
import { forbidden, notFound, oauthError } from '@server/domain/errors'
import { handleApiError } from '@server/http/errors'
import { getAgentIdentityByProtocolAgent } from '@server/usecases/agent-identities'
import type { Deps } from '@server/usecases/deps'
import {
  exchangeToken,
  introspectToken,
  parseBasicClientAuthorization,
  refreshToken,
  refreshTokenGrantType,
  tokenExchangeGrantType,
} from '@server/usecases/token-exchange'
import { capabilityRequestSchema, interactiveResourceProfile } from '@shared/api/agent-api'
import { requestAgentCapabilitiesResponseSchema, requestAgentCapabilitiesSchema } from '@shared/api/agents'
import { resourceByRoutePrefix } from '@shared/authz'
import type { Context } from 'hono'
import { Hono } from 'hono'
import {
  isPublicOAuthMetadataPath,
  mountAgentConfiguration,
  oauthClientCorsOrigins,
  requireHostedAuthMethodEnabled,
  requireLinkedSiweWallet,
} from './app-auth-mounts'
import { configzOptions } from './app-config'
import type { RpcSchema } from './app-rpc-schema'
import type { AgentConfiguration, AppConfig } from './app-types'
import { accessLog } from './middleware/access-log'
import { authn, type SessionReader } from './middleware/authn'
import { authz } from './middleware/authz'
import { trustedOriginCors } from './middleware/cors'
import { depsMiddleware } from './middleware/deps'
import { requestContext } from './middleware/request-context'
import { requireSecurityPolicy } from './middleware/security-policy'
import { unifiedOpenApi, unifiedOpenApiLinkHeader, unifiedOpenApiPath } from './openapi/management'
import { accountRoutes } from './routes/account'
import { createAgentInfoRoutes } from './routes/agent-info'
import { createAgentProtocolRoutes } from './routes/agent-protocol'
import { createAccountAssetRoutes, createAssetRoutes, createProtectedResourceAssetRoutes } from './routes/assets'
import type { ManagementAuthApi } from './routes/auth-api'
import { createConfigzRoutes } from './routes/configz'
import { createProtectedResourceRoutes } from './routes/management'
import { oauthConsentRoute } from './routes/oauth/consent'
import { onboardingRoutes } from './routes/onboarding'
import { createResourceConnectionRoutes } from './routes/resource-connections'
import { readJson } from './routes/validation'

type AuthHandler = Pick<Auth, 'handler'> & {
  api: {
    getOAuthServerConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getOpenIdConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getAgentConfiguration?: (context: { request: Request; asResponse: false }) => Promise<AgentConfiguration>
    getAgentSession?: (context: {
      headers: Headers
      asResponse: false
    }) => Promise<import('@server/usecases/agent-session').ProtocolAgentSession | null>
    signJWT?: (context: {
      body: { payload: Record<string, unknown>; overrideOptions?: { jwt?: { type?: string } } }
      asResponse?: false
    }) => Promise<{ token: string }>
    verifyJWT?: (context: {
      body: { token: string; issuer?: string; audience?: string | string[] }
      asResponse?: false
    }) => Promise<{ payload: Record<string, unknown> | null }>
  } & SessionReader['api']
}

// Liveness payload. Shared with the worker entry so it can answer `/api/health`
// before constructing deps — a liveness probe must not depend on the database.
export const healthStatus = { ok: true, service: 'realmroot' } as const

export function createApp(auth: AuthHandler, deps: Deps, config: AppConfig = {}) {
  // Registration order is load-bearing: middleware only guards routes registered
  // after it (public routes like /api/health stay public by registering before the
  // auth/security walls), and static paths must precede parameter paths. Preserve
  // this sequence when adding or moving routes. The deps middleware goes first so
  // every route and middleware can read `deps` from context.
  const app = new Hono()

  app.use('*', depsMiddleware(deps))
  app.use('*', requestContext())
  app.use('*', accessLog())
  app.on(['GET', 'HEAD'], ['/.well-known/jwks.json', '/api/auth/jwks'], (c) => publishJwks(c, auth))
  app.use(
    '/api/*',
    trustedOriginCors(config.trustedOrigins ?? [], {
      isPublicPath: isPublicOAuthMetadataPath,
      resolveAllowedOrigins: oauthClientCorsOrigins(),
    }),
  )
  app.use('/api/*', authn(auth))
  app.use('/api/*', requireSecurityPolicy(deps.security))

  app.onError((error, c) => handleApiError(error, c))
  app.notFound((c) => handleApiError(notFound(), c))

  mountApiRoutes(app, auth, config)

  app.get('/api/auth/.well-known/openid-configuration', async (c) =>
    extendAgentOAuthMetadata(await oauthProviderOpenIdConfigMetadata(auth)(c.req.raw)),
  )
  app.get('/.well-known/openid-configuration/api/auth', async (c) =>
    extendAgentOAuthMetadata(await oauthProviderOpenIdConfigMetadata(auth)(c.req.raw)),
  )
  app.get('/.well-known/agent-configuration', (c) => {
    if (!auth.api.getAgentConfiguration) throw notFound('Agent configuration is not available.')
    return auth.api.getAgentConfiguration({ request: c.req.raw, asResponse: false }).then((configuration) => {
      const issuer = oauthIssuer(config, c.req.url)
      const mounted = mountAgentConfiguration({ ...configuration, issuer })
      return c.json({
        ...mounted,
        agent_identity_issuer: issuer,
        agent_enrollment_endpoint: new URL('/api/agent-identities/current/enrollments', issuer).toString(),
        agent_endpoint: new URL('/api/agent-identities/current', issuer).toString(),
        agentinfo_endpoint: `${issuer}/agentinfo`,
        agentinfo_claims_supported: agentInfoClaimsSupported,
        agent_token_endpoint: `${issuer}/oauth2/token`,
        agent_jwks_uri: `${issuer}/jwks`,
      })
    })
  })
  app.route(
    '/api/auth/agentinfo',
    createAgentInfoRoutes((requestUrl) => oauthIssuer(config, requestUrl)),
  )
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    await requireOnboardingComplete(c.get('deps'))
    await requireHostedAuthMethodEnabled(c, configzOptions(c, config.securityPolicy))
    await requireLinkedSiweWallet(c, c.get('deps').wallets)

    const tokenExchangeResponse = await maybeHandleTokenExchange(c, oauthIssuer(config, c.req.url))
    if (tokenExchangeResponse) return tokenExchangeResponse

    return auth.handler(c.req.raw)
  })
  app.get('/.well-known/oauth-authorization-server/api/auth', async (c) =>
    extendAgentOAuthMetadata(await oauthProviderAuthServerMetadata(auth)(c.req.raw)),
  )
  app.route('/api', createUnifiedApiRoutes(auth, config))

  return app
}

async function publishJwks(c: Context, auth: AuthHandler) {
  c.header('access-control-allow-origin', '*')
  c.header('content-type', 'application/json; charset=UTF-8')
  if (c.req.method === 'HEAD') return c.body(null)

  const url = new URL(c.req.url)
  url.pathname = '/api/auth/jwks'
  const response = await auth.handler(new Request(url, { headers: c.req.raw.headers }))
  if (!response.ok) return response

  const jwks = (await response.json()) as { keys: JsonWebKey[] }
  return c.json({
    keys: jwks.keys.map((key) => ({
      ...key,
      use: 'sig',
      key_ops: ['verify'],
    })),
  })
}

export function createRpcApp(auth: AuthHandler, config: AppConfig = {}) {
  return mountApiRoutes(new Hono(), auth, config).route('/api', createUnifiedApiRoutes(auth, config)) as Hono<
    object,
    RpcSchema
  >
}

export type AppType = ReturnType<typeof createRpcApp>

function mountApiRoutes(app: Hono, auth: AuthHandler, config: AppConfig) {
  const managementApi = auth.api as unknown as ManagementAuthApi
  const canonicalOrigin = config.baseURL ?? ''
  const issuer = canonicalOrigin ? `${canonicalOrigin}/api/auth` : ''
  const api = app
    .get('/api/health', (c) => c.json(healthStatus))
    .route('/api/oauth/consent', oauthConsentRoute)
    .route('/api/configz', createConfigzRoutes(config.securityPolicy))
    .route('/api/assets', createAssetRoutes())
    .use('/api/*', unifiedOpenApiDiscoveryHeader())
  protectResourceRoutes(api, auth)
  return api
    .route('/api', createProtectedResourceAssetRoutes())
    .route(
      '/api',
      createProtectedResourceRoutes({
        authApi: managementApi,
        canonicalOrigin: config.baseURL,
        securityPolicy: config.securityPolicy,
      }),
    )
    .route('/api/onboarding', onboardingRoutes())
    .route('/api/account', accountRoutes(managementApi, config.securityPolicy, canonicalOrigin || undefined))
    .route('/api/account', createAccountAssetRoutes(config.securityPolicy))
    .route('/api/account-connections', createResourceConnectionRoutes(canonicalOrigin || undefined))
    .route('/api', createAgentProtocolRoutes(auth.api, issuer || undefined))
}

export function protectResourceRoutes(app: Hono, auth: SessionReader) {
  for (const [prefix, resource] of Object.entries(resourceByRoutePrefix)) {
    app.use(`/api/${prefix}`, authn(auth, { allowAgent: true, required: true }))
    app.use(`/api/${prefix}/*`, authn(auth, { allowAgent: true, required: true }))
    app.use(`/api/${prefix}`, authz(resource))
    app.use(`/api/${prefix}/*`, authz(resource))
  }
}

function createUnifiedApiRoutes(auth: AuthHandler, _config: AppConfig) {
  const app = new Hono()

  app.get('/openapi.json', (c) => c.json(unifiedOpenApi))
  app.post('/capability-requests', async (c) => {
    const body = await readJson(c, requestAgentCapabilitiesSchema)
    const headers = new Headers(c.req.raw.headers)
    headers.set('content-type', 'application/json')
    const response = await auth.handler(
      new Request(new URL('/api/auth/agent/request-capability', c.req.url), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          capabilities: body.capabilities,
          reason: body.reason,
          preferred_method: 'device_authorization',
          binding_message: `Agent requesting ${body.capabilities.join(', ')}`,
        }),
      }),
    )
    if (!response.ok) return response

    const payload = requestAgentCapabilitiesResponseSchema.parse(await response.json())
    const identity = await getAgentIdentityByProtocolAgent(c.get('deps'), payload.agent_id)
    const binding = identity.bindings.find(
      (candidate) => candidate.protocolAgentId === payload.agent_id && candidate.status === 'active',
    )
    if (!binding) throw forbidden('The authenticated Agent has no active stable identity binding.')
    const now = new Date()
    let request = payload.approval?.device_code
      ? await c.get('deps').agents.findApprovalRequest(payload.approval.device_code)
      : null
    if (payload.approval?.device_code && !request) {
      throw new Error('Agent capability approval was created without its canonical request resource.')
    }
    if (!request) {
      request = await c.get('deps').agents.createApprovalRequest({
        id: `capreq_${crypto.randomUUID().replaceAll('-', '')}`,
        method: 'immediate',
        agentId: payload.agent_id,
        hostId: binding.hostId,
        userId: identity.homeSpace.type === 'personal' ? identity.homeSpace.userId : null,
        capabilities: body.capabilities.join(' '),
        status: 'approved',
        userCodeHash: null,
        loginHint: null,
        bindingMessage: null,
        clientNotificationToken: null,
        clientNotificationEndpoint: null,
        deliveryMode: null,
        interval: 0,
        lastPolledAt: null,
        expiresAt: now,
        createdAt: now,
        updatedAt: now,
      })
    }
    const approval = payload.approval
    if (approval?.verification_uri_complete) {
      const url = new URL(approval.verification_uri_complete)
      for (const capability of body.capabilities) url.searchParams.append('capability', capability)
      approval.verification_uri_complete = url.toString()
    }
    const result = await capabilityRequestRepresentation(
      c.get('deps'),
      request,
      approval?.verification_uri_complete ?? null,
      new URL(c.req.url).origin,
    )
    c.header('Location', result.links.self)
    applyUnifiedInteractionHeaders(c, result)
    return c.json(capabilityRequestSchema.parse(result), 201)
  })
  app.get('/capability-requests/:requestId', async (c) => {
    const session = await requireUnifiedAgentSession(auth, c.req.raw.headers)
    const request = await c.get('deps').agents.findApprovalRequest(c.req.param('requestId'))
    if (!request || request.agentId !== session.agent.id) throw notFound('Capability request was not found.')
    const result = await capabilityRequestRepresentation(c.get('deps'), request, null, new URL(c.req.url).origin)
    applyUnifiedInteractionHeaders(c, result)
    return c.json(capabilityRequestSchema.parse(result))
  })
  return app
}

async function requireUnifiedAgentSession(auth: AuthHandler, headers: Headers) {
  const session = await auth.api.getAgentSession?.({ headers, asResponse: false })
  if (!session) throw forbidden('An authenticated Agent is required.')
  return session
}

async function capabilityRequestRepresentation(
  deps: Deps,
  request: Awaited<ReturnType<Deps['agents']['findApprovalRequest']>> & {},
  approvalUrl: string | null,
  apiOrigin: string,
) {
  const identity = await getAgentIdentityByProtocolAgent(deps, request.agentId!)
  const capabilities = request.capabilities?.split(' ').filter(Boolean) ?? []
  const now = Date.now()
  const activeCapabilities = new Set(
    (await deps.agents.listCapabilityGrantsForAgent(request.agentId!))
      .filter((grant) => grant.status === 'active' && (!grant.expiresAt || grant.expiresAt.getTime() > now))
      .map((grant) => grant.capability),
  )
  const authorityIsActive = capabilities.length > 0 && capabilities.every((value) => activeCapabilities.has(value))
  let status: 'completed' | 'denied' | 'expired' | 'pending' | 'failed'
  if (authorityIsActive || request.status === 'approved' || request.status === 'consumed') status = 'completed'
  else if (request.status === 'pending' && request.expiresAt.getTime() <= now) status = 'expired'
  else if (request.status === 'denied') status = 'denied'
  else if (request.status === 'expired') status = 'expired'
  else if (request.status === 'pending') status = 'pending'
  else status = 'failed'
  return {
    id: request.id,
    agentId: identity.id,
    capabilities: capabilities.map((value) => ({
      value,
      status: status === 'completed' ? 'active' : status,
    })),
    status,
    interaction: {
      type: 'user-approval' as const,
      status,
      url: status === 'pending' ? approvalUrl : null,
      expiresAt: status === 'pending' ? request.expiresAt.toISOString() : null,
    },
    links: { self: `${apiOrigin}/api/capability-requests/${encodeURIComponent(request.id)}` },
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
  }
}

function applyUnifiedInteractionHeaders(c: Context, result: { interaction: { status: string } }) {
  c.header('Link', `<${interactiveResourceProfile}>; rel="profile"`)
  if (result.interaction.status === 'pending') c.header('Retry-After', '2')
}

function unifiedOpenApiDiscoveryHeader() {
  return async (c: Context, next: () => Promise<void>) => {
    await next()
    if (c.req.path === unifiedOpenApiPath) return
    const existing = c.res.headers.get('Link')
    c.header('Link', existing ? `${existing}, ${unifiedOpenApiLinkHeader}` : unifiedOpenApiLinkHeader)
  }
}

async function requireOnboardingComplete(deps: Deps) {
  if (!(await deps.onboarding.hasUsers())) {
    throw forbidden('Complete first-admin onboarding before using auth flows.')
  }
}

async function maybeHandleTokenExchange(c: Context, issuer: string) {
  if (c.req.method !== 'POST') return null
  if (c.req.path !== '/api/auth/oauth2/token' && c.req.path !== '/api/auth/oauth2/introspect') return null

  const form = await c.req.raw
    .clone()
    .formData()
    .catch(() => null)
  if (!form) return null

  const grantType = formString(form, 'grant_type')
  if (c.req.path === '/api/auth/oauth2/introspect' && !(formString(form, 'token') ?? '').startsWith('fatx_')) {
    return null
  }
  const tokenExchangeRefresh =
    grantType === refreshTokenGrantType && (formString(form, 'refresh_token') ?? '').startsWith('fatr_')
  if (c.req.path === '/api/auth/oauth2/token' && grantType !== tokenExchangeGrantType && !tokenExchangeRefresh) {
    return null
  }

  const client = readClientAuthentication(c.req.raw.headers, form)
  if (!client) {
    throw oauthError(
      'invalid_client',
      'Client authentication is required.',
      401,
      {},
      { 'WWW-Authenticate': 'Basic realm="Realmroot token endpoint"' },
    )
  }

  const deps = c.get('deps')
  if (c.req.path === '/api/auth/oauth2/token') {
    if (tokenExchangeRefresh) {
      const response = await refreshToken(
        deps,
        {
          grantType: grantType ?? '',
          refreshToken: formString(form, 'refresh_token') ?? '',
          scope: formString(form, 'scope') ?? undefined,
        },
        client,
      )
      return c.json(response)
    }
    const response = await exchangeToken(
      deps,
      {
        grantType: grantType ?? '',
        subjectToken: formString(form, 'subject_token') ?? '',
        subjectTokenType: formString(form, 'subject_token_type') ?? '',
        audience: formString(form, 'audience') ?? '',
        scope: formString(form, 'scope') ?? undefined,
        requestedTokenType: formString(form, 'requested_token_type') ?? undefined,
      },
      client,
    )
    return c.json(response)
  }

  const introspection = await introspectToken(deps, formString(form, 'token') ?? '', client, issuer)
  return c.json(introspection)
}

async function extendAgentOAuthMetadata(response: Response) {
  const metadata = (await response.json()) as Record<string, unknown>
  const issuer = metadata.issuer
  if (typeof issuer !== 'string') throw new Error('OAuth metadata has no issuer.')
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json(
    {
      ...metadata,
      dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
      agentinfo_endpoint: `${issuer.replace(/\/$/, '')}/agentinfo`,
      agentinfo_claims_supported: agentInfoClaimsSupported,
    },
    { status: response.status, headers },
  )
}

const agentInfoClaimsSupported = ['iss', 'sub', 'sub_profile', 'name', 'picture', 'updated_at'] as const

function oauthIssuer(config: AppConfig, requestUrl: string) {
  return `${(config.baseURL ?? new URL(requestUrl).origin).replace(/\/$/, '')}/api/auth`
}

function readClientAuthentication(headers: Headers, form: FormData) {
  const authorization = headers.get('authorization')
  if (authorization) return parseBasicClientAuthorization(authorization)
  const clientId = formString(form, 'client_id')
  const clientSecret = formString(form, 'client_secret')
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

function formString(form: FormData, key: string) {
  const value = form.get(key)
  return typeof value === 'string' ? value : null
}
