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
import { readJson, readQuery } from '../../validation'

export const adminApplicationsRoute = new Hono<{ Bindings: ApplicationBindings }>()

adminApplicationsRoute.use('*', requireAdmin())

adminApplicationsRoute.get('/', async (c) => {
  const query = readQuery(c, paginationQuerySchema)
  return c.json(await createApplicationService(c).list(query))
})

adminApplicationsRoute.post('/', async (c) => {
  const { user } = getAuthContext(c)
  const body = await readJson(c, createApplicationRequestSchema)
  const application = await createApplicationService(c).create(body, user?.id ?? 'system')
  return c.json(application, 201)
})

adminApplicationsRoute.get('/:applicationId', async (c) => {
  const application = await createApplicationService(c).get(c.req.param('applicationId'))
  return c.json(application)
})

adminApplicationsRoute.patch('/:applicationId', async (c) => {
  const body = await readJson(c, updateApplicationRequestSchema)
  const application = await createApplicationService(c).update(c.req.param('applicationId'), body)
  return c.json(application)
})

adminApplicationsRoute.delete('/:applicationId', async (c) => {
  await createApplicationService(c).delete(c.req.param('applicationId'))
  return c.body(null, 204)
})

adminApplicationsRoute.get('/:applicationId/redirect-uris', async (c) => {
  const application = await createApplicationService(c).get(c.req.param('applicationId'))
  const pagination = readQuery(c, paginationQuerySchema)
  const redirectUris = application.redirectUris.slice(pagination.offset, pagination.offset + pagination.limit)
  return c.json({
    redirectUris,
    pagination: {
      ...pagination,
      total: application.redirectUris.length,
      hasMore: pagination.offset + pagination.limit < application.redirectUris.length,
      nextOffset:
        pagination.offset + pagination.limit < application.redirectUris.length
          ? pagination.offset + pagination.limit
          : null,
    },
  })
})

adminApplicationsRoute.put('/:applicationId/redirect-uris', async (c) => {
  const body = await readJson(c, replaceRedirectUrisRequestSchema)
  const application = await createApplicationService(c).replaceRedirectUris(c.req.param('applicationId'), body)
  return c.json({ redirectUris: application.redirectUris })
})

adminApplicationsRoute.get('/:applicationId/client-secrets', async (c) => {
  const query = readQuery(c, paginationQuerySchema)
  return c.json(await createApplicationService(c).listSecrets(c.req.param('applicationId'), query))
})

adminApplicationsRoute.post('/:applicationId/client-secrets', async (c) => {
  const { user } = getAuthContext(c)
  const secret = await createApplicationService(c).rotateSecret(c.req.param('applicationId'), user?.id ?? 'system')
  return c.json(secret, 201)
})
