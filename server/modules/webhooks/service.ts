import { paginationMetadata } from '../../../shared/api/pagination'
import type {
  CreateWebhookEndpointRequest,
  ListWebhookEndpointsQuery,
  ListWebhookRequestsQuery,
  UpdateWebhookEndpointRequest,
  WebhookEndpoint,
  WebhookEndpointSecretResponse,
  WebhookEvent,
  WebhookRequest,
} from '../../../shared/api/webhooks'
import { badRequest, notFound } from '../../lib/errors'
import type { WebhookEndpointRow, WebhookRepository, WebhookRequestRow } from './repository'

export class WebhookService {
  constructor(private readonly repository: WebhookRepository) {}

  async listEndpoints(query: ListWebhookEndpointsQuery) {
    const result = await this.repository.listEndpoints(query)
    return {
      endpoints: result.items.map(toEndpointResponse),
      pagination: paginationMetadata({ ...query, total: result.total }),
    }
  }

  async getEndpoint(id: string) {
    const endpoint = await this.repository.findEndpoint(id)
    if (!endpoint) throw notFound('Webhook endpoint not found.')
    return toEndpointResponse(endpoint)
  }

  async createEndpoint(
    input: CreateWebhookEndpointRequest,
    actorUserId: string,
  ): Promise<WebhookEndpointSecretResponse> {
    assertEvents(input.events)
    const signingSecret = createSigningSecret()
    const now = new Date()
    const endpoint = await this.repository.createEndpoint({
      id: `wh_${crypto.randomUUID().replaceAll('-', '')}`,
      url: input.url,
      events: input.events,
      enabled: input.enabled,
      signingSecret,
      secretPrefix: secretPrefix(signingSecret),
      createdByUserId: actorUserId,
      createdAt: now,
      updatedAt: now,
    })

    return { endpoint: toEndpointResponse(endpoint), signingSecret }
  }

  async updateEndpoint(id: string, input: UpdateWebhookEndpointRequest) {
    const current = await this.repository.findEndpoint(id)
    if (!current) throw notFound('Webhook endpoint not found.')
    if (input.events) assertEvents(input.events)
    const endpoint = await this.repository.updateEndpoint(id, { ...input, updatedAt: new Date() })
    if (!endpoint) throw notFound('Webhook endpoint not found.')
    return toEndpointResponse(endpoint)
  }

  async deleteEndpoint(id: string) {
    const current = await this.repository.findEndpoint(id)
    if (!current) throw notFound('Webhook endpoint not found.')
    await this.repository.deleteEndpoint(id)
  }

  async rotateSecret(id: string): Promise<WebhookEndpointSecretResponse> {
    const current = await this.repository.findEndpoint(id)
    if (!current) throw notFound('Webhook endpoint not found.')
    const signingSecret = createSigningSecret()
    const endpoint = await this.repository.updateEndpoint(id, {
      signingSecret,
      secretPrefix: secretPrefix(signingSecret),
      updatedAt: new Date(),
    })
    if (!endpoint) throw notFound('Webhook endpoint not found.')
    return { endpoint: toEndpointResponse(endpoint), signingSecret }
  }

  async listRequests(query: ListWebhookRequestsQuery) {
    const result = await this.repository.listRequests(query)
    return {
      requests: result.items.map(toRequestResponse),
      pagination: paginationMetadata({ ...query, total: result.total }),
    }
  }

  async getRequest(id: string) {
    const request = await this.repository.findRequest(id)
    if (!request) throw notFound('Webhook request not found.')
    return toRequestResponse(request)
  }

  async retryRequest(id: string) {
    const current = await this.repository.findRequest(id)
    if (!current) throw notFound('Webhook request not found.')
    if (current.status === 'delivered') throw badRequest('Delivered webhook requests cannot be retried.')
    const request = await this.repository.updateRequest(id, {
      status: 'pending',
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    if (!request) throw notFound('Webhook request not found.')
    return toRequestResponse(request)
  }
}

function assertEvents(events: WebhookEvent[]) {
  if (new Set(events).size !== events.length) throw badRequest('Webhook events must be unique.')
}

function toEndpointResponse(row: WebhookEndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    events: row.events as WebhookEvent[],
    enabled: row.enabled,
    secretPrefix: row.secretPrefix,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toRequestResponse(row: WebhookRequestRow): WebhookRequest {
  return {
    id: row.id,
    endpointId: row.endpointId,
    endpointUrl: row.endpointUrl,
    event: row.event as WebhookEvent,
    status: row.status as WebhookRequest['status'],
    attemptCount: row.attemptCount,
    httpStatus: row.httpStatus,
    error: row.error,
    requestBody: row.requestBody,
    responseBody: row.responseBody,
    nextAttemptAt: row.nextAttemptAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function createSigningSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `whsec_${base64Url(bytes)}`
}

function secretPrefix(secret: string) {
  return secret.slice(0, 14)
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}
