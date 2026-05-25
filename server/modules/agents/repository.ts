import { count, desc } from 'drizzle-orm'
import type { PaginatedResult, PaginationInput } from '../../../shared/api/pagination'
import type { Database } from '../../db/client'
import { agent, agentCapabilityGrant, agentHost, approvalRequest } from '../../db/schema'

export type AgentHostRecord = typeof agentHost.$inferSelect
export type AgentRecord = typeof agent.$inferSelect
export type AgentCapabilityGrantRecord = typeof agentCapabilityGrant.$inferSelect
export type ApprovalRequestRecord = typeof approvalRequest.$inferSelect

export interface AgentRepository {
  listHosts(page: PaginationInput): Promise<PaginatedResult<AgentHostRecord>>
  listAgents(page: PaginationInput): Promise<PaginatedResult<AgentRecord>>
  listCapabilityGrants(page: PaginationInput): Promise<PaginatedResult<AgentCapabilityGrantRecord>>
  listApprovalRequests(page: PaginationInput): Promise<PaginatedResult<ApprovalRequestRecord>>
}

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
  }
}

async function list<TTable extends { $inferSelect: unknown }>(
  db: Database,
  table: TTable,
  page: PaginationInput,
  orderBy: unknown,
): Promise<PaginatedResult<TTable['$inferSelect']>> {
  const rows = await db
    .select()
    .from(table as never)
    .orderBy(orderBy as never)
    .limit(page.limit)
    .offset(page.offset)
  const [{ total }] = (await db.select({ total: count() }).from(table as never)) as unknown as [{ total: number }]

  return {
    items: rows as TTable['$inferSelect'][],
    total,
    ...page,
  }
}
