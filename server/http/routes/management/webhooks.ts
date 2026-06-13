import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  getWebhookRequest,
  listWebhookEndpoints,
  listWebhookRequests,
  retryWebhookRequest,
  rotateWebhookSecret,
  updateWebhookEndpoint,
} from '@server/usecases/webhooks'
import {
  createWebhookEndpointRequestSchema,
  listWebhookEndpointsQuerySchema,
  listWebhookEndpointsResponseSchema,
  listWebhookRequestsQuerySchema,
  listWebhookRequestsResponseSchema,
  updateWebhookEndpointRequestSchema,
  webhookEndpointSchema,
  webhookEndpointSecretResponseSchema,
  webhookRequestSchema,
} from '@shared/api/webhooks'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export function createManagementWebhookRoutes() {
  const app = new Hono()

  app.use('*', requireAdmin())

  app.get('/endpoints', async (c) =>
    c.json(
      listWebhookEndpointsResponseSchema.parse(
        await listWebhookEndpoints(getDeps(c), readQuery(c, listWebhookEndpointsQuerySchema)),
      ),
    ),
  )

  app.post('/endpoints', async (c) => {
    const { user } = getAuthContext(c)
    const endpoint = await createWebhookEndpoint(
      getDeps(c),
      await readJson(c, createWebhookEndpointRequestSchema),
      user!.id,
    )
    return c.json(webhookEndpointSecretResponseSchema.parse(endpoint), 201)
  })

  app.get('/endpoints/:id', async (c) =>
    c.json(webhookEndpointSchema.parse(await getWebhookEndpoint(getDeps(c), c.req.param('id')))),
  )

  app.patch('/endpoints/:id', async (c) =>
    c.json(
      webhookEndpointSchema.parse(
        await updateWebhookEndpoint(
          getDeps(c),
          c.req.param('id'),
          await readJson(c, updateWebhookEndpointRequestSchema),
        ),
      ),
    ),
  )

  app.delete('/endpoints/:id', async (c) => {
    await deleteWebhookEndpoint(getDeps(c), c.req.param('id'))
    return c.body(null, 204)
  })

  app.post('/endpoints/:id/secrets', async (c) => {
    const endpoint = await rotateWebhookSecret(getDeps(c), c.req.param('id'))
    return c.json(webhookEndpointSecretResponseSchema.parse(endpoint), 201)
  })

  app.get('/requests', async (c) =>
    c.json(
      listWebhookRequestsResponseSchema.parse(
        await listWebhookRequests(getDeps(c), readQuery(c, listWebhookRequestsQuerySchema)),
      ),
    ),
  )

  app.get('/requests/:id', async (c) =>
    c.json(webhookRequestSchema.parse(await getWebhookRequest(getDeps(c), c.req.param('id')))),
  )

  app.post('/requests/:id/retries', async (c) =>
    c.json(webhookRequestSchema.parse(await retryWebhookRequest(getDeps(c), c.req.param('id'))), 202),
  )

  return app
}
