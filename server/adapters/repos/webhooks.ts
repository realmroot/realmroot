import type { WebhookRepository } from '@server/usecases/ports'
import { and, count, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import type {
  ListWebhookEndpointsQuery,
  ListWebhookRequestsQuery,
  WebhookRequestStatus,
} from '../../../shared/api/webhooks'
import type { Database } from '../../db/client'
import { webhookDeliveryAttempt, webhookDeliveryRequest, webhookEndpoint } from '../../db/schema'

export type WebhookEndpointRow = typeof webhookEndpoint.$inferSelect
export type WebhookEndpointInsert = typeof webhookEndpoint.$inferInsert
export type WebhookRequestRow = typeof webhookDeliveryRequest.$inferSelect & {
  endpointUrl: string
  organizationId: string | null
}
export type WebhookRequestInsert = typeof webhookDeliveryRequest.$inferInsert

export function createWebhookRepository(db: Database): WebhookRepository {
  return {
    async listEndpoints(query, organizationIds) {
      const where = endpointWhere(query, organizationIds)
      const items = await db
        .select()
        .from(webhookEndpoint)
        .where(where)
        .orderBy(desc(webhookEndpoint.createdAt), desc(webhookEndpoint.id))
        .limit(query.limit)
        .offset(query.offset)
      const [total] = await db.select({ value: count() }).from(webhookEndpoint).where(where)

      return { items, total: total?.value ?? 0 }
    },

    async findEndpoint(id) {
      const [row] = await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, id))
      return row ?? null
    },

    async listSubscribedEndpoints(event, organizationIds) {
      return db
        .select()
        .from(webhookEndpoint)
        .where(
          and(
            eq(webhookEndpoint.enabled, true),
            sql`exists (select 1 from json_each(${webhookEndpoint.events}) where value = ${event})`,
            organizationIds.length > 0
              ? or(isNull(webhookEndpoint.organizationId), inArray(webhookEndpoint.organizationId, organizationIds))
              : isNull(webhookEndpoint.organizationId),
          ),
        )
        .orderBy(webhookEndpoint.id)
    },

    async createEndpoint(input) {
      const [row] = await db.insert(webhookEndpoint).values(input).returning()
      return row
    },

    async updateEndpoint(id, input) {
      const [row] = await db.update(webhookEndpoint).set(input).where(eq(webhookEndpoint.id, id)).returning()
      return row ?? null
    },

    async deleteEndpoint(id) {
      await db.delete(webhookEndpoint).where(eq(webhookEndpoint.id, id))
    },

    async listRequests(query, organizationIds) {
      const where = requestWhere(query, organizationIds)
      const rows = await db
        .select({
          request: webhookDeliveryRequest,
          endpointUrl: webhookEndpoint.url,
          organizationId: webhookEndpoint.organizationId,
        })
        .from(webhookDeliveryRequest)
        .innerJoin(webhookEndpoint, eq(webhookDeliveryRequest.endpointId, webhookEndpoint.id))
        .where(where)
        .orderBy(desc(webhookDeliveryRequest.createdAt), desc(webhookDeliveryRequest.id))
        .limit(query.limit)
        .offset(query.offset)
      const [total] = await db
        .select({ value: count() })
        .from(webhookDeliveryRequest)
        .innerJoin(webhookEndpoint, eq(webhookDeliveryRequest.endpointId, webhookEndpoint.id))
        .where(where)

      return {
        items: rows.map((row) => ({
          ...row.request,
          endpointUrl: row.endpointUrl,
          organizationId: row.organizationId,
        })),
        total: total?.value ?? 0,
      }
    },

    async findRequest(id) {
      const [row] = await db
        .select({
          request: webhookDeliveryRequest,
          endpointUrl: webhookEndpoint.url,
          organizationId: webhookEndpoint.organizationId,
        })
        .from(webhookDeliveryRequest)
        .innerJoin(webhookEndpoint, eq(webhookDeliveryRequest.endpointId, webhookEndpoint.id))
        .where(eq(webhookDeliveryRequest.id, id))

      return row ? { ...row.request, endpointUrl: row.endpointUrl, organizationId: row.organizationId } : null
    },

    async createRequest(input) {
      const [row] = await db.insert(webhookDeliveryRequest).values(input).returning()
      const endpoint = await this.findEndpoint(row.endpointId)
      if (!endpoint) throw new Error('Webhook endpoint disappeared while recording a delivery.')
      return { ...row, endpointUrl: endpoint.url, organizationId: endpoint.organizationId }
    },

    async updateRequest(id, input) {
      const [row] = await db
        .update(webhookDeliveryRequest)
        .set(input)
        .where(eq(webhookDeliveryRequest.id, id))
        .returning()
      if (!row) return null
      const endpoint = await this.findEndpoint(row.endpointId)
      return endpoint ? { ...row, endpointUrl: endpoint.url, organizationId: endpoint.organizationId } : null
    },

    async listAttempts(requestId, page) {
      const where = eq(webhookDeliveryAttempt.requestId, requestId)
      const [items, totals] = await Promise.all([
        db
          .select()
          .from(webhookDeliveryAttempt)
          .where(where)
          .orderBy(desc(webhookDeliveryAttempt.createdAt), desc(webhookDeliveryAttempt.id))
          .limit(page.limit)
          .offset(page.offset),
        db.select({ value: count() }).from(webhookDeliveryAttempt).where(where),
      ])
      return { items, total: totals[0]?.value ?? 0, ...page }
    },

    async findAttempt(id) {
      const [row] = await db.select().from(webhookDeliveryAttempt).where(eq(webhookDeliveryAttempt.id, id))
      return row ?? null
    },

    async findAttemptByIdempotencyKey(requestId, idempotencyKey) {
      const [row] = await db
        .select()
        .from(webhookDeliveryAttempt)
        .where(
          and(
            eq(webhookDeliveryAttempt.requestId, requestId),
            eq(webhookDeliveryAttempt.idempotencyKey, idempotencyKey),
          ),
        )
      return row ?? null
    },

    async reserveAttempt(input) {
      const { previousAttemptCount, ...attempt } = input
      const [created] = await db
        .insert(webhookDeliveryAttempt)
        .values({
          ...attempt,
          sequence: sql<number>`(
            select max(coalesce(max(${webhookDeliveryAttempt.sequence}), 0), ${previousAttemptCount}) + 1
            from ${webhookDeliveryAttempt}
            where ${webhookDeliveryAttempt.requestId} = ${input.requestId}
          )`,
        })
        .onConflictDoNothing({
          target: [webhookDeliveryAttempt.requestId, webhookDeliveryAttempt.idempotencyKey],
        })
        .returning()
      if (created) return { attempt: created, created: true }
      const existing = await this.findAttemptByIdempotencyKey(attempt.requestId, attempt.idempotencyKey)
      if (!existing) throw new Error('Webhook delivery attempt reservation did not return its durable resource.')
      return { attempt: existing, created: false }
    },

    async updateAttempt(id, input) {
      const [row] = await db
        .update(webhookDeliveryAttempt)
        .set(input)
        .where(eq(webhookDeliveryAttempt.id, id))
        .returning()
      return row ?? null
    },
  }
}

