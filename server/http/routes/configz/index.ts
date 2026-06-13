import { getConfig } from '@server/usecases/configz'
import { configzConfigResponseSchema } from '@shared/api/configz'
import type { SecurityPolicy } from '@shared/api/security'
import { Hono } from 'hono'
import { configzOptions } from '../../app-config'
import { getDeps } from '../../middleware/deps'

export function createConfigzRoutes(securityPolicy?: SecurityPolicy) {
  const app = new Hono()

  app.get('/', async (c) =>
    c.json(configzConfigResponseSchema.parse(await getConfig(getDeps(c), configzOptions(c, securityPolicy)))),
  )

  return app
}
