import type { AgentAuditRepository } from '@server/usecases/ports'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { agentAuditEvent, agentIdentity } from '../../db/schema'

export function createAgentAuditRepository(db: Database): AgentAuditRepository {
  return {
    async append(input) {
      await db.insert(agentAuditEvent).values(input)
    },

    async list(page, filter) {
      if (filter?.ownerOrganizationIds?.length === 0) return { items: [], total: 0, ...page }
      const condition = and(
        filter?.agentIdentityId ? eq(agentAuditEvent.agentIdentityId, filter.agentIdentityId) : undefined,
        filter?.ownerOrganizationIds
          ? inArray(
              agentAuditEvent.agentIdentityId,
              db
                .select({ id: agentIdentity.id })
                .from(agentIdentity)
                .where(inArray(agentIdentity.ownerOrganizationId, filter.ownerOrganizationIds)),
            )
          : undefined,
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
