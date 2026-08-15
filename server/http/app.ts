import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
import { Scalar } from '@scalar/hono-api-reference'
import type { Auth } from '@server/auth'
import { ApiError, forbidden, notFound, oauthError } from '@server/domain/errors'
import { handleApiError } from '@server/http/errors'
import { issueAgentBootstrapAccessToken } from '@server/usecases/agent-oauth'
import { issueApplicationAccessToken } from '@server/usecases/application-oauth'
import { ensureRealmrootResourceServer } from '@server/usecases/authorization'
import type { Deps } from '@server/usecases/deps'
import {
  exchangeToken,
  introspectToken,
  parseBasicClientAuthorization,
  refreshToken,
  refreshTokenGrantType,
  tokenExchangeGrantType,
} from '@server/usecases/token-exchange'
import { agentBootstrapScopes, realmrootOAuthScopes, resourceByRoutePrefix } from '@shared/authz'
import type { Context } from 'hono'
import { Hono } from 'hono'
import {
  isPublicCorsPath,
  mountAgentConfiguration,
  oauthClientCorsOrigins,
  publicIssuerMetadataPaths,
  requireHostedAuthMethodEnabled,
  requireLinkedSiweWallet,
} from './app-auth-mounts'
import { configzOptions } from './app-config'
import type { RpcSchema } from './app-rpc-schema'
import type { AgentConfiguration, AppConfig } from './app-types'
import { accessLog } from './middleware/access-log'
import { authn, getPrincipal, type SessionReader } from './middleware/authn'
import { authorizePlatformOrganization, authz } from './middleware/authz'
import { trustedOriginCors } from './middleware/cors'
import { depsMiddleware } from './middleware/deps'
import { requestContext } from './middleware/request-context'
import { requireSecurityPolicy } from './middleware/security-policy'
import { unifiedOpenApi, unifiedOpenApiLinkHeader, unifiedOpenApiPath } from './openapi/management'
import { accountRoutes } from './routes/account'
import { createAgentProtocolRoutes } from './routes/agent-protocol'
import { createAccountAssetRoutes, createAssetRoutes, createProtectedResourceAssetRoutes } from './routes/assets'
import type { ManagementAuthApi } from './routes/auth-api'
import { createConfigzRoutes } from './routes/configz'
import { createProtectedResourceRoutes } from './routes/management'
import { oauthConsentRoute } from './routes/oauth/consent'
import { onboardingRoutes } from './routes/onboarding'
import { createPublicProfileRoutes } from './routes/public-profiles'
import { createResourceConnectionRoutes } from './routes/resource-connections'
import { trustedRequestUrl } from './trusted-request-origin'

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
  const cors = trustedOriginCors(config.trustedOrigins ?? [], {
    isPublicPath: isPublicCorsPath,
    resolveAllowedOrigins: oauthClientCorsOrigins(),
  })
  app.use('/api/*', cors)
  for (const path of publicIssuerMetadataPaths) app.use(path, cors)
  app.use('/api/*', authn(auth))
  app.use('/api/*', requireSecurityPolicy(deps.security, config.securityPolicy))

  app.onError((error, c) => {
    if (error instanceof ApiError && error.status === 401 && c.req.path.startsWith('/api/')) {
      c.header('WWW-Authenticate', `DPoP resource_metadata="${protectedResourceMetadataUrl(config, c.req.url)}"`)
    }
    return handleApiError(error, c)
  })
  app.notFound((c) => handleApiError(notFound(), c))

  mountApiRoutes(app, auth, config)

  app.get('/api/auth/.well-known/openid-configuration', async (c) =>
    extendAgentOAuthMetadata(await oauthProviderOpenIdConfigMetadata(auth)(c.req.raw), 'openid'),
  )
  app.get('/.well-known/openid-configuration/api/auth', async (c) =>
    extendAgentOAuthMetadata(await oauthProviderOpenIdConfigMetadata(auth)(c.req.raw), 'openid'),
  )
  app.get('/.well-known/agent-configuration', (c) => {
    if (!auth.api.getAgentConfiguration) throw notFound('Agent configuration is not available.')
    return auth.api.getAgentConfiguration({ request: c.req.raw, asResponse: false }).then((configuration) => {
      const issuer = oauthIssuer(config, c.req.url)
      const mounted = mountAgentConfiguration({ ...configuration, issuer })
      const endpoints = Object.fromEntries(
        Object.entries(mounted.endpoints).filter(([name]) => name === 'register' || name === 'status'),
      )
      return c.json({
        ...mounted,
        default_location: undefined,
        capabilities: [],
        endpoints,
        agent_identity_issuer: issuer,
        agent_enrollment_endpoint: new URL('/api/agent/enrollments', issuer).toString(),
        agent_endpoint: new URL('/api/agent', issuer).toString(),
        agent_profile_uri_template: publicAgentProfileUriTemplate(issuer),
        agent_token_endpoint: `${issuer}/oauth2/token`,
        agent_bootstrap_scopes_supported: agentBootstrapScopes,
        agent_jwks_uri: `${issuer}/jwks`,
      })
    })
  })
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    if (isBetterAuthRoleMutationPath(c.req.path)) throw notFound()
    await requireOnboardingComplete(c.get('deps'))
    await requireHostedAuthMethodEnabled(c, configzOptions(c, config.securityPolicy))
    await requireLinkedSiweWallet(c, c.get('deps').wallets)
    if (isLegacyAgentCapabilityPath(c.req.path)) throw notFound()

    const tokenExchangeResponse = await maybeHandleTokenExchange(c, oauthIssuer(config, c.req.url), auth, config)
    if (tokenExchangeResponse) return tokenExchangeResponse

    return auth.handler(c.req.raw)
  })
  app.get('/.well-known/oauth-authorization-server/api/auth', async (c) =>
    extendAgentOAuthMetadata(await oauthProviderAuthServerMetadata(auth)(c.req.raw), 'authorization-server'),
  )
  app.get('/.well-known/oauth-protected-resource/api', (c) => {
    c.header('Access-Control-Allow-Origin', '*')
    return c.json(protectedResourceMetadata(config, c.req.url))
  })
  app.route('/api', createUnifiedApiRoutes(auth, config))

  return app
}

