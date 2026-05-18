import { Hono } from 'hono'
import { setupAdminRequestSchema } from '../../../shared/api/setup'
import { forbidden } from '../../lib/errors'
import { hashPassword } from '../../lib/password'
import type { SetupRepository } from '../../modules/setup/repository'
import { readJson } from '../validation'

export function setupRoutes(setup: SetupRepository) {
  const app = new Hono()

  app.get('/', async (c) => c.json({ required: !(await setup.hasUsers()) }))

  app.post('/admin', async (c) => {
    if (await setup.hasUsers()) {
      throw forbidden('Setup is locked after the first user exists.')
    }

    const body = await readJson(c, setupAdminRequestSchema)
    const user = await setup.createBootstrapAdmin({
      ...body,
      passwordHash: await hashPassword(body.password),
    })

    return c.json(
      {
        user,
        setup: {
          locked: true,
        },
      },
      201,
    )
  })

  return app
}
