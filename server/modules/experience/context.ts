import type { Context } from 'hono'
import { createDb } from '../../db/client'
import { createDrizzleExperienceRepository } from './drizzle-repository'
import { ExperienceService } from './service'

export interface ExperienceBindings {
  DB: D1Database
}

export function createExperienceService(c: Context<{ Bindings: ExperienceBindings }>) {
  const url = new URL(c.req.url)
  const issuer = `${url.protocol}//${url.host}`
  return new ExperienceService(createDrizzleExperienceRepository(createDb(c.env.DB)), {
    issuer,
    magicLinkEnabled: true,
    emailOtpEnabled: true,
    usernameEnabled: true,
  })
}
