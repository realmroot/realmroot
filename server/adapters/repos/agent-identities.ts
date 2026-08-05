import type {
  AgentEnrollmentIntentRecord,
  AgentIdentityAggregate,
  AgentIdentityRepository,
} from '@server/usecases/ports'
import { and, count, desc, eq, inArray, or } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Database } from '../../db/client'
import {
  agent,
  agentAuditEvent,
  agentCapabilityGrant,
  agentEnrollmentIntent,
  agentIdentity,
  agentIdentityBinding,
  approvalRequest,
} from '../../db/schema'

export function createDrizzleAgentIdentityRepository(db: Database): AgentIdentityRepository {
  return {
    async listPersonal(userId) {
      const identities = await db
        .select()
        .from(agentIdentity)
        .where(eq(agentIdentity.ownerUserId, userId))
        .orderBy(agentIdentity.createdAt, agentIdentity.id)
      return aggregates(db, identities)
    },

    async listOrganization(organizationId) {
      const identities = await db
        .select()
        .from(agentIdentity)
        .where(eq(agentIdentity.ownerOrganizationId, organizationId))
        .orderBy(agentIdentity.createdAt, agentIdentity.id)
      return aggregates(db, identities)
    },

    async listOwned(owner, page) {
      const ownerConditions = [
        owner.ownerUserId ? eq(agentIdentity.ownerUserId, owner.ownerUserId) : undefined,
        owner.ownerOrganizationIds?.length
          ? inArray(agentIdentity.ownerOrganizationId, owner.ownerOrganizationIds)
          : undefined,
      ].filter((condition) => condition !== undefined)
      if (ownerConditions.length === 0) return { items: [], total: 0, ...page }
      const ownerCondition = or(...ownerConditions)!
      const [identities, totals] = await Promise.all([
        db
          .select()
          .from(agentIdentity)
          .where(ownerCondition)
          .orderBy(desc(agentIdentity.createdAt), desc(agentIdentity.id))
          .limit(page.limit)
          .offset(page.offset),
        db.select({ value: count() }).from(agentIdentity).where(ownerCondition),
      ])
      return { items: await aggregates(db, identities), total: totals[0]?.value ?? 0, ...page }
    },

    async listAll(page) {
      const [identities, totals] = await Promise.all([
        db
          .select()
          .from(agentIdentity)
          .orderBy(desc(agentIdentity.createdAt), desc(agentIdentity.id))
          .limit(page.limit)
          .offset(page.offset),
        db.select({ value: count() }).from(agentIdentity),
      ])
      return {
        items: await aggregates(db, identities),
        total: totals[0]?.value ?? 0,
        limit: page.limit,
        offset: page.offset,
      }
    },

    async findIdentity(id) {
      const [identity] = await db.select().from(agentIdentity).where(eq(agentIdentity.id, id)).limit(1)
      if (!identity) return null
      return aggregate(db, identity)
    },

    async findByIssuerSubject(issuer, subject) {
      const [identity] = await db
        .select()
        .from(agentIdentity)
        .where(and(eq(agentIdentity.issuer, issuer), eq(agentIdentity.subject, subject)))
        .limit(1)
      return identity ?? null
    },

    async findIntent(id) {
      const [intent] = await db.select().from(agentEnrollmentIntent).where(eq(agentEnrollmentIntent.id, id)).limit(1)
      return intent ?? null
    },

    async findIntentByIdempotencyKey(protocolAgentId, idempotencyKey) {
      const [intent] = await db
        .select()
        .from(agentEnrollmentIntent)
        .where(
          and(
            eq(agentEnrollmentIntent.protocolAgentId, protocolAgentId),
            eq(agentEnrollmentIntent.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1)
      return intent ?? null
    },

    async findProtocolAgent(id) {
      const [record] = await db.select().from(agent).where(eq(agent.id, id)).limit(1)
      return record ?? null
    },

    async findBindingByProtocolAgent(id) {
      const [row] = await bindingRows(db, eq(agentIdentityBinding.protocolAgentId, id))
      return row ?? null
    },

    async findActiveByProtocolAgent(id) {
      const [row] = await db
        .select({ identity: agentIdentity })
        .from(agentIdentityBinding)
        .innerJoin(agentIdentity, eq(agentIdentity.id, agentIdentityBinding.agentIdentityId))
        .where(
          and(
            eq(agentIdentityBinding.protocolAgentId, id),
            eq(agentIdentityBinding.status, 'active'),
            eq(agentIdentity.status, 'active'),
          ),
        )
        .limit(1)
      return row ? aggregate(db, row.identity) : null
    },

    async createIdentity(input) {
      await db.batch([
        db.insert(agentIdentity).values(input.identity),
        db.insert(agentIdentityBinding).values(input.binding),
      ])
      const result = await this.findIdentity(input.identity.id)
      if (!result) throw new Error('Agent identity was not persisted.')
      return result
    },

    async createIntent(input) {
      const [created] = await db.insert(agentEnrollmentIntent).values(input).returning()
      return created
    },

    async createIntentIdempotently(input) {
      const [created] = await db.insert(agentEnrollmentIntent).values(input).onConflictDoNothing().returning()
      if (created) return { intent: created, created: true }
      const existing = await this.findIntentByIdempotencyKey(input.protocolAgentId, input.idempotencyKey)
      if (!existing) throw new Error('Agent installation enrollment reservation did not return its durable resource.')
      return { intent: existing, created: false }
    },

    async approveIntent(input) {
      const statements: BatchItem<'sqlite'>[] = []
      if (input.identity) statements.push(db.insert(agentIdentity).values(input.identity))
      else {
        statements.push(
          db
            .update(agentIdentity)
            .set({ status: 'active', updatedAt: input.approvedAt })
            .where(and(eq(agentIdentity.id, input.binding.agentIdentityId), eq(agentIdentity.status, 'recovering'))),
        )
      }
      statements.push(
        db.insert(agentIdentityBinding).values(input.binding),
        db
          .update(agentEnrollmentIntent)
          .set({
            status: 'approved',
            approvedByUserId: input.approvedByUserId,
            approvedAt: input.approvedAt,
            updatedAt: input.approvedAt,
          })
          .where(and(eq(agentEnrollmentIntent.id, input.intentId), eq(agentEnrollmentIntent.status, 'pending'))),
      )
      await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
      const result = await this.findIdentity(input.binding.agentIdentityId)
      if (!result) throw new Error('Approved Agent identity was not persisted.')
      return result
    },

    async revokeBinding(identityId, protocolAgentId, now) {
      const [binding] = await db
        .select({ id: agentIdentityBinding.id })
        .from(agentIdentityBinding)
        .where(
          and(
            eq(agentIdentityBinding.agentIdentityId, identityId),
            eq(agentIdentityBinding.protocolAgentId, protocolAgentId),
            eq(agentIdentityBinding.status, 'active'),
          ),
        )
        .limit(1)
      if (!binding) return false
      await revokeProtocolAgents(db, identityId, [protocolAgentId], now)
      return true
    },

    async recoverIdentity(identityId, now, audit) {
      const [identity] = await db
        .select({ id: agentIdentity.id })
        .from(agentIdentity)
        .where(and(eq(agentIdentity.id, identityId), eq(agentIdentity.status, 'active')))
        .limit(1)
      if (!identity) return false
      const protocolAgentIds = await activeProtocolAgentIds(db, identityId)
      const statements = revokeProtocolAgentStatements(db, identityId, protocolAgentIds, now)
      statements.unshift(
        db
          .update(agentIdentity)
          .set({ status: 'recovering', updatedAt: now })
          .where(and(eq(agentIdentity.id, identityId), eq(agentIdentity.status, 'active'))),
      )
      statements.push(db.insert(agentAuditEvent).values(audit))
      await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
      return true
    },

    async retireIdentity(identityId, now, audit) {
      const [identity] = await db
        .select({ id: agentIdentity.id })
        .from(agentIdentity)
        .where(and(eq(agentIdentity.id, identityId), inArray(agentIdentity.status, ['active', 'recovering'])))
        .limit(1)
      if (!identity) return false
      const protocolAgentIds = await activeProtocolAgentIds(db, identityId)
      const statements = revokeProtocolAgentStatements(db, identityId, protocolAgentIds, now)
      statements.unshift(
        db
          .update(agentIdentity)
          .set({ status: 'retired', retiredAt: now, updatedAt: now })
          .where(and(eq(agentIdentity.id, identityId), inArray(agentIdentity.status, ['active', 'recovering']))),
      )
      statements.push(db.insert(agentAuditEvent).values(audit))
      await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
      return true
    },
  }
}

async function aggregates(db: Database, identities: (typeof agentIdentity.$inferSelect)[]) {
  return Promise.all(identities.map((identity) => aggregate(db, identity)))
}

async function aggregate(db: Database, identity: typeof agentIdentity.$inferSelect): Promise<AgentIdentityAggregate> {
  return {
    identity,
    bindings: await bindingRows(db, eq(agentIdentityBinding.agentIdentityId, identity.id)),
  }
}

function bindingRows(db: Database, where: ReturnType<typeof eq>) {
  return db
    .select({
      id: agentIdentityBinding.id,
      agentIdentityId: agentIdentityBinding.agentIdentityId,
      protocolAgentId: agentIdentityBinding.protocolAgentId,
      hostId: agent.hostId,
      status: agentIdentityBinding.status,
      boundAt: agentIdentityBinding.boundAt,
      revokedAt: agentIdentityBinding.revokedAt,
      createdAt: agentIdentityBinding.createdAt,
      updatedAt: agentIdentityBinding.updatedAt,
    })
    .from(agentIdentityBinding)
    .innerJoin(agent, eq(agent.id, agentIdentityBinding.protocolAgentId))
    .where(where)
}

async function activeProtocolAgentIds(db: Database, identityId: string) {
  const rows = await db
    .select({ id: agentIdentityBinding.protocolAgentId })
    .from(agentIdentityBinding)
    .where(and(eq(agentIdentityBinding.agentIdentityId, identityId), eq(agentIdentityBinding.status, 'active')))
  return rows.map((row) => row.id)
}

async function revokeProtocolAgents(db: Database, identityId: string, protocolAgentIds: string[], now: Date) {
  await db.batch(
    revokeProtocolAgentStatements(db, identityId, protocolAgentIds, now) as [
      BatchItem<'sqlite'>,
      ...BatchItem<'sqlite'>[],
    ],
  )
}

function revokeProtocolAgentStatements(db: Database, identityId: string, protocolAgentIds: string[], now: Date) {
  const statements: BatchItem<'sqlite'>[] = [
    db
      .update(agentIdentityBinding)
      .set({ status: 'revoked', revokedAt: now, updatedAt: now })
      .where(and(eq(agentIdentityBinding.agentIdentityId, identityId), eq(agentIdentityBinding.status, 'active'))),
  ]
  if (protocolAgentIds.length === 0) return statements
  statements.push(
    db.update(agent).set({ status: 'revoked', updatedAt: now }).where(inArray(agent.id, protocolAgentIds)),
    db
      .update(agentCapabilityGrant)
      .set({ status: 'revoked', updatedAt: now })
      .where(inArray(agentCapabilityGrant.agentId, protocolAgentIds)),
    db
      .update(approvalRequest)
      .set({ status: 'revoked', updatedAt: now })
      .where(inArray(approvalRequest.agentId, protocolAgentIds)),
  )
  return statements
}

export type { AgentEnrollmentIntentRecord }
