import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { SecurityPolicy } from '../shared/api/security'
import {
  isPublicOAuthMetadataPath,
  mountAgentConfiguration,
  oauthClientCorsOrigins,
  requireHostedAuthMethodEnabled,
  requireLinkedSiweWallet,
} from './app-auth-mounts'
import type { RpcSchema } from './app-rpc-schema'
import type { Auth } from './auth'
import { forbidden, handleApiError, notFound } from './lib/errors'
import { accessLog } from './middleware/access-log'
import { authContext, managementBearerAuth, type SessionReader } from './middleware/auth-context'
import { trustedOriginCors } from './middleware/cors'
import { requestContext } from './middleware/request-context'
import { requireSecurityPolicy } from './middleware/security-policy'
import type { ConfigzBindings } from './modules/configz/context'
import type { OnboardingRepository } from './modules/onboarding/repository'
import type { SecurityRepository } from './modules/security/repository'
import { createTokenExchangeService, type TokenExchangeBindings } from './modules/token-exchange/context'
import { parseBasicClientAuthorization, tokenExchangeGrantType } from './modules/token-exchange/service'
import type { UserRepository } from './modules/users/repository'
import type { WalletRepository } from './modules/wallets/repository'
import { managementOpenApiForRequest, managementOpenApiLinkHeader, managementOpenApiPath } from './openapi/management'
import { accountRoutes } from './routes/account'
import {
  type AssetServiceFactory,
  createAccountAssetRoutes,
  createAssetRoutes,
  createManagementAssetRoutes,
} from './routes/assets'
import type { ManagementAuthApi } from './routes/auth-api'
import { type ConfigzServiceFactory, createConfigzRoutes } from './routes/configz'
import {
  createManagementRoutes,
  type ManagementApplicationServiceFactory,
  type ManagementConfigzServiceFactory,
} from './routes/management'
import type { ConnectorServiceFactory } from './routes/management/connectors'
import type { WebhookServiceFactory } from './routes/management/webhooks'
import { oauthConsentRoute } from './routes/oauth/consent'
import { onboardingRoutes } from './routes/onboarding'

type AuthHandler = Pick<Auth, 'handler'> & {
  api: {
    getOAuthServerConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getOpenIdConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getAgentConfiguration?: (context: { request: Request; asResponse: false }) => Promise<AgentConfiguration>
  } & SessionReader['api']
}

export type AgentConfiguration = {
  issuer: string
  default_location: string
  endpoints: Record<string, string>
  [key: string]: unknown
}

export interface AppOptions {
  trustedOrigins?: string[]
  userRepository?: UserRepository
  securityRepository?: SecurityRepository
  walletRepository?: WalletRepository
  onboardingRepository?: OnboardingRepository
  securityPolicy?: SecurityPolicy
  configzServiceFactory?: ConfigzServiceFactory & ManagementConfigzServiceFactory
  applicationServiceFactory?: ManagementApplicationServiceFactory
  connectorServiceFactory?: ConnectorServiceFactory
  webhookServiceFactory?: WebhookServiceFactory
  assetServiceFactory?: AssetServiceFactory
  tokenExchangeServiceFactory?: TokenExchangeServiceFactory
}

export type TokenExchangeServiceFactory = typeof createTokenExchangeService

interface RpcAppOptions extends AppOptions {
  userRepository: UserRepository
  securityRepository: SecurityRepository
  securityPolicy: SecurityPolicy
}

export function createApp(auth: AuthHandler, options: AppOptions = {}) {
  const app = new Hono()

  app.use('*', requestContext())
  app.use('*', accessLog())
  app.use(
    '/api/*',
    trustedOriginCors(options.trustedOrigins ?? [], {
      isPublicPath: isPublicOAuthMetadataPath,
      resolveAllowedOrigins: oauthClientCorsOrigins(options),
    }),
  )
  app.use('/api/*', authContext(auth))

  if (options.securityRepository) {
    app.use('/api/*', requireSecurityPolicy(options.securityRepository))
  }

  app.onError((error, c) => handleApiError(error, c))
  app.notFound((c) => handleApiError(notFound(), c))

  if (options.userRepository && options.securityRepository && options.securityPolicy) {
    mountRpcRoutes(app, auth, {
      ...options,
      userRepository: options.userRepository,
      securityRepository: options.securityRepository,
      securityPolicy: options.securityPolicy,
    })
  } else {
    mountCoreApiRoutes(app, auth, options)

    if (options.userRepository) {
      const managementApi = auth.api as unknown as ManagementAuthApi
      app.route(
        '/api/account',
        accountRoutes(
          managementApi,
          options.userRepository,
          options.securityRepository,
          options.applicationServiceFactory,
          options.configzServiceFactory,
          options.walletRepository,
        ),
      )
      app.route(
        '/api/account',
        createAccountAssetRoutes(
          options.assetServiceFactory,
          options.configzServiceFactory
            ? async (c) =>
                (
                  await options.configzServiceFactory!(
                    c as unknown as Context<{ Bindings: ConfigzBindings }>,
                  ).getConfig()
                ).accountCenter
            : undefined,
        ),
      )
    }
  }

  app.get('/api/auth/.well-known/openid-configuration', (c) => oauthProviderOpenIdConfigMetadata(auth)(c.req.raw))
  app.get('/.well-known/openid-configuration/api/auth', (c) => oauthProviderOpenIdConfigMetadata(auth)(c.req.raw))
  app.get('/.well-known/agent-configuration', (c) => {
    if (!auth.api.getAgentConfiguration) throw notFound('Agent configuration is not available.')
    return auth.api
      .getAgentConfiguration({ request: c.req.raw, asResponse: false })
      .then((configuration) => c.json(mountAgentConfiguration(configuration)))
  })
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    if (options.onboardingRepository) {
      await requireOnboardingComplete(options.onboardingRepository)
    }
    if (options.configzServiceFactory) {
      await requireHostedAuthMethodEnabled(c, options.configzServiceFactory)
    }
    if (options.walletRepository) {
      await requireLinkedSiweWallet(c, options.walletRepository)
    }

    const tokenExchangeResponse = await maybeHandleTokenExchange(c, options.tokenExchangeServiceFactory)
    if (tokenExchangeResponse) return tokenExchangeResponse

    return auth.handler(c.req.raw)
  })
  app.get('/.well-known/oauth-authorization-server/api/auth', (c) => oauthProviderAuthServerMetadata(auth)(c.req.raw))

  return app
}

