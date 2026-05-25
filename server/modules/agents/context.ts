import type { Context } from 'hono'
import { createDb } from '../../db/client'
import { createUserRepository } from '../users/repository'
import { createDrizzleAgentRepository } from './repository'
import { AgentService } from './service'

export interface AgentBindings {
  DB: D1Database
}

export function createAgentService(c: Context<{ Bindings: AgentBindings }>) {
  const db = createDb(c.env.DB)
  return new AgentService(createUserRepository(db), createDrizzleAgentRepository(db))
}
