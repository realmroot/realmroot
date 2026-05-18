import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import {
  createApplicationRequestSchema,
  paginationQuerySchema,
  replaceRedirectUrisRequestSchema,
  updateApplicationRequestSchema,
} from '../../../../shared/api/applications'
import { requireAdmin } from '../../../middleware/admin'
import { getAuthContext } from '../../../middleware/auth-context'
import { type ApplicationBindings, createApplicationService } from '../../../modules/applications/context'

export const adminApplicationsRoute = new Hono<{ Bindings: ApplicationBindings }>()

adminApplicationsRoute.use('*', requireAdmin())

adminApplicationsRoute.get('/', zValidator('query', paginationQuerySchema), async (c) =>
  c.json(await createApplicationService(c).list(c.req.valid('query'))),
)

adminApplicationsRoute.post('/', zValidator('json', createApplicationRequestSchema), async (c) => {
  const { user } = getAuthContext(c)
  const application = await createApplicationService(c).create(c.req.valid('json'), user?.id ?? 'system')
  return c.json(application, 201)
})

adminApplicationsRoute.get('/:applicationId', async (c) => {
  const application = await createApplicationService(c).get(c.req.param('applicationId'))
  return c.json(application)
})

adminApplicationsRoute.patch('/:applicationId', zValidator('json', updateApplicationRequestSchema), async (c) => {
  const application = await createApplicationService(c).update(c.req.param('applicationId'), c.req.valid('json'))
  return c.json(application)
})

adminApplicationsRoute.delete('/:applicationId', async (c) => {
  await createApplicationService(c).delete(c.req.param('applicationId'))
  return c.body(null, 204)
})

adminApplicationsRoute.get('/:applicationId/redirect-uris', zValidator('query', paginationQuerySchema), async (c) => {
  const application = await createApplicationService(c).get(c.req.param('applicationId'))
  const pagination = c.req.valid('query')
  const redirectUris = application.redirectUris.slice(pagination.offset, pagination.offset + pagination.limit)
  return c.json({
    redirectUris,
    pagination: {
      ...pagination,
      total: application.redirectUris.length,
      hasMore: pagination.offset + pagination.limit < application.redirectUris.length,
    },
  })
})

adminApplicationsRoute.put(
  '/:applicationId/redirect-uris',
  zValidator('json', replaceRedirectUrisRequestSchema),
  async (c) => {
    const application = await createApplicationService(c).replaceRedirectUris(
      c.req.param('applicationId'),
      c.req.valid('json'),
    )
    return c.json({ redirectUris: application.redirectUris })
  },
)

adminApplicationsRoute.get('/:applicationId/client-secrets', zValidator('query', paginationQuerySchema), async (c) =>
  c.json(await createApplicationService(c).listSecrets(c.req.param('applicationId'), c.req.valid('query'))),
)

adminApplicationsRoute.post('/:applicationId/client-secrets', async (c) => {
  const { user } = getAuthContext(c)
  const secret = await createApplicationService(c).rotateSecret(c.req.param('applicationId'), user?.id ?? 'system')
  return c.json(secret, 201)
})
