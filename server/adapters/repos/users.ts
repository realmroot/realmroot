import { badRequest, notFound } from '@server/domain/errors'
import { hashPassword } from '@server/domain/password'
import type { UserProfile, UserRepository } from '@server/usecases/ports'
import { and, asc, count, desc, eq, isNull, like, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AccountProfileUpdateInput } from '../../../shared/api/account'
import type { AdminUpdateUserInput, AdminUserListQuery } from '../../../shared/api/users'
import type { Database } from '../../db/client'
import { account, application, applicationConsent, session, uploadedAsset, user } from '../../db/schema'

export function createUserRepository(db: Database): UserRepository {
  return {
    async getUser(userId) {
      return findUser(db, userId)
    },

    async listManagedUsers(query) {
      const where = managedUserWhere(query)
      const orderColumn = managedUserSortColumn(query.sortBy)
      const order = query.sortDirection === 'asc' ? asc(orderColumn) : desc(orderColumn)
      const rows = where
        ? await db.select().from(user).where(where).orderBy(order).limit(query.limit).offset(query.offset)
        : await db.select().from(user).orderBy(order).limit(query.limit).offset(query.offset)

      return {
        items: rows.map(mapUser),
        total: await countUsers(db, where),
        limit: query.limit,
        offset: query.offset,
      }
    },

    async createManagedUser(input) {
      const userId = crypto.randomUUID()
      const now = new Date()
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db.insert(user).values({
          id: userId,
          name: input.displayName,
          username: input.username ?? null,
          email: input.email.toLowerCase(),
          emailVerified: false,
          role: roleValue(input.role),
          createdAt: now,
          updatedAt: now,
        }),
      ]

      if (input.password) {
        statements.push(
          db.insert(account).values({
            id: crypto.randomUUID(),
            accountId: userId,
            providerId: 'credential',
            userId,
            password: await hashPassword(input.password),
            createdAt: now,
            updatedAt: now,
          }),
        )
      }

      await db.batch(statements)
      return findUser(db, userId)
    },

    async updateManagedUser(userId, input) {
      const update = managedUserUpdate(input)
      if (Object.keys(update).length === 0) {
        throw badRequest('No user fields were provided.')
      }

      const [updated] = await db.update(user).set(update).where(eq(user.id, userId)).returning()
      if (!updated) {
        throw notFound('User not found.')
      }

      return mapUser(updated)
    },

    async deleteManagedUser(userId) {
      const existing = await findUser(db, userId)
      await db.delete(session).where(eq(session.userId, existing.id))
      await db.delete(user).where(eq(user.id, existing.id))
    },

    async updateProfile(userId, input) {
      if (Object.keys(input).length === 0) {
        throw badRequest('No profile fields were provided.')
      }

      await assertAccountAvatarReference(db, userId, input.avatarAssetId)
      const update = profileUpdate(input)
      const [updated] = await db.update(user).set(update).where(eq(user.id, userId)).returning()

      if (!updated) {
        throw notFound('User not found.')
      }

      return mapUser(updated)
    },

    async assertAccountAvatarReference(userId, avatarAssetId) {
      await assertAccountAvatarReference(db, userId, avatarAssetId)
    },

    async assertAdminAvatarReference(avatarAssetId) {
      await assertAdminAvatarReference(db, avatarAssetId)
    },

    async listLinkedAccounts(userId, page) {
      const rows = await db
        .select({
          id: account.id,
          accountId: account.accountId,
          providerId: account.providerId,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        })
        .from(account)
        .where(eq(account.userId, userId))
        .orderBy(desc(account.createdAt))
        .limit(page.limit)
        .offset(page.offset)

      return {
        items: rows,
        total: await countRows(db, account, eq(account.userId, userId)),
        ...page,
      }
    },

    async listConsentedApplications(userId, page) {
      const where = and(eq(applicationConsent.userId, userId), isNull(applicationConsent.revokedAt))
      const rows = await db
        .select({
          id: applicationConsent.id,
          applicationId: application.id,
          applicationName: application.name,
          applicationSlug: application.slug,
          scopes: applicationConsent.scopes,
          permissions: applicationConsent.permissions,
          grantedAt: applicationConsent.grantedAt,
          expiresAt: applicationConsent.expiresAt,
        })
        .from(applicationConsent)
        .innerJoin(application, eq(applicationConsent.applicationId, application.id))
        .where(where)
        .orderBy(desc(applicationConsent.grantedAt))
        .limit(page.limit)
        .offset(page.offset)

      return {
        items: rows,
        total: await countRows(db, applicationConsent, where),
        ...page,
      }
    },

    async listSessions(userId, page) {
      const rows = await db
        .select({
          id: session.id,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          activeOrganizationId: session.activeOrganizationId,
          impersonatedBy: session.impersonatedBy,
        })
        .from(session)
        .where(eq(session.userId, userId))
        .orderBy(desc(session.createdAt))
        .limit(page.limit)
        .offset(page.offset)

      return {
        items: rows,
        total: await countRows(db, session, eq(session.userId, userId)),
        ...page,
      }
    },

    async getSessionToken(userId, sessionId) {
      const [row] = await db
        .select({ token: session.token })
        .from(session)
        .where(and(eq(session.userId, userId), eq(session.id, sessionId)))

      if (!row) {
        throw notFound('Session not found.')
      }

      return row.token
    },
  }
}

