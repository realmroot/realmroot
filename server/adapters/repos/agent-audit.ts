import type { AgentAuditRepository } from '@server/usecases/ports'
import { count, desc } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { agentAuditEvent } from '../../db/schema'

export function createAgentAuditRepository(db: Database): AgentAuditRepository {
  return {
    async append(input) {
      await db.insert(agentAuditEvent).values(input)
    },

    async list(page) {
      const [items, totals] = await Promise.all([
        db
          .select()
          .from(agentAuditEvent)
          .orderBy(desc(agentAuditEvent.occurredAt))
          .limit(page.limit)
          .offset(page.offset),
        db.select({ value: count() }).from(agentAuditEvent),
      ])
      return { items, total: totals[0]?.value ?? 0, limit: page.limit, offset: page.offset }
    },
  }
}
