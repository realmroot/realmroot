import { notFound } from '@server/domain/errors'
import type { SecurityRepository } from '@server/usecases/ports'
import { and, count, desc, eq } from 'drizzle-orm'
import { type SecurityPolicy, securityPolicySchema } from '../../../shared/api/security'
import type { Database } from '../../db/client'
import { passkey, session, twoFactor, user } from '../../db/schema'
import { readSiteSettings, writeSiteSettings } from './site-settings'
import { metadataSchema } from './site-settings-schemas'

export function createSecurityRepository(db: Database, policy: SecurityPolicy): SecurityRepository {
  return {
    async getPolicy() {
      return readManagedPolicy(db, policy)
    },

    async updatePolicy(input) {
      const stored = await readSiteSettings(db, 'security', metadataSchema)
      const current = managedPolicy(stored?.value ?? null, policy)
      const nextCaptchaSecret = input.policy.captcha?.secretKey?.trim()
        ? input.policy.captcha.secretKey
        : input.policy.captcha?.provider === current.captcha.provider
          ? current.captcha.secretKey
          : ''
      const captcha = input.policy.captcha
        ? {
            ...input.policy.captcha,
            secretKey: nextCaptchaSecret,
          }
        : current.captcha
      const next = securityPolicySchema.parse({
        ...current,
        ...input.policy,
        captcha,
        mfa: { ...current.mfa, ...input.policy.mfa },
        passkeys: { ...current.passkeys, ...input.policy.passkeys },
        sessions: input.policy.sessions ?? current.sessions,
      })
      await writeSiteSettings(
        db,
        'security',
        {
          ...stored?.value,
          mfa: next.mfa,
          passkeys: next.passkeys,
          sessions: next.sessions,
          password: next.password,
          captcha: next.captcha,
          blocklist: next.blocklist,
        },
        stored?.revision ?? null,
      )

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

async function readManagedPolicy(db: Database, defaults: SecurityPolicy): Promise<SecurityPolicy> {
  const row = await readSiteSettings(db, 'security', metadataSchema)
  return managedPolicy(row?.value ?? null, defaults)
}

function managedPolicy(managed: Record<string, unknown> | null, defaults: SecurityPolicy): SecurityPolicy {
  const managedCaptcha = readObject(managed, 'captcha')
  return securityPolicySchema.parse({
    ...defaults,
    mfa: { ...defaults.mfa, ...(readObject(managed, 'mfa') ?? {}) },
    passkeys: { ...defaults.passkeys, ...(readObject(managed, 'passkeys') ?? {}) },
    sessions: readObject(managed, 'sessions') ?? defaults.sessions,
    password: readObject(managed, 'password') ?? defaults.password,
    captcha: managedCaptcha ? normalizeManagedCaptcha(managedCaptcha, defaults.captcha) : defaults.captcha,
    blocklist: readObject(managed, 'blocklist') ?? defaults.blocklist,
  })
}

function normalizeManagedCaptcha(value: Record<string, unknown>, defaults: SecurityPolicy['captcha']) {
  return {
    ...defaults,
    ...value,
    projectId: typeof value.projectId === 'string' ? value.projectId : null,
    secretKey: typeof value.secretKey === 'string' ? value.secretKey : '',
    legacySecretBinding:
      typeof value.legacySecretBinding === 'string'
        ? value.legacySecretBinding
        : typeof value.secretBinding === 'string'
          ? value.secretBinding
          : undefined,
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
