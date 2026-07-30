import { updateSecurityPolicySchema } from '@shared/api/security'
import { Hono } from 'hono'
import { getDeps } from '../../middleware/deps'
import { readJson } from '../validation'

export function managementSecurityRoutes() {
  const app = new Hono()

  app.get('/policy', async (c) => c.json({ policy: await getDeps(c).security.getPolicy() }))

  app.patch('/policy', async (c) =>
    c.json({ policy: await getDeps(c).security.updatePolicy(await readJson(c, updateSecurityPolicySchema)) }),
  )

  return app
}
