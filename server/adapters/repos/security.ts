import { notFound } from '@server/domain/errors'
import type { SecurityRepository } from '@server/usecases/ports'
import { and, count, desc, eq } from 'drizzle-orm'
import { type SecurityPolicy, securityPolicySchema } from '../../../shared/api/security'
import type { Database } from '../../db/client'
import { passkey, session, signInExperience, twoFactor, user } from '../../db/schema'

export function createSecurityRepository(db: Database, policy: SecurityPolicy): SecurityRepository {
  return {
    async getPolicy() {
      return readManagedPolicy(db, policy)
    },

    async updatePolicy(input) {
      const current = await readManagedPolicy(db, policy)
      const next = securityPolicySchema.parse({
        ...current,
        ...input.policy,
        mfa: { ...current.mfa, ...input.policy.mfa },
        passkeys: { ...current.passkeys, ...input.policy.passkeys },
        sessions: current.sessions,
      })
      const row = await readSettingsRow(db)
      const metadata = {
        ...(row?.metadata ?? {}),
        securityPolicy: {
          mfa: next.mfa,
          passkeys: { enabled: next.passkeys.enabled },
          password: next.password,
          captcha: next.captcha,
          blocklist: next.blocklist,
        },
      }

      await db
        .insert(signInExperience)
        .values({ ...settingsInsertDefaults(row), id: settingsId, metadata, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: signInExperience.id,
          set: { metadata, updatedAt: new Date() },
        })

      return next
    },

    async getSecurityState(userId) {
      const currentPolicy = await readManagedPolicy(db, policy)
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
          enabled: currentPolicy.passkeys.enabled,
          count: await countTableRows(db, passkey, eq(passkey.userId, userId)),
        },
        policy: currentPolicy,
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

const settingsId = 'default'

async function readManagedPolicy(db: Database, defaults: SecurityPolicy): Promise<SecurityPolicy> {
  const row = await readSettingsRow(db)
  const managed = readObject(row?.metadata, 'securityPolicy')
  return securityPolicySchema.parse({
    ...defaults,
    mfa: { ...defaults.mfa, ...(readObject(managed, 'mfa') ?? {}) },
    passkeys: { ...defaults.passkeys, ...(readObject(managed, 'passkeys') ?? {}) },
    password: readObject(managed, 'password') ?? defaults.password,
    captcha: readObject(managed, 'captcha') ?? defaults.captcha,
    blocklist: readObject(managed, 'blocklist') ?? defaults.blocklist,
  })
}

async function readSettingsRow(db: Database): Promise<typeof signInExperience.$inferSelect | null> {
  const rows = await db.select().from(signInExperience).where(eq(signInExperience.id, settingsId)).limit(1)
  if (rows[0]) return rows[0]

  const legacyRows = await db.select().from(signInExperience).limit(1)
  return legacyRows[0] ?? null
}

function settingsInsertDefaults(settings: typeof signInExperience.$inferSelect | null) {
  return {
    passwordEnabled: settings?.passwordEnabled ?? true,
    signupEnabled: settings?.signupEnabled ?? true,
    socialLoginEnabled: settings?.socialLoginEnabled ?? true,
    identifierFirst: settings?.identifierFirst ?? false,
    termsUri: settings?.termsUri ?? null,
    privacyUri: settings?.privacyUri ?? null,
    supportEmail: settings?.supportEmail ?? null,
    metadata: settings?.metadata ?? null,
  }
}

function readObject(value: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const nested = value?.[key]
  return typeof nested === 'object' && nested !== null && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : null
}

async function countTableRows(
  db: Database,
  table: typeof passkey,
  where: ReturnType<typeof eq> | ReturnType<typeof and>,
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(where)
  return row?.value ?? 0
}
