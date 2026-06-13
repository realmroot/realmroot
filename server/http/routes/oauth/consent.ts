import { zValidator } from '@hono/zod-validator'
import { createConsent, loadConsentRequest } from '@server/usecases/applications'
import { consentRequestQuerySchema, hostedConsentApprovalRequestSchema } from '@shared/api/applications'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { requireAuth } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { getDeps } from '../../middleware/deps'
import { readJson } from '../validation'

export function createOAuthConsentRoute() {
  const app = new Hono()

  app.use('*', requireAuth())

  app.get('/', zValidator('query', consentRequestQuerySchema), async (c) => {
    const { user } = getAuthContext(c)
    const query = c.req.valid('query')
    const consent = await loadConsentRequest(
      getDeps(c),
      issuerFor(c),
      {
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        scope: query.scope,
        state: query.state,
        authorizationParams: Object.fromEntries(new URL(c.req.url).searchParams),
      },
      user!,
    )
    return c.json(consent)
  })

  app.post('/', async (c) => {
    const { user } = getAuthContext(c)
    const body = await readJson(c, hostedConsentApprovalRequestSchema)
    const consent = await createConsent(getDeps(c), body, user!.id)
    return c.json({ consent }, 201)
  })

  return app
}

function issuerFor(c: Context) {
  const url = new URL(c.req.url)
  return `${url.protocol}//${url.host}`
}

export const oauthConsentRoute = createOAuthConsentRoute()