async function countRows(
  db: Database,
  table: typeof account | typeof applicationConsent | typeof session,
  where: ReturnType<typeof eq> | ReturnType<typeof and>,
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(where)
  return row?.value ?? 0
}

async function findUser(db: Database, userId: string): Promise<UserProfile> {
  const [row] = await db.select().from(user).where(eq(user.id, userId))

  if (!row) {
    throw notFound('User not found.')
  }

  return mapUser(row)
}

function managedUserWhere(query: AdminUserListQuery) {
  const conditions: SQL[] = []

  if (query.search) {
    const column = query.searchField === 'name' ? user.name : user.email
    conditions.push(like(column, `%${query.search}%`))
  }

  if (query.role !== undefined) {
    conditions.push(eq(user.role, query.role))
  }

  if (query.banned !== undefined) {
    conditions.push(eq(user.banned, query.banned))
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}

function managedUserSortColumn(sortBy: AdminUserListQuery['sortBy']) {
  if (sortBy === 'updatedAt') return user.updatedAt
  if (sortBy === 'email') return user.email
  if (sortBy === 'name') return user.name
  return user.createdAt
}

async function countUsers(db: Database, where: SQL | undefined): Promise<number> {
  const [row] = where
    ? await db.select({ value: count() }).from(user).where(where)
    : await db.select({ value: count() }).from(user)
  return row?.value ?? 0
}

function managedUserUpdate(input: AdminUpdateUserInput) {
  return {
    ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
    ...(input.emailVerified !== undefined ? { emailVerified: input.emailVerified } : {}),
    ...(input.displayName !== undefined ? { name: input.displayName } : {}),
    ...(input.username !== undefined ? { username: input.username } : {}),
    ...(input.avatarAssetId !== undefined ? { avatarAssetId: input.avatarAssetId } : {}),
    ...(input.role !== undefined ? { role: roleValue(input.role) } : {}),
  }
}

function roleValue(role: string | string[] | undefined) {
  if (Array.isArray(role)) return role.join(',')
  return role
}

async function assertAccountAvatarReference(
  db: Database,
  userId: string,
  avatarAssetId: string | null | undefined,
): Promise<void> {
  if (avatarAssetId === undefined || avatarAssetId === null) {
    return
  }

  const [asset] = await db
    .select({ id: uploadedAsset.id })
    .from(uploadedAsset)
    .where(
      and(
        eq(uploadedAsset.id, avatarAssetId),
        eq(uploadedAsset.purpose, 'avatar'),
        eq(uploadedAsset.createdByUserId, userId),
      ),
    )

  if (!asset) {
    throw badRequest('Avatar asset does not exist for this user.')
  }
}

async function assertAdminAvatarReference(db: Database, avatarAssetId: string | null | undefined): Promise<void> {
  if (avatarAssetId === undefined || avatarAssetId === null) {
    return
  }

  const [asset] = await db
    .select({ id: uploadedAsset.id })
    .from(uploadedAsset)
    .where(and(eq(uploadedAsset.id, avatarAssetId), eq(uploadedAsset.purpose, 'avatar')))

  if (!asset) {
    throw badRequest('Avatar asset does not exist.')
  }
}

function profileUpdate(input: AccountProfileUpdateInput) {
  return {
    ...(input.displayName !== undefined ? { name: input.displayName } : {}),
    ...(input.username !== undefined ? { username: input.username } : {}),
    ...(input.avatarAssetId !== undefined ? { avatarAssetId: input.avatarAssetId } : {}),
  }
}

function mapUser(row: typeof user.$inferSelect): UserProfile {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    displayName: row.name,
    username: row.username,
    avatarAssetId: row.avatarAssetId,
    image: row.image,
    role: row.role,
    banned: row.banned,
    banReason: row.banReason,
    banExpires: row.banExpires,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
