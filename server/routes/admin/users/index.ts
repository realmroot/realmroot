import { Hono } from 'hono'
import { paginationMetadata, paginationQuerySchema } from '../../../../shared/api/pagination'
import {
  adminBanUserSchema,
  adminCreateUserSchema,
  adminPasswordResetSchema,
  adminUpdateUserSchema,
  adminUserListQuerySchema,
} from '../../../../shared/api/users'
import { requireAdmin } from '../../../middleware/admin'
import type { UserRepository } from '../../../modules/users/repository'
import type { ManagementAuthApi } from '../../auth-api'
import { toBoundaryError } from '../../auth-api'
import { readJson, readQuery } from '../../validation'

export function adminUserRoutes(authApi: ManagementAuthApi, users: UserRepository) {
  const app = new Hono()

  app.use('*', requireAdmin())

  app.get('/', async (c) => {
    const query = readQuery(c, adminUserListQuerySchema)

    try {
      return c.json(
        await authApi.listUsers({
          query: {
            searchValue: query.search,
            searchField: query.searchField,
            limit: query.limit,
            offset: query.offset,
            sortBy: query.sortBy,
            sortDirection: query.sortDirection,
            filterField: query.role !== undefined ? 'role' : query.banned !== undefined ? 'banned' : undefined,
            filterValue: query.role ?? query.banned,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/', async (c) => {
    const body = await readJson(c, adminCreateUserSchema)
    await users.assertAdminAvatarReference(body.avatarAssetId)

    try {
      return c.json(
        await authApi.createUser({
          body: {
            email: body.email,
            password: body.password,
            name: body.displayName,
            role: body.role,
            data: {
              username: body.username,
              avatarAssetId: body.avatarAssetId,
            },
          },
          headers: c.req.raw.headers,
        }),
        201,
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/password-reset', async (c) => {
    const body = await readJson(c, adminPasswordResetSchema)

    try {
      return c.json(
        await authApi.requestPasswordReset({
          body: {
            email: body.email,
            redirectTo: body.redirectTo,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/:id', async (c) => {
    try {
      const user = await authApi.getUser({ query: { id: c.req.param('id') }, headers: c.req.raw.headers })

      return c.json({
        user,
      })
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/:id/linked-accounts', async (c) => {
    const page = await users.listLinkedAccounts(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ accounts: page.items, pagination: paginationMetadata(page) })
  })

  app.get('/:id/applications', async (c) => {
    const page = await users.listConsentedApplications(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ applications: page.items, pagination: paginationMetadata(page) })
  })

  app.patch('/:id', async (c) => {
    const body = await readJson(c, adminUpdateUserSchema)
    await users.assertAdminAvatarReference(body.avatarAssetId)

    try {
      const user = await authApi.adminUpdateUser({
        body: {
          userId: c.req.param('id'),
          data: {
            ...(body.email !== undefined ? { email: body.email } : {}),
            ...(body.emailVerified !== undefined ? { emailVerified: body.emailVerified } : {}),
            ...(body.displayName !== undefined ? { name: body.displayName } : {}),
            ...(body.username !== undefined ? { username: body.username } : {}),
            ...(body.avatarAssetId !== undefined ? { avatarAssetId: body.avatarAssetId } : {}),
            ...(body.role !== undefined ? { role: body.role } : {}),
          },
        },
        headers: c.req.raw.headers,
      })

      return c.json({ user })
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/:id/ban', async (c) => {
    const body = await readJson(c, adminBanUserSchema)

    try {
      return c.json(
        await authApi.banUser({
          body: {
            userId: c.req.param('id'),
            banReason: body.reason,
            banExpiresIn: body.expiresInSeconds,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/:id/unban', async (c) => {
    try {
      return c.json(await authApi.unbanUser({ body: { userId: c.req.param('id') }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.delete('/:id', async (c) => {
    try {
      return c.json(await authApi.removeUser({ body: { userId: c.req.param('id') }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/:id/sessions', async (c) => {
    const page = await users.listSessions(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ sessions: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/:id/sessions', async (c) => {
    try {
      return c.json(
        await authApi.revokeUserSessions({ body: { userId: c.req.param('id') }, headers: c.req.raw.headers }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.delete('/:id/sessions/:sessionId', async (c) => {
    const token = await users.getSessionToken(c.req.param('id'), c.req.param('sessionId'))

    try {
      return c.json(await authApi.revokeUserSession({ body: { sessionToken: token }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  return app
}
