import { badRequest, notFound } from '@server/domain/errors'
import { validateEmailPolicy, validatePasswordPolicy } from '@server/domain/security/policy'
import { publishWebhookEvent } from '@server/usecases/webhooks'
import {
  listManagementUsersResponseSchema,
  managementUserDetailResponseSchema,
  passwordResetRequestResponseSchema,
} from '@shared/api/management'
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
import { getPrincipal, isAutomationPrincipal } from '../../middleware/authn'
import {
  getManagementAuthorization,
  managementOrganizationIds,
  requireManagementRealm,
  requireManagementUser,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import type { ManagementAuthApi } from '../auth-api'
import { toBoundaryError } from '../auth-api'
import { readJson, readQuery } from '../validation'

interface ManagementUserRoutesOptions {
  normalizeListResponse?: boolean
}

export function managementUserRoutes(authApi: ManagementAuthApi, options: ManagementUserRoutesOptions = {}) {
  const app = new Hono()

  app.get('/', async (c) => {
    const users = getDeps(c).users
    const query = readQuery(c, adminUserListQuerySchema)
    const { boundary } = getManagementAuthorization(c)
    const organizationIds = managementOrganizationIds(c, query.organizationId)

    if (isAutomationPrincipal(c) || boundary.kind !== 'realm') {
      const userIds =
        boundary.kind === 'account'
          ? [boundary.accountId]
          : organizationIds
            ? await getDeps(c).authorization.listMemberUserIds([...organizationIds])
            : undefined
      const page = await users.listManagedUsers(query, userIds)
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
    requireManagementRealm(c)
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

    if (isAutomationPrincipal(c)) {
      const user = await users.createManagedUser(body)
      await publishWebhookEvent(getDeps(c), 'user.created', { user: managementUserWebhookData(user) })
      return c.json({ user }, 201)
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

  app.get('/:id', async (c) => {
    await requireManagementUser(c, c.req.param('id'))
    const deps = getDeps(c)
    const user = await deps.users.getUser(c.req.param('id'))
    if (getManagementAuthorization(c).boundary.kind === 'organization') {
      return c.json(managementUserDetailResponseSchema.parse({ user }))
    }
    return c.json(
      managementUserDetailResponseSchema.parse({ user, security: await deps.security.getSecurityState(user.id) }),
    )
  })

  app.post('/:id/password-reset-requests', async (c) => {
    requireManagementRealm(c)
    const body = await readJson(c, adminPasswordResetSchema.pick({ redirectTo: true }))
    const user = await getDeps(c).users.getUser(c.req.param('id'))

    try {
      await authApi.requestPasswordReset({
        body: {
          email: user.email,
          redirectTo: body.redirectTo,
        },
        headers: c.req.raw.headers,
      })
      const request = await getDeps(c).users.createPasswordResetRequest!({
        id: `prr_${crypto.randomUUID()}`,
        userId: user.id,
        status: 'accepted',
        createdAt: new Date(),
      })
      c.header(
        'Location',
        `/api/users/${encodeURIComponent(user.id)}/password-reset-requests/${encodeURIComponent(request.id)}`,
      )
      return c.json(
        passwordResetRequestResponseSchema.parse({ ...request, createdAt: request.createdAt.toISOString() }),
        201,
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/:id/password-reset-requests/:requestId', async (c) => {
    await requireManagementUser(c, c.req.param('id'))
    const request = await getDeps(c).users.findPasswordResetRequest!(c.req.param('id'), c.req.param('requestId'))
    if (!request) throw notFound('Password reset request was not found.')
    return c.json(passwordResetRequestResponseSchema.parse({ ...request, createdAt: request.createdAt.toISOString() }))
  })

  app.get('/:id/suspension', async (c) => {
    await requireManagementUser(c, c.req.param('id'))
    const user = await getDeps(c).users.getUser(c.req.param('id'))
    return c.json({
      userId: user.id,
      suspended: Boolean(user.banned),
      reason: user.banReason ?? null,
      expiresAt: user.banExpires instanceof Date ? user.banExpires.toISOString() : (user.banExpires ?? null),
    })
  })

  app.get('/:id/linked-accounts', async (c) => {
    requireManagementRealm(c)
    const page = await getDeps(c).users.listLinkedAccounts(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ accounts: page.items, pagination: paginationMetadata(page) })
  })

  app.get('/:id/passkeys', async (c) => {
    requireManagementRealm(c)
    const page = await getDeps(c).security.listPasskeys(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ passkeys: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/:id/passkeys/:passkeyId', async (c) => {
    requireManagementRealm(c)
    await getDeps(c).security.deletePasskey(c.req.param('id'), c.req.param('passkeyId'))
    return c.body(null, 204)
  })

  app.patch('/:id', async (c) => {
    requireManagementRealm(c)
    const users = getDeps(c).users
    const body = await readJson(c, adminUpdateUserSchema)
    await users.assertAdminAvatarReference(body.avatarAssetId)

    if (isAutomationPrincipal(c)) {
      const user = await users.updateManagedUser(c.req.param('id'), body)
      await publishWebhookEvent(getDeps(c), 'user.updated', { user: managementUserWebhookData(user) })
      return c.json({ user })
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
    requireManagementRealm(c)
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

  app.put('/:id/suspension', banUser)

  const unbanUser = async (c: Context) => {
    requireManagementRealm(c)
    try {
      return c.json(await authApi.unbanUser({ body: { userId: userIdParam(c) }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  }

  app.delete('/:id/suspension', unbanUser)

  app.delete('/:id', async (c) => {
    const userId = c.req.param('id')
    requireManagementRealm(c)
    if (isAutomationPrincipal(c)) {
      const actor = getPrincipal(c).user
      if (actor?.id === userId) {
        throw badRequest('You cannot remove yourself.')
      }
      const user = await getDeps(c).users.getUser(userId)
      await getDeps(c).users.deleteManagedUser(userId)
      await publishWebhookEvent(getDeps(c), 'user.deleted', { user: managementUserWebhookData(user) })
      return c.body(null, 204)
    }

    try {
      return c.json(await authApi.removeUser({ body: { userId }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/:id/sessions', async (c) => {
    requireManagementRealm(c)
    const page = await getDeps(c).users.listSessions(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ sessions: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/:id/sessions', async (c) => {
    requireManagementRealm(c)
    try {
      return c.json(
        await authApi.revokeUserSessions({ body: { userId: c.req.param('id') }, headers: c.req.raw.headers }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/:id/sessions/:sessionId', async (c) => {
    requireManagementRealm(c)
    const page = await getDeps(c).users.listSessions(c.req.param('id'), { limit: 100, offset: 0 })
    const session = page.items.find(({ id }) => id === c.req.param('sessionId'))
    if (!session) throw notFound('User session was not found.')
    return c.json(session)
  })

  app.delete('/:id/sessions/:sessionId', async (c) => {
    requireManagementRealm(c)
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

function managementUserWebhookData(user: object) {
  const record = user as Record<string, unknown>
  const fields = ['id', 'email', 'emailVerified', 'displayName', 'username', 'role', 'createdAt', 'updatedAt']
  return Object.fromEntries(
    fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]),
  )
}