function endpointWhere(query: ListWebhookEndpointsQuery, organizationIds?: string[]) {
  const filters = []
  if (organizationIds) filters.push(inArray(webhookEndpoint.organizationId, organizationIds))
  if (query.status) filters.push(eq(webhookEndpoint.enabled, query.status === 'enabled'))
  if (query.organizationId) filters.push(eq(webhookEndpoint.organizationId, query.organizationId))
  if (query.search) filters.push(like(webhookEndpoint.url, `%${query.search}%`))
  return filters.length > 0 ? and(...filters) : undefined
}

function requestWhere(query: ListWebhookRequestsQuery, organizationIds?: string[]) {
  const filters = []
  if (organizationIds) filters.push(inArray(webhookEndpoint.organizationId, organizationIds))
  if (query.endpointId) filters.push(eq(webhookDeliveryRequest.endpointId, query.endpointId))
  if (query.organizationId) filters.push(eq(webhookEndpoint.organizationId, query.organizationId))
  if (query.status) filters.push(eq(webhookDeliveryRequest.status, query.status as WebhookRequestStatus))
  if (query.search) {
    filters.push(
      or(like(webhookEndpoint.url, `%${query.search}%`), like(webhookDeliveryRequest.event, `%${query.search}%`)),
    )
  }
  return filters.length > 0 ? and(...filters) : undefined
}