function isLegacyAgentCapabilityPath(path: string) {
  return path.startsWith('/api/auth/capability/') || path === '/api/auth/agent/request-capability'
}

function isBetterAuthRoleMutationPath(path: string) {
  return new Set([
    '/api/auth/organization/create-role',
    '/api/auth/organization/update-role',
    '/api/auth/organization/delete-role',
    '/api/auth/organization/update-member-role',
  ]).has(path)
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
    .route('/api/configz', createConfigzRoutes(config.securityPolicy))
    .route('/api/assets', createAssetRoutes())
    .use('/api/*', unifiedOpenApiDiscoveryHeader())
    .route(
      '/api/public',
      createPublicProfileRoutes((requestUrl) => oauthIssuer(config, requestUrl)),
    )
  protectResourceRoutes(api, auth, config)
  api.use('/api/agent', authn(auth, { allowAgent: true, required: true, oauth: realmrootOAuth(config) }))
  api.use(
    '/api/agent/access-requests',
    authn(auth, { allowAgent: true, required: true, oauth: realmrootOAuth(config) }),
  )
  api.use(
    '/api/agent/access-requests/*',
    authn(auth, { allowAgent: true, required: true, oauth: realmrootOAuth(config) }),
  )
  return api
    .route('/api', createProtectedResourceAssetRoutes())
    .route(
      '/api',
      createProtectedResourceRoutes({
        authApi: managementApi,
        canonicalOrigin: config.baseURL,
        trustedOrigins: config.trustedOrigins,
        securityPolicy: config.securityPolicy,
      }),
    )
    .route('/api/onboarding', onboardingRoutes(canonicalOrigin || undefined))
    .route('/api/account', oauthConsentRoute)
    .route('/api/account', accountRoutes(managementApi, config.securityPolicy, canonicalOrigin || undefined))
    .route('/api/account', createAccountAssetRoutes(config.securityPolicy))
    .route('/oauth/account-connection', createResourceConnectionRoutes(canonicalOrigin || undefined))
    .route('/api', createAgentProtocolRoutes(auth.api, issuer || undefined, config.trustedOrigins))
}

export function protectResourceRoutes(app: Hono, auth: SessionReader, config: AppConfig = {}) {
  for (const prefix of Object.keys(resourceByRoutePrefix)) {
    app.use(`/api/${prefix}`, authn(auth, { allowAgent: true, required: true, oauth: realmrootOAuth(config) }))
    app.use(`/api/${prefix}/*`, authn(auth, { allowAgent: true, required: true, oauth: realmrootOAuth(config) }))
  }
  const protectAssetCreation = async (c: Context, next: () => Promise<void>) => {
    if ((c.req.method === 'GET' || c.req.method === 'HEAD') && /^\/api\/assets\/[^/]+$/.test(c.req.path)) {
      await next()
      return
    }
    await authn(auth, { allowAgent: true, required: true, oauth: realmrootOAuth(config) })(c, async () => {
      if (getPrincipal(c).user) {
        await authorizePlatformOrganization(c, 'applications:write')
        await next()
        return
      }
      await authz('applications')(c, next)
    })
  }
  app.use('/api/assets', protectAssetCreation)
  app.use('/api/assets/*', protectAssetCreation)
}

