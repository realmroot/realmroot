/**
 * Ports: the interfaces the usecases depend on for everything beyond the
 * process boundary (persistence, external services). Adapters implement these;
 * usecases consume them. Port records are plain, framework-free shapes — they
 * never reference the drizzle schema, so this file stays inside the usecase
 * layer's dependency budget.
 */
import type { ListWebhookEndpointsQuery, ListWebhookRequestsQuery } from '@shared/api/webhooks'

// --- webhooks ---------------------------------------------------------------

export interface WebhookEndpointRecord {
  id: string
  url: string
  events: string[]
  enabled: boolean
  signingSecret: string
  secretPrefix: string
  createdByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface WebhookEndpointInsert {
  id: string
  url: string
  events: string[]
  enabled?: boolean
  signingSecret: string
  secretPrefix: string
  createdByUserId?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export interface WebhookRequestRecord {
  id: string
  endpointId: string
  event: string
  status: string
  attemptCount: number
  httpStatus: number | null
  error: string | null
  requestBody: string | null
  responseBody: string | null
  nextAttemptAt: Date | null
  createdAt: Date
  updatedAt: Date
  endpointUrl: string
}

export interface WebhookRequestInsert {
  id?: string
  endpointId?: string
  event?: string
  status?: string
  attemptCount?: number
  httpStatus?: number | null
  error?: string | null
  requestBody?: string | null
  responseBody?: string | null
  nextAttemptAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

export interface WebhookRepository {
  listEndpoints(query: ListWebhookEndpointsQuery): Promise<{ items: WebhookEndpointRecord[]; total: number }>
  findEndpoint(id: string): Promise<WebhookEndpointRecord | null>
  createEndpoint(input: WebhookEndpointInsert): Promise<WebhookEndpointRecord>
  updateEndpoint(id: string, input: Partial<WebhookEndpointInsert>): Promise<WebhookEndpointRecord | null>
  deleteEndpoint(id: string): Promise<void>
  listRequests(query: ListWebhookRequestsQuery): Promise<{ items: WebhookRequestRecord[]; total: number }>
  findRequest(id: string): Promise<WebhookRequestRecord | null>
  updateRequest(id: string, input: Partial<WebhookRequestInsert>): Promise<WebhookRequestRecord | null>
}
