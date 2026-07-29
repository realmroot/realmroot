import type { ExternalAccountRepository } from '@server/usecases/ports'
import { and, eq, gt, inArray, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Database } from '../../db/client'
import { externalAccount, externalAccountGrant, externalCredential, externalOAuthIntent } from '../../db/schema'

export function createExternalAccountRepository(db: Database): ExternalAccountRepository {
  return {
    async createAccountWithCredential(account, credential) {
      await db.batch([db.insert(externalAccount).values(account), db.insert(externalCredential).values(credential)] as [
        BatchItem<'sqlite'>,
        BatchItem<'sqlite'>,
      ])
      return { account, credential }
    },

    async listByOwnerUser(userId) {
      return joinedAccounts(eq(externalAccount.ownerUserId, userId))
    },

    async listByOwnerAgents(agentIdentityIds) {
      if (agentIdentityIds.length === 0) return []
      return joinedAccounts(inArray(externalAccount.ownerAgentIdentityId, agentIdentityIds))
    },

    async findAccount(id) {
      const [row] = await db.select().from(externalAccount).where(eq(externalAccount.id, id)).limit(1)
      return row ?? null
    },

    async findCredential(externalAccountId) {
      const [row] = await db
        .select()
        .from(externalCredential)
        .where(eq(externalCredential.externalAccountId, externalAccountId))
        .limit(1)
      return row ?? null
    },

    async updateCredential(id, input) {
      const [row] = await db.update(externalCredential).set(input).where(eq(externalCredential.id, id)).returning()
      return row ?? null
    },

    async createGrant(input) {
      const [row] = await db.insert(externalAccountGrant).values(input).returning()
      return row
    },

    async findGrant(id) {
      const [row] = await db.select().from(externalAccountGrant).where(eq(externalAccountGrant.id, id)).limit(1)
      return row ?? null
    },

    async findActiveGrant(externalAccountId, agentIdentityId) {
      const [row] = await db
        .select()
        .from(externalAccountGrant)
        .where(
          and(
            eq(externalAccountGrant.externalAccountId, externalAccountId),
            eq(externalAccountGrant.agentIdentityId, agentIdentityId),
            eq(externalAccountGrant.status, 'active'),
          ),
        )
        .limit(1)
      return row ?? null
    },

    async revokeGrant(id, now) {
      const [row] = await db
        .update(externalAccountGrant)
        .set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(and(eq(externalAccountGrant.id, id), eq(externalAccountGrant.status, 'active')))
        .returning({ id: externalAccountGrant.id })
      return Boolean(row)
    },

    async createOAuthIntent(input) {
      const [row] = await db.insert(externalOAuthIntent).values(input).returning()
      return row
    },

    async consumeOAuthIntent(stateHash, now) {
      const [row] = await db
        .update(externalOAuthIntent)
        .set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(externalOAuthIntent.stateHash, stateHash),
            eq(externalOAuthIntent.status, 'pending'),
            gt(externalOAuthIntent.expiresAt, now),
          ),
        )
        .returning()
      return row ?? null
    },
  }

  async function joinedAccounts(condition: SQL<unknown>) {
    const rows = await db
      .select({ account: externalAccount, credential: externalCredential })
      .from(externalAccount)
      .innerJoin(externalCredential, eq(externalCredential.externalAccountId, externalAccount.id))
      .where(condition)
      .orderBy(externalAccount.createdAt)
    return rows
  }
}