export function createRpcApp(auth: AuthHandler, options: RpcAppOptions) {
  return mountRpcRoutes(new Hono(), auth, options) as Hono<object, RpcSchema>
}

export type AppType = ReturnType<typeof createRpcApp>

function mountCoreApiRoutes(app: Hono, auth: AuthHandler, options: AppOptions) {
  const managementApi = auth.api as unknown as ManagementAuthApi
  let api = app
    .get('/api/health', (c) =>
      c.json({
        ok: true,
        service: 'flareauth',
      }),
    )
    .route('/api/oauth/consent', oauthConsentRoute)
    .route(
      '/api/configz',
      createConfigzRoutes(options.configzServiceFactory, options.onboardingRepository, options.securityPolicy),
    )
    .route('/api/assets', createAssetRoutes(options.assetServiceFactory))
    .use('/api/management', managementOpenApiDiscoveryHeader())
    .use('/api/management/*', managementOpenApiDiscoveryHeader())
    .use('/api/management', managementBearerAuth(auth))
    .use('/api/management/*', managementBearerAuth(auth))
    .get(managementOpenApiPath, (c) => c.json(managementOpenApiForRequest(c.req.url)))
    .route('/api/management', createManagementAssetRoutes(options.assetServiceFactory))
    .route(
      '/api/management',
      createManagementRoutes({
        authApi: managementApi,
        userRepository: options.userRepository,
        securityRepository: options.securityRepository,
        securityPolicy: options.securityPolicy,
        configzServiceFactory: options.configzServiceFactory,
        applicationServiceFactory: options.applicationServiceFactory,
        connectorServiceFactory: options.connectorServiceFactory,
        webhookServiceFactory: options.webhookServiceFactory,
        tokenExchangeServiceFactory: options.tokenExchangeServiceFactory,
      }),
    )

  if (options.onboardingRepository) {
    api = api.route('/api/onboarding', onboardingRoutes(options.onboardingRepository))
  }

  return api
}

function managementOpenApiDiscoveryHeader() {
  return async (c: Context, next: () => Promise<void>) => {
    await next()
    if (c.req.path === managementOpenApiPath) return
    c.header('Link', managementOpenApiLinkHeader)
  }
}

function mountRpcRoutes(app: Hono, auth: AuthHandler, options: RpcAppOptions) {
  const managementApi = auth.api as unknown as ManagementAuthApi
  return mountCoreApiRoutes(app, auth, options)
    .route(
      '/api/account',
      accountRoutes(
        managementApi,
        options.userRepository,
        options.securityRepository,
        options.applicationServiceFactory,
        options.configzServiceFactory,
        options.walletRepository,
      ),
    )
    .route(
      '/api/account',
      createAccountAssetRoutes(
        options.assetServiceFactory,
        options.configzServiceFactory
          ? async (c) =>
              (await options.configzServiceFactory!(c as unknown as Context<{ Bindings: ConfigzBindings }>).getConfig())
                .accountCenter
          : undefined,
      ),
    )
}

async function requireOnboardingComplete(onboarding: OnboardingRepository) {
  if (!(await onboarding.hasUsers())) {
    throw forbidden('Complete first-admin onboarding before using auth flows.')
  }
}

async function maybeHandleTokenExchange(c: Context, factory: TokenExchangeServiceFactory = createTokenExchangeService) {
  if (c.req.method !== 'POST') return null
  if (c.req.path !== '/api/auth/oauth2/token' && c.req.path !== '/api/auth/oauth2/introspect') return null

  const form = await c.req.raw
    .clone()
    .formData()
    .catch(() => null)
  if (!form) return null

  if (c.req.path === '/api/auth/oauth2/token' && formString(form, 'grant_type') !== tokenExchangeGrantType) return null

  const client = readClientAuthentication(c.req.raw.headers, form)
  if (!client) {
    return c.json({ error: 'invalid_client', error_description: 'Client authentication is required.' }, 401, {
      'WWW-Authenticate': 'Basic realm="FlareAuth token endpoint"',
    })
  }

  const service = factory(c as unknown as Context<{ Bindings: TokenExchangeBindings }>)
  if (c.req.path === '/api/auth/oauth2/token') {
    const response = await service.exchange(
      {
        grantType: formString(form, 'grant_type') ?? '',
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

  const introspection = await service.introspect(formString(form, 'token') ?? '', client)
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
