import type { Context } from 'hono'
import { createDb } from '../../db/client'
import { createDrizzleAuthorizationRepository } from './drizzle-repository'
import { AuthorizationService } from './service'

export interface AuthorizationBindings {
  DB: D1Database
}

export function createAuthorizationService(c: Context<{ Bindings: AuthorizationBindings }>) {
  return new AuthorizationService(createDrizzleAuthorizationRepository(createDb(c.env.DB)))
}
