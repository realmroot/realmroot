import type { Context } from 'hono'
import { createDb } from '../../db/client'
import type { ApplicationBindings } from '../applications/context'
import { createConnectorRepository } from './repository'
import { ConnectorService } from './service'

export type ConnectorBindings = ApplicationBindings

export function createConnectorService(c: Context<{ Bindings: ConnectorBindings }>) {
  return new ConnectorService(createConnectorRepository(createDb(c.env.DB)))
}
