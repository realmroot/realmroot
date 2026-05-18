import { Hono } from 'hono'
import { paginationMetadata, paginationQuerySchema } from '../../../../shared/api/pagination'
import type { SecurityPolicy } from '../../../../shared/api/security'
import { requireAdmin } from '../../../middleware/admin'
import type { SecurityRepository } from '../../../modules/security/repository'
import type { UserRepository } from '../../../modules/users/repository'
import type { ManagementAuthApi } from '../../auth-api'
import { toBoundaryError } from '../../auth-api'
import { readQuery } from '../../validation'

export function adminSecurityRoutes(
  authApi: ManagementAuthApi,
  users: UserRepository,
  security: SecurityRepository,
  policy: SecurityPolicy,
) {
  const app = new Hono()

  app.use('*', requireAdmin())

  app.get('/policy', (c) => c.json({ policy }))

  app.get('/users/:id', async (c) => c.json({ security: await security.getSecurityState(c.req.param('id')) }))

  app.get('/users/:id/passkeys', async (c) => {
    const page = await security.listPasskeys(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ passkeys: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/users/:id/passkeys/:passkeyId', async (c) => {
    await security.deletePasskey(c.req.param('id'), c.req.param('passkeyId'))
    return c.json({ status: true })
  })

  app.get('/users/:id/sessions', async (c) => {
    const page = await users.listSessions(c.req.param('id'), readQuery(c, paginationQuerySchema))
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
    const token = await security.getSessionToken(c.req.param('id'), c.req.param('sessionId'))

    try {
      return c.json(await authApi.revokeUserSession({ body: { sessionToken: token }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  return app
}