function realmrootOAuth(config: AppConfig) {
  return {
    issuer: (requestUrl: string) => oauthIssuer(config, requestUrl),
    audience: (requestUrl: string) => `${(config.baseURL ?? new URL(requestUrl).origin).replace(/\/$/, '')}/api`,
    resourceRequestUrl: (requestUrl: string) => trustedRequestUrl(config, requestUrl).toString(),
  }
}

function createUnifiedApiRoutes(_auth: AuthHandler, _config: AppConfig) {
  const app = new Hono()

  app.get('/openapi.json', (c) => c.json(unifiedOpenApi))
  app.get(
    '/docs',
    Scalar({
      url: '/api/openapi.json',
      pageTitle: 'Realmroot API Documentation',
      theme: 'default',
      telemetry: false,
      cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.64.0',
    }),
  )
  return app
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

async function maybeHandleTokenExchange(c: Context, issuer: string, auth: AuthHandler, config: AppConfig) {
  if (c.req.method !== 'POST') return null
  if (c.req.path !== '/api/auth/oauth2/token' && c.req.path !== '/api/auth/oauth2/introspect') return null

  const form = await c.req.raw
    .clone()
    .formData()
    .catch(() => null)
  if (!form) return null

  const grantType = formString(form, 'grant_type')
  if (c.req.path === '/api/auth/oauth2/token' && grantType === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
    return issueAgentToken(c, issuer, auth, form, config.realmrootResourceReconciled)
  }
  if (
    c.req.path === '/api/auth/oauth2/token' &&
    grantType === 'client_credentials' &&
    formString(form, 'resource') === `${new URL(issuer).origin}/api`
  ) {
    return issueApplicationToken(c, issuer, auth, form, config.realmrootResourceReconciled)
  }
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
    const subjectToken = formString(form, 'subject_token') ?? ''
    const subjectTokenType = formString(form, 'subject_token_type') ?? ''
    let verifiedSubjectClaims: Record<string, unknown> | undefined
    if (subjectTokenType === 'urn:ietf:params:oauth:token-type:access_token') {
      if (!auth.api.verifyJWT)
        throw oauthError('temporarily_unavailable', 'Agent token verification is unavailable.', 503)
      try {
        const verified = await auth.api.verifyJWT({
          body: {
            token: subjectToken,
            issuer,
            audience: formString(form, 'audience') ?? '',
          },
          asResponse: false,
        })
        verifiedSubjectClaims = verified.payload ?? undefined
      } catch {
        throw oauthError('invalid_grant', 'Agent subject token is invalid.')
      }
      if (!verifiedSubjectClaims) throw oauthError('invalid_grant', 'Agent subject token is invalid.')
    }
    const response = await exchangeToken(
      deps,
      {
        grantType: grantType ?? '',
        subjectToken,
        subjectTokenType,
        audience: formString(form, 'audience') ?? '',
        scope: formString(form, 'scope') ?? undefined,
        requestedTokenType: formString(form, 'requested_token_type') ?? undefined,
        verifiedSubjectClaims,
      },
      client,
    )
    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    return c.json(response)
  }

  const introspection = await introspectToken(deps, formString(form, 'token') ?? '', client, issuer)
  return c.json(introspection)
}

async function issueApplicationToken(
  c: Context,
  issuer: string,
  auth: AuthHandler,
  form: FormData,
  realmrootResourceReconciled = false,
) {
  if (!auth.api.signJWT) throw oauthError('temporarily_unavailable', 'OAuth token issuance is unavailable.', 503)
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
  const dpopProof = c.req.header('DPoP')
  if (!dpopProof) throw oauthError('invalid_dpop_proof', 'A DPoP proof is required.')
  if (!realmrootResourceReconciled) await ensureRealmrootResourceServer(c.get('deps'), new URL(issuer).origin)
  const response = await issueApplicationAccessToken(
    c.get('deps'),
    {
      ...client,
      scope: formString(form, 'scope') ?? undefined,
      resource: formString(form, 'resource') ?? '',
      expectedResource: `${new URL(issuer).origin}/api`,
      dpopProof,
      tokenEndpoint: `${issuer.replace(/\/$/, '')}/oauth2/token`,
    },
    {
      issuer,
      sign: (payload, type) =>
        auth.api.signJWT!({ body: { payload, overrideOptions: { jwt: { type } } }, asResponse: false }).then(
          ({ token }) => token,
        ),
    },
  )
  c.header('Cache-Control', 'no-store')
  c.header('Pragma', 'no-cache')
  return c.json(response)
}

