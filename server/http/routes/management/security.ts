import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import { updateSecurityPolicySchema } from '@shared/api/security'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getDeps } from '../../middleware/deps'
import type { ManagementAuthApi } from '../auth-api'
import { toBoundaryError } from '../auth-api'
import { readJson, readQuery } from '../validation'

export function managementSecurityRoutes(authApi: ManagementAuthApi) {
  const app = new Hono()

  app.use('*', requireAdmin())

  app.get('/policy', async (c) => c.json({ policy: await getDeps(c).security.getPolicy() }))

  app.patch('/policy', async (c) =>
    c.json({ policy: await getDeps(c).security.updatePolicy(await readJson(c, updateSecurityPolicySchema)) }),
  )

  app.get('/users/:id', async (c) =>
    c.json({ security: await getDeps(c).security.getSecurityState(c.req.param('id')) }),
  )

  app.get('/users/:id/passkeys', async (c) => {
    const page = await getDeps(c).security.listPasskeys(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ passkeys: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/users/:id/passkeys/:passkeyId', async (c) => {
    await getDeps(c).security.deletePasskey(c.req.param('id'), c.req.param('passkeyId'))
    return c.json({ status: true })
  })

  app.get('/users/:id/sessions', async (c) => {
    const page = await getDeps(c).users.listSessions(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ sessions: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/users/:id/sessions', async (c) => {
    try {
      return c.json(
        await authApi.revokeUserSessions({ body: { userId: c.req.param('id') }, headers: c.req.raw.headers }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.delete('/users/:id/sessions/:sessionId', async (c) => {
    const token = await getDeps(c).security.getSessionToken(c.req.param('id'), c.req.param('sessionId'))

    try {
      return c.json(await authApi.revokeUserSession({ body: { sessionToken: token }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  return app
}
