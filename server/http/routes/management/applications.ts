import {
  createApplication,
  deleteApplication,
  getApplication,
  listApplicationSecrets,
  listApplications,
  replaceRedirectUris,
  rotateApplicationSecret,
  updateApplication,
} from '@server/usecases/applications'
import {
  createApplicationRequestSchema,
  paginationQuerySchema,
  replaceRedirectUrisRequestSchema,
  updateApplicationRequestSchema,
} from '@shared/api/applications'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export const managementApplicationsRoute = new Hono()

managementApplicationsRoute.use('*', requireAdmin())

managementApplicationsRoute.get('/', async (c) => {
  const query = readQuery(c, paginationQuerySchema)
  return c.json(await listApplications(getDeps(c), issuerFor(c), query))
})

managementApplicationsRoute.post('/', async (c) => {
  const { user } = getAuthContext(c)
  const body = await readJson(c, createApplicationRequestSchema)
  const application = await createApplication(getDeps(c), issuerFor(c), body, user?.id ?? 'system')
  return c.json(application, 201)
})

managementApplicationsRoute.get('/:applicationId', async (c) => {
  const application = await getApplication(getDeps(c), issuerFor(c), c.req.param('applicationId'))
  return c.json(application)
})

managementApplicationsRoute.patch('/:applicationId', async (c) => {
  const body = await readJson(c, updateApplicationRequestSchema)
  const application = await updateApplication(getDeps(c), issuerFor(c), c.req.param('applicationId'), body)
  return c.json(application)
})

managementApplicationsRoute.delete('/:applicationId', async (c) => {
  await deleteApplication(getDeps(c), c.req.param('applicationId'))
  return c.body(null, 204)
})

managementApplicationsRoute.get('/:applicationId/redirect-uris', async (c) => {
  const application = await getApplication(getDeps(c), issuerFor(c), c.req.param('applicationId'))
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

managementApplicationsRoute.put('/:applicationId/redirect-uris', async (c) => {
  const body = await readJson(c, replaceRedirectUrisRequestSchema)
  const application = await replaceRedirectUris(getDeps(c), issuerFor(c), c.req.param('applicationId'), body)
  return c.json({ redirectUris: application.redirectUris })
})

managementApplicationsRoute.get('/:applicationId/client-secrets', async (c) => {
  const query = readQuery(c, paginationQuerySchema)
  return c.json(await listApplicationSecrets(getDeps(c), c.req.param('applicationId'), query))
})

managementApplicationsRoute.post('/:applicationId/client-secrets', async (c) => {
  const { user } = getAuthContext(c)
  const secret = await rotateApplicationSecret(getDeps(c), c.req.param('applicationId'), user?.id ?? 'system')
  return c.json(secret, 201)
})

function issuerFor(c: Context) {
  const url = new URL(c.req.url)
  return `${url.protocol}//${url.host}`
}
