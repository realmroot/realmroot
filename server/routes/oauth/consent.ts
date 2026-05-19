import { zValidator } from '@hono/zod-validator'
import type { Context } from 'hono'
import { Hono } from 'hono'
import {
  type CreateConsentRequest,
  consentRequestQuerySchema,
  hostedConsentApprovalRequestSchema,
} from '../../../shared/api/applications'
import { requireAuth } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { type ApplicationBindings, createApplicationService } from '../../modules/applications/context'
import { readJson } from '../validation'

type ConsentServicePort = {
  loadConsentRequest: (
    input: {
      clientId: string
      redirectUri: string
      scope?: string
      state?: string
      authorizationParams?: Record<string, string>
    },
    user: { id: string; email?: string | null; name?: string | null; username?: string | null; image?: string | null },
  ) => Promise<unknown>
  createConsent: (input: Pick<CreateConsentRequest, 'clientId' | 'scopes'>, userId: string) => Promise<unknown>
}

export function createOAuthConsentRoute(
  createService: (c: Context<{ Bindings: ApplicationBindings }>) => ConsentServicePort = createApplicationService,
) {
  const app = new Hono<{ Bindings: ApplicationBindings }>()

  app.use('*', requireAuth())

  app.get('/', zValidator('query', consentRequestQuerySchema), async (c) => {
    const { user } = getAuthContext(c)
    const query = c.req.valid('query')
    const consent = await createService(c).loadConsentRequest(
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
    const consent = await createService(c).createConsent(body, user!.id)
    return c.json({ consent }, 201)
  })

  return app
}

export const oauthConsentRoute = createOAuthConsentRoute()
