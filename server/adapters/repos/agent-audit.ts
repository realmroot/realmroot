import type { AgentAuditRepository } from '@server/usecases/ports'
import { and, count, desc, eq, gte, inArray, or, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { agentAuditEvent, apiResource } from '../../db/schema'

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
        filter?.actions ? inArray(agentAuditEvent.action, filter.actions) : undefined,
        filter?.action ? eq(agentAuditEvent.action, filter.action) : undefined,
        filter?.result ? eq(agentAuditEvent.result, filter.result) : undefined,
        filter?.search ? auditSearchCondition(filter.search) : undefined,
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

    async summarizeByDay(since, filter) {
      const condition = and(activityCondition(filter), gte(agentAuditEvent.occurredAt, since))
      const date = sql<string>`date(${agentAuditEvent.occurredAt} / 1000, 'unixepoch')`
      return db.select({ date, count: count() }).from(agentAuditEvent).where(condition).groupBy(date).orderBy(date)
    },
  }
}

function auditSearchCondition(search: string) {
  const pattern = `%${search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  return or(
    sql`${agentAuditEvent.action} like ${pattern} escape '\\'`,
    sql`${agentAuditEvent.resourceId} like ${pattern} escape '\\'`,
    sql`${agentAuditEvent.accessRequestId} like ${pattern} escape '\\'`,
    sql`${agentAuditEvent.hostId} like ${pattern} escape '\\'`,
    sql`${agentAuditEvent.controllerUserId} like ${pattern} escape '\\'`,
    sql`${agentAuditEvent.reasonCode} like ${pattern} escape '\\'`,
    sql`cast(${agentAuditEvent.scopes} as text) like ${pattern} escape '\\'`,
    sql`exists (
      select 1 from ${apiResource}
      where ${apiResource.id} = ${agentAuditEvent.resourceId}
        and (${apiResource.name} like ${pattern} escape '\\' or ${apiResource.identifier} like ${pattern} escape '\\')
    )`,
  )
}

function activityCondition(filter?: {
  agentIdentityId?: string
  ownerUserId?: string
  ownerOrganizationIds?: string[]
}) {
  const tenantCondition = or(
    filter?.ownerUserId ? eq(agentAuditEvent.ownerUserId, filter.ownerUserId) : undefined,
    filter?.ownerOrganizationIds?.length
      ? inArray(agentAuditEvent.ownerOrganizationId, filter.ownerOrganizationIds)
      : undefined,
  )
  return and(
    filter?.agentIdentityId ? eq(agentAuditEvent.agentIdentityId, filter.agentIdentityId) : undefined,
    tenantCondition,
  )
}
