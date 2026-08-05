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
      if (!filter?.ownerUserId && filter?.ownerOrganizationIds?.length === 0) {
        return { items: [], total: 0, ...page }
      }
      const condition = and(
        filter?.agentIdentityId ? eq(agentAuditEvent.agentIdentityId, filter.agentIdentityId) : undefined,
        filter?.ownerUserId || filter?.ownerOrganizationIds
          ? or(
              filter.ownerUserId
                ? and(eq(agentAuditEvent.ownerKind, 'account'), eq(agentAuditEvent.ownerId, filter.ownerUserId))
                : undefined,
              filter.ownerOrganizationIds?.length
                ? and(
                    eq(agentAuditEvent.ownerKind, 'organization'),
                    inArray(agentAuditEvent.ownerId, filter.ownerOrganizationIds),
                  )
                : undefined,
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
