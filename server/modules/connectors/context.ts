import { createConnectorRepository } from '@server/adapters/repos/connectors'
import { ConnectorService } from '@server/usecases/connectors'
import type { Context } from 'hono'
import { createDb } from '../../db/client'
import type { ApplicationBindings } from '../applications/context'

export type ConnectorBindings = ApplicationBindings

export function createConnectorService(c: Context<{ Bindings: ConnectorBindings }>) {
  return new ConnectorService(createConnectorRepository(createDb(c.env.DB)))
}
