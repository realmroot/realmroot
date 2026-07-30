import { completeResourceConnectionIntent } from '@server/usecases/external-resources'
import { resourceConnectionCallbackQuerySchema } from '@shared/api/external-resources'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { readQuery } from './validation'

export function createResourceConnectionRoutes(canonicalOrigin?: string) {
  const app = new Hono()

  app.get('/oauth/callback', async (c) => {
    const connection = await completeResourceConnectionIntent(
      getDeps(c),
      readQuery(c, resourceConnectionCallbackQuerySchema),
      canonicalOrigin ?? new URL(c.req.url).origin,
    )
    const origin = canonicalOrigin ?? new URL(c.req.url).origin
    if (connection.returnTo === 'access-approval') {
      return c.redirect(`${origin}/agent/resource-access/approve`)
    }
    return c.redirect(`${origin}/connections?resource_connection=connected`)
  })

  return app
}
