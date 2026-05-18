import { and, count, desc, eq } from 'drizzle-orm'
import type { PaginatedResult, PaginationInput } from '../../../shared/api/pagination'
import type { SecurityPolicy } from '../../../shared/api/security'
import type { Database } from '../../db/client'
import { passkey, session, twoFactor, user } from '../../db/schema'
import { notFound } from '../../lib/errors'

export interface SecurityPasskey {
  id: string
  name: string | null
  userId: string
  deviceType: string
  backedUp: boolean
  transports: string | null
  createdAt: Date | null
  aaguid: string | null
}

export interface MfaFactor {
  id: string
  type: 'totp'
  verified: boolean | null
}

export interface SecurityState {
  userId: string
  mfa: {
    enabled: boolean
    factors: MfaFactor[]
  }
  passkeys: {
    enabled: boolean
    count: number
  }
  policy: SecurityPolicy
}

export interface SecurityRepository {
  getSecurityState(userId: string): Promise<SecurityState>
  listPasskeys(userId: string, page: PaginationInput): Promise<PaginatedResult<SecurityPasskey>>
  deletePasskey(userId: string, passkeyId: string): Promise<void>
  getSessionToken(userId: string, sessionId: string): Promise<string>
}

export function createSecurityRepository(db: Database, policy: SecurityPolicy): SecurityRepository {
  return {
    async getSecurityState(userId) {
      const [row] = await db
        .select({
          id: user.id,
          twoFactorEnabled: user.twoFactorEnabled,
        })
        .from(user)
        .where(eq(user.id, userId))

      if (!row) {
        throw notFound('User not found.')
      }

      const factors = await db
        .select({
          id: twoFactor.id,
          verified: twoFactor.verified,
        })
        .from(twoFactor)
        .where(eq(twoFactor.userId, userId))

      return {
        userId,
        mfa: {
          enabled: row.twoFactorEnabled === true,
          factors: factors.map((factor) => ({
            id: factor.id,
            type: 'totp',
            verified: factor.verified,
          })),
        },
        passkeys: {
          enabled: policy.passkeys.enabled,
          count: await countTableRows(db, passkey, eq(passkey.userId, userId)),
        },
        policy,
      }
    },

    async listPasskeys(userId, page) {
      const rows = await db
        .select({
          id: passkey.id,
          name: passkey.name,
          userId: passkey.userId,
          deviceType: passkey.deviceType,
          backedUp: passkey.backedUp,
          transports: passkey.transports,
          createdAt: passkey.createdAt,
          aaguid: passkey.aaguid,
        })
        .from(passkey)
        .where(eq(passkey.userId, userId))
        .orderBy(desc(passkey.createdAt))
        .limit(page.limit)
        .offset(page.offset)

      return {
        items: rows,
        total: await countTableRows(db, passkey, eq(passkey.userId, userId)),
        ...page,
      }
    },

    async deletePasskey(userId, passkeyId) {
      const [deleted] = await db
        .delete(passkey)
        .where(and(eq(passkey.userId, userId), eq(passkey.id, passkeyId)))
        .returning({ id: passkey.id })

      if (!deleted) {
        throw notFound('Passkey not found.')
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

async function countTableRows(
  db: Database,
  table: typeof passkey,
  where: ReturnType<typeof eq> | ReturnType<typeof and>,
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(where)
  return row?.value ?? 0
}
