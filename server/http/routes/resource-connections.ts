import { completeResourceConnectionIntent, failResourceConnectionIntent } from '@server/usecases/external-resources'
import { resourceConnectionCallbackQuerySchema } from '@shared/api/external-resources'
import { Hono } from 'hono'
import { getDeps } from '../middleware/deps'
import { readQuery } from './validation'

export function createResourceConnectionRoutes(canonicalOrigin?: string) {
  const app = new Hono()

  app.get('/callback', async (c) => {
    const origin = canonicalOrigin ?? new URL(c.req.url).origin
    const callback = readQuery(c, resourceConnectionCallbackQuerySchema)
    if (callback.error !== undefined) {
      const failed = await failResourceConnectionIntent(getDeps(c), callback.state)
      const redirect = new URL(connectionApprovalPath(failed.returnTo), origin)
      redirect.searchParams.set('resource_connection', 'failed')
      redirect.searchParams.set('error', callback.error)
      redirect.searchParams.set(
        'error_description',
        callback.error_description ?? 'The provider rejected the account connection request.',
      )
      return c.redirect(redirect.toString())
    }

    const connection = await completeResourceConnectionIntent(getDeps(c), callback, origin)
    if (connection.returnTo === 'access-approval') {
      return c.redirect(`${origin}/agent/access`)
    }
    return c.redirect(`${origin}/connections?resource_connection=connected`)
  })

  return app
}

function connectionApprovalPath(returnTo: string) {
  if (returnTo === 'access-approval') return '/agent/access'
  return '/connections'
}
