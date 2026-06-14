import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
import type { Auth } from '@server/auth'
import { forbidden, notFound } from '@server/domain/errors'
import { handleApiError } from '@server/http/errors'
import type { Deps } from '@server/usecases/deps'
import {
  exchangeToken,
  introspectToken,
  parseBasicClientAuthorization,
  refreshToken,
  refreshTokenGrantType,
  tokenExchangeGrantType,
} from '@server/usecases/token-exchange'
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
import { authContext, managementBearerAuth, type SessionReader } from './middleware/auth-context'
import { trustedOriginCors } from './middleware/cors'
import { depsMiddleware } from './middleware/deps'
import { requestContext } from './middleware/request-context'
import { requireSecurityPolicy } from './middleware/security-policy'
import { managementOpenApiForRequest, managementOpenApiLinkHeader, managementOpenApiPath } from './openapi/management'
import { accountRoutes } from './routes/account'
import { createAccountAssetRoutes, createAssetRoutes, createManagementAssetRoutes } from './routes/assets'
import type { ManagementAuthApi } from './routes/auth-api'
import { createConfigzRoutes } from './routes/configz'
import { createManagementRoutes } from './routes/management'
import { oauthConsentRoute } from './routes/oauth/consent'
import { onboardingRoutes } from './routes/onboarding'

type AuthHandler = Pick<Auth, 'handler'> & {
  api: {
    getOAuthServerConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getOpenIdConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getAgentConfiguration?: (context: { request: Request; asResponse: false }) => Promise<AgentConfiguration>
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

  app.get('/api/auth/.well-known/openid-configuration', (c) => oauthProviderOpenIdConfigMetadata(auth)(c.req.raw))
  app.get('/.well-known/openid-configuration/api/auth', (c) => oauthProviderOpenIdConfigMetadata(auth)(c.req.raw))
  app.get('/.well-known/agent-configuration', (c) => {
    if (!auth.api.getAgentConfiguration) throw notFound('Agent configuration is not available.')
    return auth.api
      .getAgentConfiguration({ request: c.req.raw, asResponse: false })
      .then((configuration) => c.json(mountAgentConfiguration(configuration)))
  })
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    await requireOnboardingComplete(c.get('deps'))
    await requireHostedAuthMethodEnabled(c, configzOptions(c, config.securityPolicy))
    await requireLinkedSiweWallet(c, c.get('deps').wallets)

    const tokenExchangeResponse = await maybeHandleTokenExchange(c)
    if (tokenExchangeResponse) return tokenExchangeResponse

    return auth.handler(c.req.raw)
  })
  app.get('/.well-known/oauth-authorization-server/api/auth', (c) => oauthProviderAuthServerMetadata(auth)(c.req.raw))

  return app
}

export function createRpcApp(auth: AuthHandler, config: AppConfig = {}) {
  return mountApiRoutes(new Hono(), auth, config) as Hono<object, RpcSchema>
}

export type AppType = ReturnType<typeof createRpcApp>

function mountApiRoutes(app: Hono, auth: AuthHandler, config: AppConfig) {
  const managementApi = auth.api as unknown as ManagementAuthApi
  const api = app
    .get('/api/health', (c) => c.json(healthStatus))
    .route('/api/oauth/consent', oauthConsentRoute)
    .route('/api/configz', createConfigzRoutes(config.securityPolicy))
    .route('/api/assets', createAssetRoutes())
    .use('/api/management', managementOpenApiDiscoveryHeader())
    .use('/api/management/*', managementOpenApiDiscoveryHeader())
    .use('/api/management', managementBearerAuth(auth))
    .use('/api/management/*', managementBearerAuth(auth))
    .get(managementOpenApiPath, (c) => c.json(managementOpenApiForRequest(c.req.url)))
    .route('/api/management', createManagementAssetRoutes())
    .route('/api/management', createManagementRoutes({ authApi: managementApi, securityPolicy: config.securityPolicy }))
    .route('/api/onboarding', onboardingRoutes())
    .route('/api/account', accountRoutes(managementApi, config.securityPolicy))
    .route('/api/account', createAccountAssetRoutes(config.securityPolicy))

  return api
}

function managementOpenApiDiscoveryHeader() {
  return async (c: Context, next: () => Promise<void>) => {
    await next()
    if (c.req.path === managementOpenApiPath) return
    c.header('Link', managementOpenApiLinkHeader)
  }
}

async function requireOnboardingComplete(deps: Deps) {
  if (!(await deps.onboarding.hasUsers())) {
    throw forbidden('Complete first-admin onboarding before using auth flows.')
  }
}

async function maybeHandleTokenExchange(c: Context) {
  if (c.req.method !== 'POST') return null
  if (c.req.path !== '/api/auth/oauth2/token' && c.req.path !== '/api/auth/oauth2/introspect') return null

  const form = await c.req.raw
    .clone()
    .formData()
    .catch(() => null)
  if (!form) return null

  const grantType = formString(form, 'grant_type')
  const tokenExchangeRefresh =
    grantType === refreshTokenGrantType && (formString(form, 'refresh_token') ?? '').startsWith('fatr_')
  if (c.req.path === '/api/auth/oauth2/token' && grantType !== tokenExchangeGrantType && !tokenExchangeRefresh) {
    return null
  }

  const client = readClientAuthentication(c.req.raw.headers, form)
  if (!client && !tokenExchangeRefresh) {
    return c.json({ error: 'invalid_client', error_description: 'Client authentication is required.' }, 401, {
      'WWW-Authenticate': 'Basic realm="FlareAuth token endpoint"',
    })
  }

  const deps = c.get('deps')
  if (c.req.path === '/api/auth/oauth2/token') {
    if (tokenExchangeRefresh) {
      const response = await refreshToken(deps, {
        grantType: grantType ?? '',
        refreshToken: formString(form, 'refresh_token') ?? '',
        scope: formString(form, 'scope') ?? undefined,
      })
      return c.json(response)
    }
    if (!client) {
      return c.json({ error: 'invalid_client', error_description: 'Client authentication is required.' }, 401, {
        'WWW-Authenticate': 'Basic realm="FlareAuth token endpoint"',
      })
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

  if (!client) {
    return c.json({ error: 'invalid_client', error_description: 'Client authentication is required.' }, 401, {
      'WWW-Authenticate': 'Basic realm="FlareAuth token endpoint"',
    })
  }
  const introspection = await introspectToken(deps, formString(form, 'token') ?? '', client)
  if (!introspection.active) return null
  return c.json(introspection)
}

function readClientAuthentication(headers: Headers, form: FormData) {
  const basic = parseBasicClientAuthorization(headers.get('authorization'))
  if (basic) return basic
  const clientId = formString(form, 'client_id')
  const clientSecret = formString(form, 'client_secret')
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

function formString(form: FormData, key: string) {
  const value = form.get(key)
  return typeof value === 'string' ? value : null
}
