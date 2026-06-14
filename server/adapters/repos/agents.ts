import { notFound } from '@server/domain/errors'
import type { AgentRepository } from '@server/usecases/ports'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { PaginatedResult, PaginationInput } from '../../../shared/api/pagination'
import type { Database } from '../../db/client'
import { agent, agentCapabilityGrant, agentHost, approvalRequest } from '../../db/schema'

export type AgentHostRecord = typeof agentHost.$inferSelect
export type AgentRecord = typeof agent.$inferSelect
export type AgentCapabilityGrantRecord = typeof agentCapabilityGrant.$inferSelect
export type ApprovalRequestRecord = typeof approvalRequest.$inferSelect

export function createDrizzleAgentRepository(db: Database): AgentRepository {
  return {
    async listHosts(page) {
      return list(db, agentHost, page, desc(agentHost.createdAt))
    },

    async listAgents(page) {
      return list(db, agent, page, desc(agent.createdAt))
    },

    async listCapabilityGrants(page) {
      return list(db, agentCapabilityGrant, page, desc(agentCapabilityGrant.createdAt))
    },

    async listApprovalRequests(page) {
      return list(db, approvalRequest, page, desc(approvalRequest.createdAt))
    },

    async listAgentsForUser(userId, page) {
      return list(db, agent, page, desc(agent.createdAt), and(eq(agent.userId, userId), eq(agent.status, 'active')))
    },

    async listHostsForAgents(hostIds) {
      if (hostIds.length === 0) return []
      return db.select().from(agentHost).where(inArray(agentHost.id, hostIds))
    },

    async listCapabilityGrantsForUser(userId) {
      const userAgents = await db
        .select({ id: agent.id })
        .from(agent)
        .where(and(eq(agent.userId, userId), eq(agent.status, 'active')))
      if (userAgents.length === 0) return []
      return db
        .select()
        .from(agentCapabilityGrant)
        .where(
          and(
            inArray(
              agentCapabilityGrant.agentId,
              userAgents.map((row) => row.id),
            ),
            eq(agentCapabilityGrant.status, 'active'),
          ),
        )
    },

    async revokeAgentForUser(agentId, userId) {
      const [current] = await db
        .select({ id: agent.id })
        .from(agent)
        .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))
        .limit(1)
      if (!current) throw notFound('Agent was not found.')
      await revokeAgentRecord(db, agentId)
      await revokeAgentCapabilityGrants(db, agentId)
      await revokeAgentApprovalRequests(db, agentId)
    },

    async revokeCapabilityGrantForUser(grantId, userId) {
      const [grant] = await db
        .select({ agentId: agentCapabilityGrant.agentId })
        .from(agentCapabilityGrant)
        .where(eq(agentCapabilityGrant.id, grantId))
        .limit(1)
      if (!grant) throw notFound('Agent capability grant was not found.')
      const [current] = await db
        .select({ id: agent.id })
        .from(agent)
        .where(and(eq(agent.id, grant.agentId), eq(agent.userId, userId)))
        .limit(1)
      if (!current) throw notFound('Agent capability grant was not found.')
      await revokeCapabilityGrantRecord(db, grantId)
    },

    async revokeAgent(agentId) {
      const [current] = await db.select({ id: agent.id }).from(agent).where(eq(agent.id, agentId)).limit(1)
      if (!current) throw notFound('Agent was not found.')
      await revokeAgentRecord(db, agentId)
      await revokeAgentCapabilityGrants(db, agentId)
      await revokeAgentApprovalRequests(db, agentId)
    },

    async revokeHost(hostId) {
      const [current] = await db.select({ id: agentHost.id }).from(agentHost).where(eq(agentHost.id, hostId)).limit(1)
      if (!current) throw notFound('Agent host was not found.')
      const now = new Date()
      await db.update(agentHost).set({ status: 'revoked', updatedAt: now }).where(eq(agentHost.id, hostId))
      const hostAgents = await db.select({ id: agent.id }).from(agent).where(eq(agent.hostId, hostId))
      await Promise.all(hostAgents.map((row) => revokeAgentRecord(db, row.id)))
      await Promise.all(hostAgents.map((row) => revokeAgentCapabilityGrants(db, row.id)))
      await Promise.all(hostAgents.map((row) => revokeAgentApprovalRequests(db, row.id)))
      await revokeHostApprovalRequests(db, hostId)
    },

    async revokeCapabilityGrant(grantId) {
      const [current] = await db
        .select({ id: agentCapabilityGrant.id })
        .from(agentCapabilityGrant)
        .where(eq(agentCapabilityGrant.id, grantId))
        .limit(1)
      if (!current) throw notFound('Agent capability grant was not found.')
      await revokeCapabilityGrantRecord(db, grantId)
    },
  }
}

async function list<TTable extends { $inferSelect: unknown }>(
  db: Database,
  table: TTable,
  page: PaginationInput,
  orderBy: unknown,
  where?: unknown,
): Promise<PaginatedResult<TTable['$inferSelect']>> {
  const query = db.select().from(table as never)
  const rows = await (where ? query.where(where as never) : query)
    .orderBy(orderBy as never)
    .limit(page.limit)
    .offset(page.offset)
  const countQuery = db.select({ total: count() }).from(table as never)
  const [{ total }] = (await (where ? countQuery.where(where as never) : countQuery)) as unknown as [{ total: number }]

  return {
    items: rows as TTable['$inferSelect'][],
    total,
    ...page,
  }
}

async function revokeAgentRecord(db: Database, agentId: string) {
  await db.update(agent).set({ status: 'revoked', updatedAt: new Date() }).where(eq(agent.id, agentId))
}

async function revokeAgentCapabilityGrants(db: Database, agentId: string) {
  await db
    .update(agentCapabilityGrant)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(agentCapabilityGrant.agentId, agentId))
}

async function revokeCapabilityGrantRecord(db: Database, grantId: string) {
  await db
    .update(agentCapabilityGrant)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(agentCapabilityGrant.id, grantId))
}

async function revokeAgentApprovalRequests(db: Database, agentId: string) {
  await db
    .update(approvalRequest)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(approvalRequest.agentId, agentId))
}

async function revokeHostApprovalRequests(db: Database, hostId: string) {
  await db
    .update(approvalRequest)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(approvalRequest.hostId, hostId))
}
