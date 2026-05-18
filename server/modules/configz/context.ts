import type { Context } from 'hono'
import type { SecurityPolicy } from '../../../shared/api/security'
import { createDb } from '../../db/client'
import type { OnboardingRepository } from '../onboarding/repository'
import { createDrizzleConfigzRepository } from './drizzle-repository'
import { ConfigzService } from './service'

export interface ConfigzBindings {
  DB: D1Database
}

export interface ConfigzRuntimeOptions {
  onboardingRepository?: OnboardingRepository
  securityPolicy?: SecurityPolicy
}

export function createConfigzService(c: Context<{ Bindings: ConfigzBindings }>, options: ConfigzRuntimeOptions = {}) {
  const url = new URL(c.req.url)
  const issuer = `${url.protocol}//${url.host}`
  return new ConfigzService(createDrizzleConfigzRepository(createDb(c.env.DB)), {
    issuer,
    magicLinkEnabled: true,
    emailOtpEnabled: true,
    usernameEnabled: true,
    onboardingRepository: options.onboardingRepository,
    securityPolicy: options.securityPolicy,
  })
}
