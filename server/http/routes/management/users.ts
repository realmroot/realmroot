import { badRequest, forbidden, notFound } from '@server/domain/errors'
import { validateEmailPolicy, validatePasswordPolicy } from '@server/domain/security/policy'
import { listApplicationAuthorizations } from '@server/usecases/applications'
import { publishWebhookEvent } from '@server/usecases/webhooks'
import {
  listApplicationAuthorizationsQuerySchema,
  listApplicationAuthorizationsResponseSchema,
} from '@shared/api/applications'
import {
  listManagementUsersResponseSchema,
  managementUserDetailResponseSchema,
  passwordResetRequestResponseSchema,
} from '@shared/api/management'
import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import {
  adminBanUserSchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  adminUserListQuerySchema,
} from '@shared/api/users'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { getPrincipal } from '../../middleware/authn'
import {
  authorizedOrganizationIds,
  authorizePlatformOrganization,
  hasPlatformOrganizationAccess,
} from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import type { ManagementAuthApi } from '../auth-api'
import { toBoundaryError } from '../auth-api'
import { readJson, readQuery } from '../validation'

interface ManagementUserRoutesOptions {
  normalizeListResponse?: boolean
}

export function managementUserRoutes(authApi: ManagementAuthApi, _options: ManagementUserRoutesOptions = {}) {
  const app = new Hono()

  app.get('/', async (c) => {
    const users = getDeps(c).users
    const query = readQuery(c, adminUserListQuerySchema)
    const organizationIds = await filterOrganizationSelection(c, query.organizationId)

    const userIds = organizationIds ? await getDeps(c).authorization.listMemberUserIds(organizationIds) : undefined
    const page = await users.listManagedUsers(query, userIds)
    return c.json(
      listManagementUsersResponseSchema.parse({
        items: page.items,
        pagination: paginationMetadata(page),
      }),
    )
  })

  app.post('/', async (c) => {
    await authorizePlatformOrganization(c, 'users:write')
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

    const user = await users.createManagedUser(body)
    await publishWebhookEvent(getDeps(c), 'user.created', { user: managementUserWebhookData(user) })
    return c.json({ user }, 201)
  })

  app.get('/:id/application-authorizations', async (c) => {
    await requireManagedUserRead(c, c.req.param('id'))
    const query = readQuery(c, listApplicationAuthorizationsQuerySchema)
    return c.json(
      listApplicationAuthorizationsResponseSchema.parse(
        await listApplicationAuthorizations(
          getDeps(c),
          { ...query, userId: c.req.param('id'), status: 'active' },
          await authorizedOrganizationIds(c, 'applications:read'),
        ),
      ),
    )
  })

  app.get('/:id', async (c) => {
    await requireManagedUserRead(c, c.req.param('id'))
    const deps = getDeps(c)
    const user = await deps.users.getUser(c.req.param('id'))
    if (!(await hasPlatformOrganizationAccess(c, 'users:read'))) {
      return c.json(managementUserDetailResponseSchema.parse({ user }))
    }
    return c.json(
      managementUserDetailResponseSchema.parse({ user, security: await deps.security.getSecurityState(user.id) }),
    )
  })

  app.post('/:id/password-reset-requests', async (c) => {
    await authorizePlatformOrganization(c, 'users:write')
    const user = await getDeps(c).users.getUser(c.req.param('id'))

    try {
      await authApi.requestPasswordReset({
        body: {
          email: user.email,
          redirectTo: new URL('/auth/forgot-password?mode=link', c.req.url).toString(),
        },
        headers: c.req.raw.headers,
      })
      const deps = getDeps(c)
      const request = await deps.users.createPasswordResetRequest!({
        id: deps.ids.generate(),
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
    await authorizePlatformOrganization(c, 'users:read')
    const request = await getDeps(c).users.findPasswordResetRequest!(c.req.param('id'), c.req.param('requestId'))
    if (!request) throw notFound('Password reset request was not found.')
    return c.json(passwordResetRequestResponseSchema.parse({ ...request, createdAt: request.createdAt.toISOString() }))
  })

  app.get('/:id/suspension', async (c) => {
    await authorizePlatformOrganization(c, 'users:read')
    const user = await getDeps(c).users.getUser(c.req.param('id'))
    return c.json({
      userId: user.id,
      suspended: Boolean(user.banned),
      reason: user.banReason ?? null,
      expiresAt: user.banExpires instanceof Date ? user.banExpires.toISOString() : (user.banExpires ?? null),
    })
  })

  app.get('/:id/linked-accounts', async (c) => {
    await authorizePlatformOrganization(c, 'users:read')
    const page = await getDeps(c).users.listLinkedAccounts(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ items: page.items, pagination: paginationMetadata(page) })
  })

  app.get('/:id/passkeys', async (c) => {
    await authorizePlatformOrganization(c, 'users:read')
    const page = await getDeps(c).security.listPasskeys(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ items: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/:id/passkeys/:passkeyId', async (c) => {
    await authorizePlatformOrganization(c, 'users:write')
    await getDeps(c).security.deletePasskey(c.req.param('id'), c.req.param('passkeyId'))
    return c.body(null, 204)
  })

  app.patch('/:id', async (c) => {
    await authorizePlatformOrganization(c, 'users:write')
    const users = getDeps(c).users
    const body = await readJson(c, adminUpdateUserSchema)
    await users.assertAdminAvatarReference(body.avatarAssetId)

    const user = await users.updateManagedUser(c.req.param('id'), body)
    await publishWebhookEvent(getDeps(c), 'user.updated', { user: managementUserWebhookData(user) })
    return c.json({ user })
  })

  const banUser = async (c: Context) => {
    await authorizePlatformOrganization(c, 'users:write')
    const body = await readJson(c, adminBanUserSchema)
    const expiresAt = body.expiresInSeconds ? new Date(Date.now() + body.expiresInSeconds * 1000) : null
    const user = await getDeps(c).users.suspendManagedUser(userIdParam(c), body.reason ?? null, expiresAt)
    await publishWebhookEvent(getDeps(c), 'user.updated', { user: managementUserWebhookData(user) })
    return c.json({ user })
  }

  app.put('/:id/suspension', banUser)

  const unbanUser = async (c: Context) => {
    await authorizePlatformOrganization(c, 'users:write')
    const user = await getDeps(c).users.restoreManagedUser(userIdParam(c))
    await publishWebhookEvent(getDeps(c), 'user.updated', { user: managementUserWebhookData(user) })
    return c.json({ user })
  }

  app.delete('/:id/suspension', unbanUser)

  app.delete('/:id', async (c) => {
    await authorizePlatformOrganization(c, 'users:write')
    const userId = c.req.param('id')
    const actor = getPrincipal(c).user
    if (actor?.id === userId) throw badRequest('You cannot remove yourself.')
    const user = await getDeps(c).users.getUser(userId)
    await getDeps(c).users.deleteManagedUser(userId)
    await publishWebhookEvent(getDeps(c), 'user.deleted', { user: managementUserWebhookData(user) })
    return c.body(null, 204)
  })

  app.get('/:id/sessions', async (c) => {
    await authorizePlatformOrganization(c, 'users:read')
    const page = await getDeps(c).users.listSessions(c.req.param('id'), readQuery(c, paginationQuerySchema))
    return c.json({ items: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/:id/sessions', async (c) => {
    await authorizePlatformOrganization(c, 'users:write')
    const sessions = await getDeps(c).users.deleteSessions(c.req.param('id'))
    await publishRevokedSessions(c, c.req.param('id'), sessions)
    return c.body(null, 204)
  })

  app.get('/:id/sessions/:sessionId', async (c) => {
    await authorizePlatformOrganization(c, 'users:read')
    const page = await getDeps(c).users.listSessions(c.req.param('id'), { limit: 100, offset: 0 })
    const session = page.items.find(({ id }) => id === c.req.param('sessionId'))
    if (!session) throw notFound('User session was not found.')
    return c.json(session)
  })

  app.delete('/:id/sessions/:sessionId', async (c) => {
    await authorizePlatformOrganization(c, 'users:write')
    const sessions = await getDeps(c).users.deleteSessions(c.req.param('id'), c.req.param('sessionId'))
    if (sessions.length === 0) throw notFound('Session not found.')
    await publishRevokedSessions(c, c.req.param('id'), sessions)
    return c.body(null, 204)
  })

  return app
}

async function filterOrganizationSelection(c: Context, requestedOrganizationId?: string) {
  const allowed = await authorizedOrganizationIds(c, 'users:read')
  if (!allowed) return requestedOrganizationId ? [requestedOrganizationId] : undefined
  if (!requestedOrganizationId) return allowed
  return allowed.includes(requestedOrganizationId) ? [requestedOrganizationId] : []
}

async function requireManagedUserRead(c: Context, userId: string) {
  if (await hasPlatformOrganizationAccess(c, 'users:read')) return
  const organizationIds = await authorizedOrganizationIds(c, 'users:read')
  if (!organizationIds?.length) throw forbidden()
  const allowedUserIds = await getDeps(c).authorization.listMemberUserIds(organizationIds)
  if (!allowedUserIds.includes(userId)) throw forbidden()
}

function userIdParam(c: Context) {
  const userId = c.req.param('id')

  if (!userId) {
    throw badRequest('User id is required.')
  }

  return userId
}

function managementUserWebhookData(user: object) {
  const record = user as Record<string, unknown>
  const fields = ['id', 'email', 'emailVerified', 'displayName', 'username', 'role', 'createdAt', 'updatedAt']
  return Object.fromEntries(
    fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]),
  )
}

async function publishRevokedSessions(
  c: Context,
  userId: string,
  sessions: Awaited<ReturnType<ReturnType<typeof getDeps>['users']['deleteSessions']>>,
) {
  for (const session of sessions) {
    await publishWebhookEvent(getDeps(c), 'session.revoked', {
      session: { ...session, userId },
    })
  }
}
