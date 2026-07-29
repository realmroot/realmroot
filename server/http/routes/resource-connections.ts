import { completeResourceConnectionIntent } from '@server/usecases/external-resources'
import { resourceConnectionCallbackQuerySchema } from '@shared/api/external-resources'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { readQuery } from './validation'

export function createResourceConnectionRoutes(canonicalOrigin?: string) {
  const app = new Hono()

  app.get('/oauth/callback', async (c) => {
    await completeResourceConnectionIntent(
      getDeps(c),
      readQuery(c, resourceConnectionCallbackQuerySchema),
      canonicalOrigin ?? new URL(c.req.url).origin,
    )
    return c.redirect(`${canonicalOrigin ?? new URL(c.req.url).origin}/connections?resource_connection=connected`)
  })

  return app
}
