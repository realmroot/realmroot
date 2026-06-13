import { type ConfigzBindings, type ConfigzRuntimeOptions, createConfigzService } from '@server/composition'
import type { ConfigzService } from '@server/usecases/configz'
import type { OnboardingRepository } from '@server/usecases/ports'
import { configzConfigResponseSchema } from '@shared/api/configz'
import type { SecurityPolicy } from '@shared/api/security'
import { type Context, Hono } from 'hono'

export type ConfigzServiceFactory = (
  c: Context<{ Bindings: ConfigzBindings }>,
  options?: ConfigzRuntimeOptions,
) => Pick<ConfigzService, 'getConfig'>

export function createConfigzRoutes(
  createService: ConfigzServiceFactory = createConfigzService,
  onboardingRepository?: OnboardingRepository,
  securityPolicy?: SecurityPolicy,
) {
  const app = new Hono<{ Bindings: ConfigzBindings }>()

  app.get('/', async (c) =>
    c.json(
      configzConfigResponseSchema.parse(
        await createService(c, {
          onboardingRepository,
          securityPolicy,
        }).getConfig(),
      ),
    ),
  )

  return app
}
