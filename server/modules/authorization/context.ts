import { createDrizzleAuthorizationRepository } from '@server/adapters/repos/authorization'
import type { Context } from 'hono'
import { createDb } from '../../db/client'
import { AuthorizationService } from './service'

export interface AuthorizationBindings {
  DB: D1Database
}

export function createAuthorizationService(c: Context<{ Bindings: AuthorizationBindings }>) {
  return new AuthorizationService(createDrizzleAuthorizationRepository(createDb(c.env.DB)))
}
