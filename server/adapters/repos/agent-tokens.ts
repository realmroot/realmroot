import type { AgentTokenRepository } from '@server/usecases/ports'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  agentAccessToken,
  agentAuthorityApproval,
  agentAuthorityGrant,
  agentDpopJti,
  agentSigningKey,
} from '../../db/schema'

export function createDrizzleAgentTokenRepository(db: Database): AgentTokenRepository {
  return {
    async createGrant(input) {
      const [created] = await db.insert(agentAuthorityGrant).values(input).returning()
      return created
    },

    listGrants(agentIdentityId) {
      return db
        .select()
        .from(agentAuthorityGrant)
        .where(eq(agentAuthorityGrant.agentIdentityId, agentIdentityId))
        .orderBy(agentAuthorityGrant.createdAt)
    },

    async findGrant(id) {
      const [grant] = await db.select().from(agentAuthorityGrant).where(eq(agentAuthorityGrant.id, id)).limit(1)
      return grant ?? null
    },

    async revokeGrant(id, now) {
      const [revoked] = await db
        .update(agentAuthorityGrant)
        .set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(and(eq(agentAuthorityGrant.id, id), eq(agentAuthorityGrant.status, 'active')))
        .returning({ id: agentAuthorityGrant.id })
      return Boolean(revoked)
    },

    async consumeDpopJti(input) {
      try {
        await db.insert(agentDpopJti).values(input)
        return true
      } catch (error) {
        if (isUniqueConstraint(error)) return false
        throw error
      }
    },

    async storeAccessToken(input) {
      await db.insert(agentAccessToken).values(input)
    },

    async findAccessTokenByHash(tokenHash) {
      const [token] = await db.select().from(agentAccessToken).where(eq(agentAccessToken.tokenHash, tokenHash)).limit(1)
      return token ?? null
    },

    async findSigningKey() {
      const [key] = await db.select().from(agentSigningKey).orderBy(agentSigningKey.createdAt).limit(1)
      return key ?? null
    },

    async createSigningKey(input) {
      try {
        const [created] = await db.insert(agentSigningKey).values(input).returning()
        return created
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error
        const [existing] = await db.select().from(agentSigningKey).orderBy(agentSigningKey.createdAt).limit(1)
        if (!existing) throw error
        return existing
      }
    },

    async consumeGrantUse(id, maxUses) {
      const [row] = await db
        .update(agentAuthorityGrant)
        .set({
          useCount: sql`${agentAuthorityGrant.useCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentAuthorityGrant.id, id),
            eq(agentAuthorityGrant.status, 'active'),
            lt(agentAuthorityGrant.useCount, maxUses),
          ),
        )
        .returning({ id: agentAuthorityGrant.id })
      return Boolean(row)
    },

    async createApproval(input) {
      const [row] = await db.insert(agentAuthorityApproval).values(input).returning()
      return row
    },

    async findApproval(id) {
      const [row] = await db.select().from(agentAuthorityApproval).where(eq(agentAuthorityApproval.id, id)).limit(1)
      return row ?? null
    },

    async approveApproval(id, userId, now) {
      const [row] = await db
        .update(agentAuthorityApproval)
        .set({ status: 'approved', approvedByUserId: userId, approvedAt: now, updatedAt: now })
        .where(
          and(
            eq(agentAuthorityApproval.id, id),
            eq(agentAuthorityApproval.status, 'pending'),
            gt(agentAuthorityApproval.expiresAt, now),
          ),
        )
        .returning()
      return row ?? null
    },

    async consumeApproval(id, grantId, bindingId, now) {
      const [row] = await db
        .update(agentAuthorityApproval)
        .set({ status: 'consumed', consumedAt: now, updatedAt: now })
        .where(
          and(
            eq(agentAuthorityApproval.id, id),
            eq(agentAuthorityApproval.grantId, grantId),
            eq(agentAuthorityApproval.bindingId, bindingId),
            eq(agentAuthorityApproval.status, 'approved'),
            gt(agentAuthorityApproval.expiresAt, now),
          ),
        )
        .returning({ id: agentAuthorityApproval.id })
      return Boolean(row)
    },
  }
}

function isUniqueConstraint(error: unknown) {
  return error instanceof Error && /unique constraint|SQLITE_CONSTRAINT/i.test(error.message)
}
