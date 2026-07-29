import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
import type { Auth } from '@server/auth'
import { forbidden, notFound, oauthError } from '@server/domain/errors'
import { handleApiError } from '@server/http/errors'
import { getAgentIdentityByProtocolAgent } from '@server/usecases/agent-identities'
import { issueAgentAccessToken } from '@server/usecases/agent-tokens'
import type { Deps } from '@server/usecases/deps'
import {
  exchangeToken,
  introspectToken,
  parseBasicClientAuthorization,
  refreshToken,
  refreshTokenGrantType,
  tokenExchangeGrantType,
} from '@server/usecases/token-exchange'
import {
  agentAuthorityGrantType,
  agentTokenFormSchema,
  requestAgentCapabilitiesResponseSchema,
  requestAgentCapabilitiesSchema,
} from '@shared/api/agents'
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
import {
  agentPrincipalAuth,
  authContext,
  getAuthContext,
  managementBearerAuth,
  type SessionReader,
} from './middleware/auth-context'
import { trustedOriginCors } from './middleware/cors'
import { depsMiddleware } from './middleware/deps'
import { requestContext } from './middleware/request-context'
import { requireSecurityPolicy } from './middleware/security-policy'
import { unifiedOpenApi, unifiedOpenApiLinkHeader, unifiedOpenApiPath } from './openapi/management'
import { accountRoutes } from './routes/account'
import { createAgentProtocolRoutes } from './routes/agent-protocol'
import { createAccountAssetRoutes, createAssetRoutes, createManagementAssetRoutes } from './routes/assets'
import type { ManagementAuthApi } from './routes/auth-api'
import { createConfigzRoutes } from './routes/configz'
import { createExternalAccountRoutes } from './routes/external-accounts'
import { createManagementRoutes } from './routes/management'
import { oauthConsentRoute } from './routes/oauth/consent'
import { onboardingRoutes } from './routes/onboarding'
import { readJson } from './routes/validation'

type AuthHandler = Pick<Auth, 'handler'> & {
  api: {
    getOAuthServerConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getOpenIdConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getAgentConfiguration?: (context: { request: Request; asResponse: false }) => Promise<AgentConfiguration>
    getAgentSession?: (context: {
      headers: Headers
      asResponse: false
    }) => Promise<import('@server/usecases/agent-tokens').ProtocolAgentSession | null>
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
export const healthStatus = { ok: true, service: 'flareauth' } as const

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
  app.use(
    '/api/*',
    trustedOriginCors(config.trustedOrigins ?? [], {
      isPublicPath: isPublicOAuthMetadataPath,
      resolveAllowedOrigins: oauthClientCorsOrigins(),
    }),
  )
  app.use('/api/*', authContext(auth))
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
        agent_identity_endpoint: new URL('/api/agent/identity', issuer).toString(),
        agent_token_endpoint: `${issuer}/oauth2/token`,
        agent_jwks_uri: `${issuer}/jwks`,
      })
    })
  })
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    await requireOnboardingComplete(c.get('deps'))
    await requireHostedAuthMethodEnabled(c, configzOptions(c, config.securityPolicy))
    await requireLinkedSiweWallet(c, c.get('deps').wallets)

    const tokenExchangeResponse = await maybeHandleTokenExchange(c, auth, oauthIssuer(config, c.req.url))
    if (tokenExchangeResponse) return tokenExchangeResponse

    return auth.handler(c.req.raw)
  })
  app.get('/.well-known/oauth-authorization-server/api/auth', async (c) =>
    extendAgentOAuthMetadata(await oauthProviderAuthServerMetadata(auth)(c.req.raw)),
  )
  app.route('/api', createUnifiedApiRoutes(auth, config))

  return app
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
    .use('/api/management', managementBearerAuth(auth))
    .use('/api/management/*', managementBearerAuth(auth))
    .route('/api/management', createManagementAssetRoutes())
    .route('/api/management', createManagementRoutes({ authApi: managementApi, securityPolicy: config.securityPolicy }))
    .route('/api/onboarding', onboardingRoutes())
    .route('/api/account', accountRoutes(managementApi, config.securityPolicy, canonicalOrigin || undefined))
    .route('/api/account', createAccountAssetRoutes(config.securityPolicy))
    .route('/api/external-accounts', createExternalAccountRoutes(canonicalOrigin || undefined))
    .route('/api/agent', createAgentProtocolRoutes(auth.api, issuer || undefined))

  return api
}

