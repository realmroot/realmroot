import { completeExternalOAuthIntent } from '@server/usecases/external-accounts'
import { externalAccountSchema, externalOAuthCallbackQuerySchema } from '@shared/api/external-accounts'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { readQuery } from './validation'

export function createExternalAccountRoutes(issuerOrigin?: string) {
  const app = new Hono()

  app.get('/oauth/callback', async (c) => {
    const input = readQuery(c, externalOAuthCallbackQuerySchema)
    const account = await completeExternalOAuthIntent(getDeps(c), input, issuerOrigin ?? new URL(c.req.url).origin)
    return c.json(externalAccountSchema.parse(account), 201)
  })

  return app
}
