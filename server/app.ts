import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
import { Hono } from 'hono'
import type { Auth } from './auth'
import { handleApiError, notFound } from './lib/errors'
import { accessLog } from './middleware/access-log'
import { authContext, type SessionReader } from './middleware/auth-context'
import { trustedOriginCors } from './middleware/cors'
import { requestContext } from './middleware/request-context'
import type { UserRepository } from './modules/users/repository'
import { accountRoutes } from './routes/account'
import { adminApplicationsRoute } from './routes/admin/applications'
import { adminUserRoutes } from './routes/admin/users'
import type { ManagementAuthApi } from './routes/auth-api'
import { oauthConsentRoute } from './routes/oauth/consent'

type AuthHandler = Pick<Auth, 'handler'> & {
  api: {
    getOAuthServerConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getOpenIdConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
  } & SessionReader['api']
}

export interface AppOptions {
  trustedOrigins?: string[]
  userRepository?: UserRepository
}

export function createApp(auth: AuthHandler, options: AppOptions = {}) {
  const app = new Hono()

  app.use('*', requestContext())
  app.use('*', accessLog())
  app.use('/api/*', trustedOriginCors(options.trustedOrigins ?? []))
  app.use('/api/*', authContext(auth))

  app.onError((error, c) => handleApiError(error, c))
  app.notFound((c) => handleApiError(notFound(), c))

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      service: 'flareauth',
    }),
  )

  app.route('/api/admin/applications', adminApplicationsRoute)
  app.route('/api/oauth/consent', oauthConsentRoute)

  if (options.userRepository) {
    const managementApi = auth.api as unknown as ManagementAuthApi
    app.route('/api/admin/users', adminUserRoutes(managementApi, options.userRepository))
    app.route('/api/account', accountRoutes(managementApi, options.userRepository))
  }

  app.get('/api/auth/.well-known/openid-configuration', (c) => oauthProviderOpenIdConfigMetadata(auth)(c.req.raw))
  app.on(['GET', 'POST'], '/api/auth/**', (c) => auth.handler(c.req.raw))
  app.get('/.well-known/oauth-authorization-server/api/auth', (c) => oauthProviderAuthServerMetadata(auth)(c.req.raw))

  return app
}

export type AppType = ReturnType<typeof createApp>
