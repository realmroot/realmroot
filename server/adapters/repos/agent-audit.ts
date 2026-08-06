import type { AgentAuditRepository } from '@server/usecases/ports'
import { and, count, desc, eq, inArray, or } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { agentAuditEvent } from '../../db/schema'

export function createAgentAuditRepository(db: Database): AgentAuditRepository {
  return {
    async append(input) {
      await db.insert(agentAuditEvent).values(input)
    },

    async list(page, filter) {
      if (filter?.ownerOrganizationIds?.length === 0 && !filter.ownerUserId) {
        return { items: [], total: 0, ...page }
      }
      const tenantCondition = or(
        filter?.ownerUserId ? eq(agentAuditEvent.ownerUserId, filter.ownerUserId) : undefined,
        filter?.ownerOrganizationIds
          ? inArray(agentAuditEvent.ownerOrganizationId, filter.ownerOrganizationIds)
          : undefined,
      )
      const condition = and(
        filter?.agentIdentityId ? eq(agentAuditEvent.agentIdentityId, filter.agentIdentityId) : undefined,
        tenantCondition,
      )
      const [items, totals] = await Promise.all([
        db
          .select()
          .from(agentAuditEvent)
          .where(condition)
          .orderBy(desc(agentAuditEvent.occurredAt))
          .limit(page.limit)
          .offset(page.offset),
        db.select({ value: count() }).from(agentAuditEvent).where(condition),
      ])
      return { items, total: totals[0]?.value ?? 0, limit: page.limit, offset: page.offset }
    },
  }
}
