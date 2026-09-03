import { badRequest, notFound } from '@server/domain/errors'
import { hashPassword } from '@server/domain/password'
import type { IdentifierGenerator } from '@server/usecases/identifier-generator'
import type { UserProfile, UserRepository } from '@server/usecases/ports'
import { and, asc, count, desc, eq, inArray, like, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AccountProfileUpdateInput } from '../../../shared/api/account'
import type { AdminUpdateUserInput, AdminUserListQuery } from '../../../shared/api/users'
import type { Database } from '../../db/client'
import { account, passwordResetRequest, session, uploadedAsset, user, userProfile } from '../../db/schema'

export function createUserRepository(db: Database, ids: IdentifierGenerator): UserRepository {
  return {
    async getUser(userId) {
      return findUser(db, userId)
    },

    async getPublicProfile(userId) {
      return loadPublicProfile(db, await findUser(db, userId))
    },

    async findPublicProfileByUsername(username) {
      const [row] = await db.select().from(user).where(eq(user.username, username)).limit(1)
      return row ? loadPublicProfile(db, mapUser(row)) : null
    },

    async listManagedUsers(query, userIds) {
      if (userIds?.length === 0) return { items: [], total: 0, limit: query.limit, offset: query.offset }
      const queryCondition = managedUserWhere(query)
      const where = userIds ? and(queryCondition, inArray(user.id, userIds)) : queryCondition
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
      const userId = ids.generate()
      const now = new Date()
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db.insert(user).values({
          id: userId,
          name: input.displayName,
          username: input.username ?? null,
          email: input.email.toLowerCase(),
          emailVerified: false,
          role: 'user',
          createdAt: now,
          updatedAt: now,
        }),
      ]

      if (input.password) {
        statements.push(
          db.insert(account).values({
            id: ids.generate(),
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

    async suspendManagedUser(userId, reason, expiresAt) {
      const [updated] = await db
        .update(user)
        .set({ banned: true, banReason: reason, banExpires: expiresAt })
        .where(eq(user.id, userId))
        .returning()
      if (!updated) throw notFound('User not found.')
      return mapUser(updated)
    },

    async restoreManagedUser(userId) {
      const [updated] = await db
        .update(user)
        .set({ banned: false, banReason: null, banExpires: null })
        .where(eq(user.id, userId))
        .returning()
      if (!updated) throw notFound('User not found.')
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
      await findUser(db, userId)
      await assertPublicLinkedAccounts(db, userId, input.links)
      const identityUpdate = profileUpdate(input)
      const publicUpdate = publicProfileUpdate(input)
      const statements: BatchItem<'sqlite'>[] = []
      if (Object.keys(identityUpdate).length > 0) {
        statements.push(db.update(user).set(identityUpdate).where(eq(user.id, userId)))
      }
      if (Object.keys(publicUpdate).length > 0) {
        const now = new Date()
        statements.push(
          db
            .insert(userProfile)
            .values({ userId, ...publicUpdate, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({ target: userProfile.userId, set: { ...publicUpdate, updatedAt: now } }),
        )
      }
      await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
      return findUser(db, userId)
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

    async deleteSessions(userId, sessionId) {
      const where = sessionId ? and(eq(session.userId, userId), eq(session.id, sessionId)) : eq(session.userId, userId)
      const deleted = await db.delete(session).where(where).returning()
      return deleted.map((item) => ({
        id: item.id,
        expiresAt: item.expiresAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ipAddress: item.ipAddress,
        userAgent: item.userAgent,
        activeOrganizationId: item.activeOrganizationId,
        impersonatedBy: item.impersonatedBy,
      }))
    },

    async createPasswordResetRequest(input) {
      await db.insert(passwordResetRequest).values(input)
      return input
    },

    async findPasswordResetRequest(userId, requestId) {
      const [row] = await db
        .select()
        .from(passwordResetRequest)
        .where(and(eq(passwordResetRequest.userId, userId), eq(passwordResetRequest.id, requestId)))
        .limit(1)
      return row ? { ...row, status: 'accepted' as const } : null
    },
  }
}

async function countRows(
  db: Database,
  table: typeof account | typeof session,
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

function managedUserWhere(query: Omit<AdminUserListQuery, 'page' | 'pageSize'>) {
  const conditions: SQL[] = []

  if (query.search) {
    const column = query.searchField === 'name' ? user.name : user.email
    conditions.push(like(column, `%${query.search}%`))
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
  }
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

function publicProfileUpdate(input: AccountProfileUpdateInput) {
  return {
    ...(input.bio !== undefined ? { bio: input.bio } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.links !== undefined ? { links: input.links } : {}),
  }
}

async function loadPublicProfile(db: Database, profile: UserProfile) {
  const [details] = await db.select().from(userProfile).where(eq(userProfile.userId, profile.id)).limit(1)
  const links = details?.links ?? []
  const linkedAccountIds = links.flatMap((link) => (link.type === 'linked-account' ? [link.accountId] : []))
  const linkedAccounts =
    linkedAccountIds.length > 0
      ? await db
          .select({ id: account.id, providerId: account.providerId })
          .from(account)
          .where(and(eq(account.userId, profile.id), inArray(account.id, linkedAccountIds)))
      : []
  const availableAccounts = new Map(linkedAccounts.map((linkedAccount) => [linkedAccount.id, linkedAccount.providerId]))
  return {
    user: profile,
    bio: details?.bio ?? null,
    location: details?.location ?? null,
    links: links.filter(
      (link) =>
        link.type === 'website' ||
        (availableAccounts.get(link.accountId) === link.providerId && link.providerId !== 'credential'),
    ),
    profileUpdatedAt: details?.updatedAt ?? null,
  }
}

async function assertPublicLinkedAccounts(db: Database, userId: string, links: AccountProfileUpdateInput['links']) {
  if (!links) return
  const projections = links.filter((link) => link.type === 'linked-account')
  if (projections.length === 0) return
  if (new Set(projections.map((link) => link.accountId)).size !== projections.length) {
    throw badRequest('A linked account can appear only once on a public profile.')
  }

  const accountIds = projections.map((link) => link.accountId)
  const rows = await db
    .select({ id: account.id, providerId: account.providerId })
    .from(account)
    .where(and(eq(account.userId, userId), inArray(account.id, accountIds)))
  const providers = new Map(rows.map((row) => [row.id, row.providerId]))
  const invalid = projections.some(
    (projection) =>
      projection.providerId === 'credential' || providers.get(projection.accountId) !== projection.providerId,
  )
  if (invalid) throw badRequest('A public linked account must belong to the current user and match its provider.')
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
