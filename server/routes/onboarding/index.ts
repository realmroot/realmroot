import { hashPassword } from '@server/domain/password'
import type { OnboardingRepository } from '@server/usecases/ports'
import { Hono } from 'hono'
import { onboardingAdminRequestSchema } from '../../../shared/api/onboarding'
import { forbidden } from '../../lib/errors'
import { readJson } from '../validation'

export function onboardingRoutes(onboarding: OnboardingRepository) {
  const app = new Hono()

  app.get('/status', async (c) => c.json({ required: !(await onboarding.hasUsers()) }))

  app.post('/admin-users', async (c) => {
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
