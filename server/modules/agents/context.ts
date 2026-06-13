import { createDrizzleAgentRepository } from '@server/adapters/repos/agents'
import { createUserRepository } from '@server/adapters/repos/users'
import { AgentService } from '@server/usecases/agents'
import type { Context } from 'hono'
import { createDb } from '../../db/client'

export interface AgentBindings {
  DB: D1Database
}

export function createAgentService(c: Context<{ Bindings: AgentBindings }>) {
  const db = createDb(c.env.DB)
  return new AgentService(createUserRepository(db), createDrizzleAgentRepository(db))
}
