import { badRequest } from '@server/domain/errors'
import {
  createWebhookDeliveryAttempt,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookDeliveryAttempt,
  getWebhookEndpoint,
  getWebhookRequest,
  listWebhookDeliveryAttempts,
  listWebhookEndpoints,
  listWebhookRequests,
  rotateWebhookSecret,
  updateWebhookEndpoint,
} from '@server/usecases/webhooks'
import {
  createWebhookEndpointRequestSchema,
  idempotencyKeySchema,
  listWebhookDeliveryAttemptsResponseSchema,
  listWebhookEndpointsQuerySchema,
  listWebhookEndpointsResponseSchema,
  listWebhookRequestsQuerySchema,
  listWebhookRequestsResponseSchema,
  updateWebhookEndpointRequestSchema,
  webhookDeliveryAttemptSchema,
  webhookEndpointSchema,
  webhookEndpointSecretResponseSchema,
  webhookRequestSchema,
} from '@shared/api/webhooks'
import { Hono } from 'hono'
import { getActorUserId } from '../../middleware/authn'
import { getConsoleOrganizationScope, requireConsoleOwnedOrganization } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export function createManagementWebhookRoutes() {
  const app = new Hono()

  app.get('/endpoints', async (c) =>
    c.json(
      listWebhookEndpointsResponseSchema.parse(
        await listWebhookEndpoints(
          getDeps(c),
          readQuery(c, listWebhookEndpointsQuerySchema),
          getConsoleOrganizationScope(c) ?? undefined,
        ),
      ),
    ),
  )

  app.post('/endpoints', async (c) => {
    const input = await readJson(c, createWebhookEndpointRequestSchema)
    requireConsoleOwnedOrganization(c, input.organizationId)
    const endpoint = await createWebhookEndpoint(getDeps(c), input, getActorUserId(c))
    c.header('Location', `/api/webhooks/endpoints/${encodeURIComponent(endpoint.endpoint.id)}`)
    return c.json(webhookEndpointSecretResponseSchema.parse(endpoint), 201)
  })

  app.get('/endpoints/:id', async (c) => c.json(webhookEndpointSchema.parse(await requireEndpointAccess(c))))

  app.patch('/endpoints/:id', async (c) => {
    await requireEndpointAccess(c)
    const input = await readJson(c, updateWebhookEndpointRequestSchema)
    if (input.organizationId !== undefined) requireConsoleOwnedOrganization(c, input.organizationId)
    return c.json(webhookEndpointSchema.parse(await updateWebhookEndpoint(getDeps(c), c.req.param('id'), input)))
  })

  app.delete('/endpoints/:id', async (c) => {
    await requireEndpointAccess(c)
    await deleteWebhookEndpoint(getDeps(c), c.req.param('id'))
    return c.body(null, 204)
  })

  app.post('/endpoints/:id/secrets', async (c) => {
    await requireEndpointAccess(c)
    const endpoint = await rotateWebhookSecret(getDeps(c), c.req.param('id'))
    return c.json(webhookEndpointSecretResponseSchema.parse(endpoint), 201)
  })

  app.get('/requests', async (c) =>
    c.json(
      listWebhookRequestsResponseSchema.parse(
        await listWebhookRequests(
          getDeps(c),
          readQuery(c, listWebhookRequestsQuerySchema),
          getConsoleOrganizationScope(c) ?? undefined,
        ),
      ),
    ),
  )

  app.get('/requests/:id', async (c) => c.json(webhookRequestSchema.parse(await requireRequestAccess(c))))

  app.get('/requests/:id/attempts', async (c) => {
    await requireRequestAccess(c)
    return c.json(
      listWebhookDeliveryAttemptsResponseSchema.parse(
        await listWebhookDeliveryAttempts(
          getDeps(c),
          c.req.param('id'),
          readQuery(c, listWebhookRequestsQuerySchema.pick({ limit: true, offset: true })),
        ),
      ),
    )
  })

  app.post('/requests/:id/attempts', async (c) => {
    await requireRequestAccess(c)
    const parsedKey = idempotencyKeySchema.safeParse(c.req.header('Idempotency-Key'))
    if (!parsedKey.success) throw badRequest('Idempotency-Key header is required and must contain 1 to 200 characters.')
    const { attempt, replayed } = await createWebhookDeliveryAttempt(getDeps(c), c.req.param('id'), parsedKey.data)
    c.header(
      'Location',
      `/api/webhooks/requests/${encodeURIComponent(c.req.param('id'))}/attempts/${encodeURIComponent(attempt.id)}`,
    )
    if (replayed) c.header('Idempotency-Replayed', 'true')
    return c.json(webhookDeliveryAttemptSchema.parse(attempt), 201)
  })

  app.get('/requests/:id/attempts/:attemptId', async (c) => {
    await requireRequestAccess(c)
    return c.json(
      webhookDeliveryAttemptSchema.parse(
        await getWebhookDeliveryAttempt(getDeps(c), c.req.param('id'), c.req.param('attemptId')),
      ),
    )
  })

  return app
}

async function requireEndpointAccess(c: Parameters<typeof getConsoleOrganizationScope>[0]) {
  const endpoint = await getWebhookEndpoint(getDeps(c), c.req.param('id')!)
  requireConsoleOwnedOrganization(c, endpoint.organizationId)
  return endpoint
}

async function requireRequestAccess(c: Parameters<typeof getConsoleOrganizationScope>[0]) {
  const request = await getWebhookRequest(getDeps(c), c.req.param('id')!)
  requireConsoleOwnedOrganization(c, request.organizationId)
  return request
}