function createUnifiedApiRoutes(auth: AuthHandler, config: AppConfig) {
  const app = new Hono()
  const managementApi = auth.api as unknown as ManagementAuthApi
  const authenticateAgent = agentPrincipalAuth(auth)
  const authenticateAgentOnly = agentPrincipalAuth(auth, { allowSession: false })

  app.get('/openapi.json', (c) => c.json(unifiedOpenApi))
  app.use('/whoami', authenticateAgentOnly)
  app.get('/whoami', async (c) => {
    const agent = getAuthContext(c).agent!
    return c.json({
      identity: await getAgentIdentityByProtocolAgent(c.get('deps'), agent.protocolAgentId),
    })
  })
  app.use('/capability-requests', authenticateAgentOnly)
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
    const approval = payload.approval
    if (approval?.verification_uri_complete) {
      const url = new URL(approval.verification_uri_complete)
      for (const capability of body.capabilities) url.searchParams.append('capability', capability)
      approval.verification_uri_complete = url.toString()
    }
    return c.json(payload)
  })
  for (const path of unifiedManagementPaths) {
    app.use(path, authenticateAgent)
    app.use(`${path}/*`, authenticateAgent)
  }
  app.route('/', createManagementRoutes({ authApi: managementApi, securityPolicy: config.securityPolicy }))
  return app
}

const unifiedManagementPaths = [
  '/applications',
  '/api-resources',
  '/agents',
  '/agent-audit-events',
  '/agent-identities',
  '/organizations',
  '/roles',
  '/user-role-assignments',
  '/application-role-assignments',
  '/member-role-assignments',
  '/users',
  '/security',
  '/sign-in-settings',
  '/branding-settings',
  '/account-center-settings',
  '/readiness',
  '/connectors',
  '/webhooks',
] as const

function unifiedOpenApiDiscoveryHeader() {
  return async (c: Context, next: () => Promise<void>) => {
    await next()
    if (c.req.path === unifiedOpenApiPath) return
    c.header('Link', unifiedOpenApiLinkHeader)
  }
}

async function requireOnboardingComplete(deps: Deps) {
  if (!(await deps.onboarding.hasUsers())) {
    throw forbidden('Complete first-admin onboarding before using auth flows.')
  }
}

async function maybeHandleTokenExchange(c: Context, auth: AuthHandler, issuer: string) {
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
  if (c.req.path === '/api/auth/oauth2/token' && grantType === agentAuthorityGrantType) {
    const session = await auth.api.getAgentSession?.({ headers: c.req.raw.headers, asResponse: false })
    if (!session) {
      throw oauthError('invalid_client', 'An active AgentAuth session is required.', 401)
    }
    if (!auth.api.signJWT) throw new Error('Better Auth JWT signing is unavailable.')
    const parsed = agentTokenFormSchema.safeParse(Object.fromEntries(form))
    if (!parsed.success) throw oauthError('invalid_request', 'Agent token request parameters are invalid.')
    const body = parsed.data
    const response = await issueAgentAccessToken(
      c.get('deps'),
      c.req.raw,
      {
        grantId: body.grant_id,
        scope: body.scope,
        approvalId: body.approval_id,
      },
      session,
      {
        issuer,
        sign: async (payload) =>
          (
            await auth.api.signJWT!({
              body: { payload, overrideOptions: { jwt: { type: 'at+jwt' } } },
              asResponse: false,
            })
          ).token,
      },
    )
    return c.json(response)
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
      { 'WWW-Authenticate': 'Basic realm="FlareAuth token endpoint"' },
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
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json(
    {
      ...metadata,
      grant_types_supported: appendMetadataValue(metadata.grant_types_supported, agentAuthorityGrantType),
      flareauth_agent_access_token_claims_supported: ['act', 'agent_identity', 'cnf'],
      dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
    },
    { status: response.status, headers },
  )
}

function appendMetadataValue(value: unknown, addition: string) {
  return appendMetadataValues(value, [addition])
}

function appendMetadataValues(value: unknown, additions: string[]) {
  return [
    ...new Set([
      ...(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []),
      ...additions,
    ]),
  ]
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
