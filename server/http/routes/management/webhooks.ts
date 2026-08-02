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

  app.post('/requests/:id/retries', async (c) => {
    await requireRequestAccess(c)
    return c.json(webhookRequestSchema.parse(await retryWebhookRequest(getDeps(c), c.req.param('id'))))
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
