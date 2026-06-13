import { createDrizzleApplicationRepository } from '@server/adapters/repos/applications'
import { ApplicationService } from '@server/usecases/applications'
import type { Context } from 'hono'
import { createDb } from '../../db/client'

export interface ApplicationBindings {
  DB: D1Database
}

export function createApplicationService(c: Context<{ Bindings: ApplicationBindings }>) {
  const url = new URL(c.req.url)
  const issuer = `${url.protocol}//${url.host}`
  return new ApplicationService(createDrizzleApplicationRepository(createDb(c.env.DB)), { issuer })
}
