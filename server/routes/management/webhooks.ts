import type { Context } from 'hono'
import { Hono } from 'hono'
import {
  type CreateWebhookEndpointRequest,
  createWebhookEndpointRequestSchema,
  type ListWebhookEndpointsQuery,
  type ListWebhookRequestsQuery,
  listWebhookEndpointsQuerySchema,
  listWebhookEndpointsResponseSchema,
  listWebhookRequestsQuerySchema,
  listWebhookRequestsResponseSchema,
  type UpdateWebhookEndpointRequest,
  updateWebhookEndpointRequestSchema,
  webhookEndpointSchema,
  webhookEndpointSecretResponseSchema,
  webhookRequestSchema,
} from '../../../shared/api/webhooks'
import { requireAdmin } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { createWebhookService, type WebhookBindings } from '../../modules/webhooks/context'
import { readJson, readQuery } from '../validation'

export interface ManagementWebhookService {
  listEndpoints(input: ListWebhookEndpointsQuery): Promise<unknown>
  getEndpoint(id: string): Promise<unknown>
  createEndpoint(input: CreateWebhookEndpointRequest, actorUserId: string): Promise<unknown>
  updateEndpoint(id: string, input: UpdateWebhookEndpointRequest): Promise<unknown>
  deleteEndpoint(id: string): Promise<void>
  rotateSecret(id: string): Promise<unknown>
  listRequests(input: ListWebhookRequestsQuery): Promise<unknown>
  getRequest(id: string): Promise<unknown>
  retryRequest(id: string): Promise<unknown>
}

export type WebhookServiceFactory = (c: Context<{ Bindings: WebhookBindings }>) => ManagementWebhookService

export function createManagementWebhookRoutes(createService: WebhookServiceFactory = (c) => createWebhookService(c)) {
  const app = new Hono<{ Bindings: WebhookBindings }>()

  app.use('*', requireAdmin())

  app.get('/endpoints', async (c) =>
    c.json(
      listWebhookEndpointsResponseSchema.parse(
        await createService(c).listEndpoints(readQuery(c, listWebhookEndpointsQuerySchema)),
      ),
    ),
  )

  app.post('/endpoints', async (c) => {
    const { user } = getAuthContext(c)
    const endpoint = await createService(c).createEndpoint(
      await readJson(c, createWebhookEndpointRequestSchema),
      user!.id,
    )
    return c.json(webhookEndpointSecretResponseSchema.parse(endpoint), 201)
  })

  app.get('/endpoints/:id', async (c) =>
    c.json(webhookEndpointSchema.parse(await createService(c).getEndpoint(c.req.param('id')))),
  )

  app.patch('/endpoints/:id', async (c) =>
    c.json(
      webhookEndpointSchema.parse(
        await createService(c).updateEndpoint(c.req.param('id'), await readJson(c, updateWebhookEndpointRequestSchema)),
      ),
    ),
  )

  app.delete('/endpoints/:id', async (c) => {
    await createService(c).deleteEndpoint(c.req.param('id'))
    return c.body(null, 204)
  })

  app.post('/endpoints/:id/secrets', async (c) => {
    const endpoint = await createService(c).rotateSecret(c.req.param('id'))
    return c.json(webhookEndpointSecretResponseSchema.parse(endpoint), 201)
  })

  app.get('/requests', async (c) =>
    c.json(
      listWebhookRequestsResponseSchema.parse(
        await createService(c).listRequests(readQuery(c, listWebhookRequestsQuerySchema)),
      ),
    ),
  )

  app.get('/requests/:id', async (c) =>
    c.json(webhookRequestSchema.parse(await createService(c).getRequest(c.req.param('id')))),
  )

  app.post('/requests/:id/retries', async (c) =>
    c.json(webhookRequestSchema.parse(await createService(c).retryRequest(c.req.param('id'))), 202),
  )

  return app
}
