import { badRequest, notFound } from '@server/domain/errors'
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
import type { Context } from 'hono'
import { Hono } from 'hono'
import { getActorUserId } from '../../middleware/authn'
import {
  authorizedOrganizationIds,
  authorizedOrganizationOwnerId,
  authorizeOrganization,
  authorizeOrganizationOwner,
  authorizePlatformOrganization,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export function createManagementWebhookRoutes() {
  const app = new Hono()

  app.get('/', async (c) =>
    c.json(
      listWebhookEndpointsResponseSchema.parse(
        await listWebhookEndpoints(
          getDeps(c),
          readQuery(c, listWebhookEndpointsQuerySchema),
          await authorizedOrganizationIds(c, 'webhooks:read'),
        ),
      ),
    ),
  )

  app.post('/', async (c) => {
    const input = await readJson(c, createWebhookEndpointRequestSchema)
    const organizationId = await authorizedWebhookOrganizationId(c, input.organizationId ?? null)
    const endpoint = await createWebhookEndpoint(getDeps(c), { ...input, organizationId }, getActorUserId(c))
    c.header('Location', `/api/webhooks/${encodeURIComponent(endpoint.endpoint.id)}`)
    return c.json(webhookEndpointSecretResponseSchema.parse(endpoint), 201)
  })

  app.get('/:webhookId', async (c) => c.json(webhookEndpointSchema.parse(await requireEndpointAccess(c))))

  app.patch('/:webhookId', async (c) => {
    await requireEndpointAccess(c)
    const input = await readJson(c, updateWebhookEndpointRequestSchema)
    const organizationId =
      input.organizationId === undefined ? undefined : await authorizedWebhookOrganizationId(c, input.organizationId)
    return c.json(
      webhookEndpointSchema.parse(
        await updateWebhookEndpoint(getDeps(c), c.req.param('webhookId'), { ...input, organizationId }),
      ),
    )
  })

  app.delete('/:webhookId', async (c) => {
    await requireEndpointAccess(c)
    await deleteWebhookEndpoint(getDeps(c), c.req.param('webhookId'))
    return c.body(null, 204)
  })

  app.post('/:webhookId/secrets', async (c) => {
    await requireEndpointAccess(c)
    const endpoint = await rotateWebhookSecret(getDeps(c), c.req.param('webhookId'))
    return c.json(webhookEndpointSecretResponseSchema.parse(endpoint), 201)
  })

  app.get('/:webhookId/deliveries', async (c) => {
    await requireEndpointAccess(c)
    const query = readQuery(c, listWebhookRequestsQuerySchema.omit({ endpointId: true }))
    return c.json(
      listWebhookRequestsResponseSchema.parse(
        await listWebhookRequests(
          getDeps(c),
          { ...query, endpointId: c.req.param('webhookId') },
          await authorizedOrganizationIds(c, 'webhooks:read'),
        ),
      ),
    )
  })

  app.get('/:webhookId/deliveries/:deliveryId', async (c) =>
    c.json(webhookRequestSchema.parse(await requireRequestAccess(c))),
  )

  app.get('/:webhookId/deliveries/:deliveryId/attempts', async (c) => {
    await requireRequestAccess(c)
    return c.json(
      listWebhookDeliveryAttemptsResponseSchema.parse(
        await listWebhookDeliveryAttempts(
          getDeps(c),
          c.req.param('deliveryId'),
          readQuery(c, listWebhookRequestsQuerySchema.pick({ limit: true, offset: true })),
        ),
      ),
    )
  })

  app.post('/:webhookId/deliveries/:deliveryId/attempts', async (c) => {
    await requireRequestAccess(c)
    const parsedKey = idempotencyKeySchema.safeParse(c.req.header('Idempotency-Key'))
    if (!parsedKey.success) throw badRequest('Idempotency-Key header is required and must contain 1 to 200 characters.')
    const { attempt, replayed } = await createWebhookDeliveryAttempt(
      getDeps(c),
      c.req.param('deliveryId'),
      parsedKey.data,
    )
    c.header(
      'Location',
      `/api/webhooks/${encodeURIComponent(c.req.param('webhookId'))}/deliveries/${encodeURIComponent(c.req.param('deliveryId'))}/attempts/${encodeURIComponent(attempt.id)}`,
    )
    if (replayed) c.header('Idempotency-Replayed', 'true')
    return c.json(webhookDeliveryAttemptSchema.parse(attempt), 201)
  })

  app.get('/:webhookId/deliveries/:deliveryId/attempts/:attemptId', async (c) => {
    await requireRequestAccess(c)
    return c.json(
      webhookDeliveryAttemptSchema.parse(
        await getWebhookDeliveryAttempt(getDeps(c), c.req.param('deliveryId'), c.req.param('attemptId')),
      ),
    )
  })

  return app
}

async function authorizedWebhookOrganizationId(c: Context, organizationId: string | null) {
  if (organizationId) {
    return authorizedOrganizationOwnerId(await authorizeOrganizationOwner(c, organizationId, 'webhooks:write'))
  }
  await authorizePlatformOrganization(c, 'webhooks:write')
  return null
}

async function requireEndpointAccess(c: Context) {
  const endpoint = await getWebhookEndpoint(getDeps(c), c.req.param('webhookId')!)
  const scope = c.req.method === 'GET' || c.req.method === 'HEAD' ? 'webhooks:read' : 'webhooks:write'
  if (endpoint.organizationId) await authorizeOrganization(c, endpoint.organizationId, scope)
  else await authorizePlatformOrganization(c, scope)
  return endpoint
}

async function requireRequestAccess(c: Context) {
  const request = await getWebhookRequest(getDeps(c), c.req.param('deliveryId')!)
  if (request.endpointId !== c.req.param('webhookId')) throw notFound('Webhook delivery was not found.')
  const scope = c.req.method === 'GET' || c.req.method === 'HEAD' ? 'webhooks:read' : 'webhooks:write'
  if (request.organizationId) await authorizeOrganization(c, request.organizationId, scope)
  else await authorizePlatformOrganization(c, scope)
  return request
}
