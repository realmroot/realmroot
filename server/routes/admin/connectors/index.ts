import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import {
  createConnectorRequestSchema,
  paginationQuerySchema,
  updateConnectorRequestSchema,
} from '../../../../shared/api/connectors'
import { requireAdmin } from '../../../middleware/admin'
import { type ConnectorBindings, createConnectorService } from '../../../modules/connectors/context'

export const adminConnectorsRoute = new Hono<{ Bindings: ConnectorBindings }>()

adminConnectorsRoute.use('*', requireAdmin())

adminConnectorsRoute.get('/templates', async (c) => c.json(createConnectorService(c).listTemplates()))

adminConnectorsRoute.get('/', zValidator('query', paginationQuerySchema), async (c) =>
  c.json(await createConnectorService(c).list(c.req.valid('query'))),
)

adminConnectorsRoute.post('/', zValidator('json', createConnectorRequestSchema), async (c) => {
  const connector = await createConnectorService(c).create(c.req.valid('json'), c.env)
  return c.json(connector, 201)
})

adminConnectorsRoute.get('/:connectorId', async (c) =>
  c.json(await createConnectorService(c).get(c.req.param('connectorId'))),
)

adminConnectorsRoute.patch('/:connectorId', zValidator('json', updateConnectorRequestSchema), async (c) =>
  c.json(await createConnectorService(c).update(c.req.param('connectorId'), c.req.valid('json'), c.env)),
)

adminConnectorsRoute.delete('/:connectorId', async (c) => {
  await createConnectorService(c).delete(c.req.param('connectorId'))
  return c.body(null, 204)
})
