import { and, count, desc, eq, isNull } from 'drizzle-orm'
import type { AccountProfileUpdateInput } from '../../../shared/api/account'
import type { PaginatedResult, PaginationInput } from '../../../shared/api/pagination'
import type { Database } from '../../db/client'
import { account, application, applicationConsent, session, uploadedAsset, user } from '../../db/schema'
import { badRequest, notFound } from '../../lib/errors'

export interface UserProfile {
  id: string
  email: string
  emailVerified: boolean
  displayName: string
  username: string | null
  avatarAssetId: string | null
  image: string | null
  role: string | null
  banned: boolean | null
  banReason: string | null
  banExpires: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface UserSessionDevice {
  id: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  ipAddress: string | null
  userAgent: string | null
  activeOrganizationId: string | null
  impersonatedBy: string | null
}

export interface LinkedAccount {
  id: string
  accountId: string
  providerId: string
  createdAt: Date
  updatedAt: Date
}

export interface ConsentedApplication {
  id: string
  applicationId: string
  applicationName: string
  applicationSlug: string
  scopes: string[]
  permissions: string[] | null
  grantedAt: Date
  expiresAt: Date | null
}

export interface UserRepository {
  getUser(userId: string): Promise<UserProfile>
  updateProfile(userId: string, input: AccountProfileUpdateInput): Promise<UserProfile>
  assertAccountAvatarReference(userId: string, avatarAssetId: string | null | undefined): Promise<void>
  assertAdminAvatarReference(avatarAssetId: string | null | undefined): Promise<void>
  listLinkedAccounts(userId: string, page: PaginationInput): Promise<PaginatedResult<LinkedAccount>>
  listConsentedApplications(userId: string, page: PaginationInput): Promise<PaginatedResult<ConsentedApplication>>
  listSessions(userId: string, page: PaginationInput): Promise<PaginatedResult<UserSessionDevice>>
  getSessionToken(userId: string, sessionId: string): Promise<string>
}

export function createUserRepository(db: Database): UserRepository {
  return {
    async getUser(userId) {
      return findUser(db, userId)
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
