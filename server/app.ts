import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
import { Hono } from 'hono'
import type { Auth } from './auth'

type AuthHandler = Pick<Auth, 'handler'> & {
  api: {
    getOAuthServerConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
    getOpenIdConfig: (context: { request: Request; asResponse: false }) => Promise<unknown>
  }
}

export function createApp(auth: AuthHandler) {
  const app = new Hono()

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      service: 'flareauth',
    }),
  )

  app.get('/api/auth/.well-known/openid-configuration', (c) => oauthProviderOpenIdConfigMetadata(auth)(c.req.raw))
  app.on(['GET', 'POST'], '/api/auth/**', (c) => auth.handler(c.req.raw))
  app.get('/.well-known/oauth-authorization-server/api/auth', (c) => oauthProviderAuthServerMetadata(auth)(c.req.raw))

  return app
}

export type AppType = ReturnType<typeof createApp>
