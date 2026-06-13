import { and, count, desc, eq, like, or } from 'drizzle-orm'
import type {
  ListWebhookEndpointsQuery,
  ListWebhookRequestsQuery,
  WebhookRequestStatus,
} from '../../../shared/api/webhooks'
import type { Database } from '../../db/client'
import { webhookDeliveryRequest, webhookEndpoint } from '../../db/schema'

export type WebhookEndpointRow = typeof webhookEndpoint.$inferSelect
export type WebhookEndpointInsert = typeof webhookEndpoint.$inferInsert
export type WebhookRequestRow = typeof webhookDeliveryRequest.$inferSelect & { endpointUrl: string }
export type WebhookRequestInsert = typeof webhookDeliveryRequest.$inferInsert

export interface WebhookRepository {
  listEndpoints(query: ListWebhookEndpointsQuery): Promise<{ items: WebhookEndpointRow[]; total: number }>
  findEndpoint(id: string): Promise<WebhookEndpointRow | null>
  createEndpoint(input: WebhookEndpointInsert): Promise<WebhookEndpointRow>
  updateEndpoint(id: string, input: Partial<WebhookEndpointInsert>): Promise<WebhookEndpointRow | null>
  deleteEndpoint(id: string): Promise<void>
  listRequests(query: ListWebhookRequestsQuery): Promise<{ items: WebhookRequestRow[]; total: number }>
  findRequest(id: string): Promise<WebhookRequestRow | null>
  updateRequest(id: string, input: Partial<WebhookRequestInsert>): Promise<WebhookRequestRow | null>
}

export function createWebhookRepository(db: Database): WebhookRepository {
  return {
    async listEndpoints(query) {
      const where = endpointWhere(query)
      const items = await db
        .select()
        .from(webhookEndpoint)
        .where(where)
        .orderBy(desc(webhookEndpoint.createdAt))
        .limit(query.limit)
        .offset(query.offset)
      const [total] = await db.select({ value: count() }).from(webhookEndpoint).where(where)

      return { items, total: total?.value ?? 0 }
    },

    async findEndpoint(id) {
      const [row] = await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, id))
      return row ?? null
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

    async listRequests(query) {
      const where = requestWhere(query)
      const rows = await db
        .select({
          request: webhookDeliveryRequest,
          endpointUrl: webhookEndpoint.url,
        })
        .from(webhookDeliveryRequest)
        .innerJoin(webhookEndpoint, eq(webhookDeliveryRequest.endpointId, webhookEndpoint.id))
        .where(where)
        .orderBy(desc(webhookDeliveryRequest.createdAt))
        .limit(query.limit)
        .offset(query.offset)
      const [total] = await db
        .select({ value: count() })
        .from(webhookDeliveryRequest)
        .innerJoin(webhookEndpoint, eq(webhookDeliveryRequest.endpointId, webhookEndpoint.id))
        .where(where)

      return {
        items: rows.map((row) => ({ ...row.request, endpointUrl: row.endpointUrl })),
        total: total?.value ?? 0,
      }
    },

    async findRequest(id) {
      const [row] = await db
        .select({
          request: webhookDeliveryRequest,
          endpointUrl: webhookEndpoint.url,
        })
        .from(webhookDeliveryRequest)
        .innerJoin(webhookEndpoint, eq(webhookDeliveryRequest.endpointId, webhookEndpoint.id))
        .where(eq(webhookDeliveryRequest.id, id))

      return row ? { ...row.request, endpointUrl: row.endpointUrl } : null
    },

    async updateRequest(id, input) {
      const [row] = await db
        .update(webhookDeliveryRequest)
        .set(input)
        .where(eq(webhookDeliveryRequest.id, id))
        .returning()
      if (!row) return null
      const endpoint = await this.findEndpoint(row.endpointId)
      return endpoint ? { ...row, endpointUrl: endpoint.url } : null
    },
  }
}

function endpointWhere(query: ListWebhookEndpointsQuery) {
  const filters = []
  if (query.status) filters.push(eq(webhookEndpoint.enabled, query.status === 'enabled'))
  if (query.search) filters.push(like(webhookEndpoint.url, `%${query.search}%`))
  return filters.length > 0 ? and(...filters) : undefined
}

function requestWhere(query: ListWebhookRequestsQuery) {
  const filters = []
  if (query.endpointId) filters.push(eq(webhookDeliveryRequest.endpointId, query.endpointId))
  if (query.status) filters.push(eq(webhookDeliveryRequest.status, query.status as WebhookRequestStatus))
  if (query.search) {
    filters.push(
      or(like(webhookEndpoint.url, `%${query.search}%`), like(webhookDeliveryRequest.event, `%${query.search}%`)),
    )
  }
  return filters.length > 0 ? and(...filters) : undefined
}
