import type { Context } from 'hono'
import { Hono } from 'hono'
import {
  createManagementConnectorRequestSchema,
  listManagementConnectorsResponseSchema,
  managementConnectorResponseSchema,
  paginationQuerySchema,
  updateManagementConnectorRequestSchema,
} from '../../../shared/api/management'
import { requireAdmin } from '../../middleware/admin'
import { type ConnectorBindings, createConnectorService } from '../../modules/connectors/context'
import { readJson, readQuery } from '../validation'

export interface ManagementConnectorService {
  list(page: { limit: number; offset: number }): Promise<unknown>
  create(input: unknown): Promise<unknown>
  get(id: string): Promise<unknown>
  update(id: string, input: unknown): Promise<unknown>
  delete(id: string): Promise<void>
}

export type ConnectorServiceFactory = (c: Context<{ Bindings: ConnectorBindings }>) => ManagementConnectorService

export function createManagementConnectorRoutes(
  createService: ConnectorServiceFactory = (c) => createConnectorService(c),
) {
  const app = new Hono<{ Bindings: ConnectorBindings }>()

  app.use('*', requireAdmin())

  app.get('/', async (c) =>
    c.json(
      listManagementConnectorsResponseSchema.parse(await createService(c).list(readQuery(c, paginationQuerySchema))),
    ),
  )

  app.post('/', async (c) => {
    const connector = await createService(c).create(await readJson(c, createManagementConnectorRequestSchema))
    return c.json(managementConnectorResponseSchema.parse(connector), 201)
  })

  app.get('/:id', async (c) =>
    c.json(managementConnectorResponseSchema.parse(await createService(c).get(c.req.param('id')))),
  )

  app.patch('/:id', async (c) => {
    const connector = await createService(c).update(
      c.req.param('id'),
      await readJson(c, updateManagementConnectorRequestSchema),
    )
    return c.json(managementConnectorResponseSchema.parse(connector))
  })

  app.delete('/:id', async (c) => {
    await createService(c).delete(c.req.param('id'))
    return c.body(null, 204)
  })

  return app
}
