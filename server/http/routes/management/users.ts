import { badRequest } from '@server/domain/errors'
import { validateEmailPolicy, validatePasswordPolicy } from '@server/domain/security/policy'
import { listManagementUsersResponseSchema } from '@shared/api/management'
import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import {
  adminBanUserSchema,
  adminCreateUserSchema,
  adminPasswordResetSchema,
  adminUpdateUserSchema,
  adminUserListQuerySchema,
} from '@shared/api/users'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { getDeps } from '../../middleware/deps'
import type { ManagementAuthApi } from '../auth-api'
import { toBoundaryError } from '../auth-api'
import { readJson, readQuery } from '../validation'

interface ManagementUserRoutesOptions {
  normalizeListResponse?: boolean
}

export function managementUserRoutes(authApi: ManagementAuthApi, options: ManagementUserRoutesOptions = {}) {
  const app = new Hono()

  app.use('*', requireAdmin())

  app.get('/', async (c) => {
    const users = getDeps(c).users
    const query = readQuery(c, adminUserListQuerySchema)

    if (getAuthContext(c).bearer) {
      const page = await users.listManagedUsers(query)
      return c.json(
        listManagementUsersResponseSchema.parse({
          users: page.items,
          pagination: paginationMetadata(page),
        }),
      )
    }

    try {
      const response = await authApi.listUsers({
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
      })
      return c.json(
        options.normalizeListResponse
          ? toListUsersResponse(response, { limit: query.limit, offset: query.offset })
          : response,
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/', async (c) => {
    const users = getDeps(c).users
    const body = await readJson(c, adminCreateUserSchema)
    await users.assertAdminAvatarReference(body.avatarAssetId)
    const policy = await getDeps(c).security.getPolicy()
    validateEmailPolicy(body.email, policy.blocklist)
    if (body.password) {
      validatePasswordPolicy(body.password, policy.password, {
        email: body.email,
        name: body.displayName,
        username: body.username ?? null,
      })
    }

    if (getAuthContext(c).bearer) {
      return c.json({ user: await users.createManagedUser(body) }, 201)
    }

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

  const requestPasswordReset = async (c: Context) => {
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
  }

  app.post('/password-reset', requestPasswordReset)
  app.post('/password-reset-requests', requestPasswordReset)

  app.get('/:id', async (c) => c.json({ user: await getDeps(c).users.getUser(c.req.param('id')) }))

  app.post('/:id/password-reset-requests', async (c) => {
    const body = await readJson(c, adminPasswordResetSchema.pick({ redirectTo: true }))
    const user = await getDeps(c).users.getUser(c.req.param('id'))

    try {
      return c.json(
        await authApi.requestPasswordReset({
          body: {
            email: user.email,
            redirectTo: body.redirectTo,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/:id/linked-accounts', async (c) => {
    const page = await getDeps(c).users.listLinkedAccounts(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ accounts: page.items, pagination: paginationMetadata(page) })
  })

  app.get('/:id/applications', async (c) => {
    const page = await getDeps(c).users.listConsentedApplications(
      c.req.param('id'),
      readQuery(c, paginationQuerySchema),
    )
    return c.json({ applications: page.items, pagination: paginationMetadata(page) })
  })

  app.get('/:id/security', async (c) =>
    c.json({ security: await getDeps(c).security.getSecurityState(c.req.param('id')) }),
  )

  app.get('/:id/passkeys', async (c) => {
    const page = await getDeps(c).security.listPasskeys(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ passkeys: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/:id/passkeys/:passkeyId', async (c) => {
    await getDeps(c).security.deletePasskey(c.req.param('id'), c.req.param('passkeyId'))
    return c.body(null, 204)
  })

  app.patch('/:id', async (c) => {
    const users = getDeps(c).users
    const body = await readJson(c, adminUpdateUserSchema)
    await users.assertAdminAvatarReference(body.avatarAssetId)

    if (getAuthContext(c).bearer) {
      return c.json({ user: await users.updateManagedUser(c.req.param('id'), body) })
    }

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

  const banUser = async (c: Context) => {
    const body = await readJson(c, adminBanUserSchema)

    try {
      return c.json(
        await authApi.banUser({
          body: {
            userId: userIdParam(c),
            banReason: body.reason,
            banExpiresIn: body.expiresInSeconds,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  }

  app.post('/:id/ban', banUser)
  app.put('/:id/ban', banUser)

  const unbanUser = async (c: Context) => {
    try {
      return c.json(await authApi.unbanUser({ body: { userId: userIdParam(c) }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  }

  app.post('/:id/unban', unbanUser)
  app.delete('/:id/ban', unbanUser)

  app.delete('/:id', async (c) => {
    const userId = c.req.param('id')
    if (getAuthContext(c).bearer) {
      const actor = getAuthContext(c).user
      if (actor?.id === userId) {
        throw badRequest('You cannot remove yourself.')
      }
      await getDeps(c).users.deleteManagedUser(userId)
      return c.body(null, 204)
    }

    try {
      return c.json(await authApi.removeUser({ body: { userId }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/:id/sessions', async (c) => {
    const page = await getDeps(c).users.listSessions(c.req.param('id'), readQuery(c, paginationQuerySchema))
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
    const token = await getDeps(c).users.getSessionToken(c.req.param('id'), c.req.param('sessionId'))

    try {
      return c.json(await authApi.revokeUserSession({ body: { sessionToken: token }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  return app
}

function userIdParam(c: Context) {
  const userId = c.req.param('id')

  if (!userId) {
    throw badRequest('User id is required.')
  }

  return userId
}

function toListUsersResponse(response: unknown, page: { limit: number; offset: number }) {
  const parsed = z
    .object({
      users: z.array(z.object({ id: z.string() }).passthrough()),
      total: z.number().int().min(0),
    })
    .parse(response)
  const nextOffset = page.offset + page.limit < parsed.total ? page.offset + page.limit : null

  return listManagementUsersResponseSchema.parse({
    users: parsed.users,
    pagination: {
      limit: page.limit,
      offset: page.offset,
      total: parsed.total,
      hasMore: nextOffset !== null,
      nextOffset,
    },
  })
}
