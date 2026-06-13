import {
  connectorReadiness,
  createConnector,
  deleteConnector,
  getConnector,
  listConnectors,
  listConnectorTemplates,
  updateConnector,
} from '@server/usecases/connectors'
import { connectorReadinessResponseSchema, listConnectorTemplatesResponseSchema } from '@shared/api/connectors'
import {
  createManagementConnectorRequestSchema,
  listManagementConnectorsResponseSchema,
  managementConnectorResponseSchema,
  paginationQuerySchema,
  updateManagementConnectorRequestSchema,
} from '@shared/api/management'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getDeps } from '../../middleware/deps'
import { readJson, readQuery } from '../validation'

export function createManagementConnectorRoutes() {
  const app = new Hono()

  app.use('*', requireAdmin())

  app.get('/templates', async (c) => c.json(listConnectorTemplatesResponseSchema.parse(listConnectorTemplates())))

  app.get('/', async (c) =>
    c.json(
      listManagementConnectorsResponseSchema.parse(
        await listConnectors(getDeps(c), readQuery(c, paginationQuerySchema)),
      ),
    ),
  )

  app.post('/', async (c) => {
    const connector = await createConnector(getDeps(c), await readJson(c, createManagementConnectorRequestSchema))
    return c.json(managementConnectorResponseSchema.parse(connector), 201)
  })

  app.get('/:id', async (c) =>
    c.json(managementConnectorResponseSchema.parse(await getConnector(getDeps(c), c.req.param('id')))),
  )

  app.get('/:id/readiness', async (c) =>
    c.json(connectorReadinessResponseSchema.parse(await connectorReadiness(getDeps(c), c.req.param('id')))),
  )

  app.patch('/:id', async (c) => {
    const connector = await updateConnector(
      getDeps(c),
      c.req.param('id'),
      await readJson(c, updateManagementConnectorRequestSchema),
    )
    return c.json(managementConnectorResponseSchema.parse(connector))
  })

  app.delete('/:id', async (c) => {
    await deleteConnector(getDeps(c), c.req.param('id'))
    return c.body(null, 204)
  })

  return app
}
