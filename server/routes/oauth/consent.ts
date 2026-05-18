import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { consentRequestQuerySchema } from '../../../shared/api/applications'
import { requireAuth } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { type ApplicationBindings, createApplicationService } from '../../modules/applications/context'

export const oauthConsentRoute = new Hono<{ Bindings: ApplicationBindings }>()

oauthConsentRoute.use('*', requireAuth())

oauthConsentRoute.get('/', zValidator('query', consentRequestQuerySchema), async (c) => {
  const { user } = getAuthContext(c)
  const query = c.req.valid('query')
  const consent = await createApplicationService(c).loadConsentRequest(
    {
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      scope: query.scope,
      state: query.state,
    },
    user?.id ?? '',
  )
  return c.json(consent)
})
