import { Hono } from 'hono'
import {
  accountEmailChangeSchema,
  accountPasswordChangeSchema,
  accountProfileUpdateSchema,
} from '../../../shared/api/account'
import { paginationMetadata, paginationQuerySchema } from '../../../shared/api/pagination'
import { badRequest } from '../../lib/errors'
import { requireAuth } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import type { SecurityRepository } from '../../modules/security/repository'
import type { UserRepository } from '../../modules/users/repository'
import type { ManagementAuthApi } from '../auth-api'
import { toBoundaryError } from '../auth-api'
import { readJson, readQuery } from '../validation'
import { accountSecurityRoutes } from './security'

export function accountRoutes(authApi: ManagementAuthApi, users: UserRepository, security?: SecurityRepository) {
  const app = new Hono()

  app.use('*', requireAuth())

  app.get('/profile', async (c) => c.json({ user: await users.getUser(getAuthContext(c).user!.id) }))

  app.patch('/profile', async (c) => {
    const body = await readJson(c, accountProfileUpdateSchema)
    return c.json({ user: await users.updateProfile(getAuthContext(c).user!.id, body) })
  })

  app.post('/email/change', async (c) => {
    const body = await readJson(c, accountEmailChangeSchema)

    try {
      return c.json(
        await authApi.changeEmail({
          body: {
            newEmail: body.email,
            callbackURL: body.callbackURL,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/email/verification', async (c) => {
    const email = getAuthContext(c).user!.email

    if (!email) {
      throw badRequest('Current user email is required.')
    }

    try {
      return c.json(
        await authApi.sendVerificationEmail({
          body: { email },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/password/change', async (c) => {
    const body = await readJson(c, accountPasswordChangeSchema)

    try {
      return c.json(
        await authApi.changePassword({
          body: {
            currentPassword: body.currentPassword,
            newPassword: body.newPassword,
            revokeOtherSessions: body.revokeOtherSessions,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/linked-accounts', async (c) => {
    const page = await users.listLinkedAccounts(getAuthContext(c).user!.id, readQuery(c, paginationQuerySchema))
    return c.json({ accounts: page.items, pagination: paginationMetadata(page) })
  })

  app.get('/applications', async (c) => {
    const page = await users.listConsentedApplications(getAuthContext(c).user!.id, readQuery(c, paginationQuerySchema))
    return c.json({ applications: page.items, pagination: paginationMetadata(page) })
  })

  app.get('/sessions', async (c) => {
    const page = await users.listSessions(getAuthContext(c).user!.id, readQuery(c, paginationQuerySchema))
    return c.json({ sessions: page.items, pagination: paginationMetadata(page) })
  })

  if (security) {
    app.route('/security', accountSecurityRoutes(authApi, users, security))
  }

  return app
}
