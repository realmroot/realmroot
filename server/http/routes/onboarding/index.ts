import { forbidden } from '@server/domain/errors'
import { hashPassword } from '@server/domain/password'
import { onboardingAdminRequestSchema } from '@shared/api/onboarding'
import { Hono } from 'hono'
import { getDeps } from '../../middleware/deps'
import { readJson } from '../validation'

export function onboardingRoutes() {
  const app = new Hono()

  app.get('/status', async (c) => c.json({ required: !(await getDeps(c).onboarding.hasUsers()) }))

  app.post('/admin-users', async (c) => {
    const onboarding = getDeps(c).onboarding
    if (await onboarding.hasUsers()) {
      throw forbidden('Onboarding is locked after the first user exists.')
    }

    const body = await readJson(c, onboardingAdminRequestSchema)
    const user = await onboarding.createBootstrapAdmin({
      ...body,
      passwordHash: await hashPassword(body.password),
    })

    return c.json(
      {
        user,
        onboarding: {
          locked: true,
        },
      },
      201,
    )
  })

  return app
}