async function issueAgentToken(
  c: Context,
  issuer: string,
  auth: AuthHandler,
  form: FormData,
  realmrootResourceReconciled = false,
) {
  if (!auth.api.getAgentSession || !auth.api.signJWT) {
    throw oauthError('temporarily_unavailable', 'Agent OAuth token issuance is unavailable.', 503)
  }
  const assertion = formString(form, 'assertion')
  if (!assertion) throw oauthError('invalid_request', 'The assertion parameter is required.')
  const headers = new Headers({ authorization: `Bearer ${assertion}` })
  const session = await auth.api.getAgentSession({ headers, asResponse: false }).catch(() => null)
  if (!session) throw oauthError('invalid_grant', 'The Agent assertion is invalid.')
  const deps = c.get('deps')
  if (!realmrootResourceReconciled) await ensureRealmrootResourceServer(deps, new URL(issuer).origin)
  const active = await deps.agentIdentities.findActiveBindingByProtocolAgent(session.agent.id)
  if (!active) throw oauthError('invalid_grant', 'The Agent is not enrolled.')
  if (active.binding.hostId !== session.agent.hostId) {
    throw oauthError('invalid_grant', 'The Agent host binding is inactive.')
  }
  const tokenEndpoint = `${issuer.replace(/\/$/, '')}/oauth2/token`
  const resource = formString(form, 'resource') ?? ''
  const dpopProof = c.req.header('DPoP')
  if (!dpopProof) throw oauthError('invalid_dpop_proof', 'A DPoP proof is required.')
  const response = await issueAgentBootstrapAccessToken(
    c.get('deps'),
    {
      scope: formString(form, 'scope') ?? undefined,
      resource,
      expectedResource: `${new URL(issuer).origin}/api`,
      dpopProof,
      tokenEndpoint,
    },
    {
      issuer: active.identity.issuer,
      subject: active.identity.subject,
      identityId: active.identity.id,
      protocolAgentId: session.agent.id,
      hostId: session.agent.hostId,
      identity: active.identity,
      binding: active.binding,
    },
    {
      issuer,
      sign: (payload, type) =>
        auth.api.signJWT!({ body: { payload, overrideOptions: { jwt: { type } } }, asResponse: false }).then(
          ({ token }) => token,
        ),
    },
  )
  c.header('Cache-Control', 'no-store')
  c.header('Pragma', 'no-cache')
  return c.json(response)
}

async function extendAgentOAuthMetadata(response: Response, metadataType: 'openid' | 'authorization-server') {
  const metadata = (await response.json()) as Record<string, unknown>
  const issuer = metadata.issuer
  if (typeof issuer !== 'string') throw new Error('OAuth metadata has no issuer.')
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json(
    {
      ...metadata,
      grant_types_supported: [
        ...new Set([
          ...(Array.isArray(metadata.grant_types_supported) ? metadata.grant_types_supported : []),
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
        ]),
      ],
      dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
      ...(metadataType === 'authorization-server'
        ? { agent_profile_uri_template: publicAgentProfileUriTemplate(issuer) }
        : {}),
    },
    { status: response.status, headers },
  )
}

function publicAgentProfileUriTemplate(issuer: string) {
  return `${new URL(issuer).origin}/api/public/agents/{subject}`
}

function protectedResourceMetadata(config: AppConfig, requestUrl: string) {
  const origin = (config.baseURL ?? new URL(requestUrl).origin).replace(/\/$/, '')
  return {
    resource: `${origin}/api`,
    authorization_servers: [`${origin}/api/auth`],
    scopes_supported: realmrootOAuthScopes,
    bearer_methods_supported: [],
    dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
    dpop_bound_access_tokens_required: true,
  }
}

function protectedResourceMetadataUrl(config: AppConfig, requestUrl: string) {
  const origin = (config.baseURL ?? new URL(requestUrl).origin).replace(/\/$/, '')
  return `${origin}/.well-known/oauth-protected-resource/api`
}

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
