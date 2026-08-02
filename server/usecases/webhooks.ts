import { badRequest, notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { WebhookEndpointRecord, WebhookRequestRecord } from '@server/usecases/ports'
import { paginationMetadata } from '@shared/api/pagination'
import type {
  CreateWebhookEndpointRequest,
  ListWebhookEndpointsQuery,
  ListWebhookRequestsQuery,
  UpdateWebhookEndpointRequest,
  WebhookEndpoint,
  WebhookEndpointSecretResponse,
  WebhookEvent,
  WebhookEventEnvelope,
  WebhookRequest,
} from '@shared/api/webhooks'

const webhookResponseLimit = 8 * 1024

export async function listWebhookEndpoints(deps: Deps, query: ListWebhookEndpointsQuery, organizationIds?: string[]) {
  const result = await deps.webhooks.listEndpoints(query, organizationIds)
  return {
    endpoints: result.items.map(toEndpointResponse),
    pagination: paginationMetadata({ ...query, total: result.total }),
  }
}

export async function getWebhookEndpoint(deps: Deps, id: string) {
  const endpoint = await deps.webhooks.findEndpoint(id)
  if (!endpoint) throw notFound('Webhook endpoint not found.')
  return toEndpointResponse(endpoint)
}

export async function createWebhookEndpoint(
  deps: Deps,
  input: CreateWebhookEndpointRequest,
  actorUserId: string | null,
): Promise<WebhookEndpointSecretResponse> {
  assertEvents(input.events)
  const signingSecret = createSigningSecret()
  const id = `wh_${crypto.randomUUID().replaceAll('-', '')}`
  const now = new Date()
  const endpoint = await deps.webhooks.createEndpoint({
    id,
    url: input.url,
    events: input.events,
    enabled: input.enabled,
    organizationId: input.organizationId,
    signingSecret: await deps.secrets.seal(signingSecret, webhookSecretContext(id)),
    secretPrefix: secretPrefix(signingSecret),
    createdByUserId: actorUserId,
    createdAt: now,
    updatedAt: now,
  })

  return { endpoint: toEndpointResponse(endpoint), signingSecret }
}

export async function updateWebhookEndpoint(deps: Deps, id: string, input: UpdateWebhookEndpointRequest) {
  const current = await deps.webhooks.findEndpoint(id)
  if (!current) throw notFound('Webhook endpoint not found.')
  if (input.events) assertEvents(input.events)
  const endpoint = await deps.webhooks.updateEndpoint(id, { ...input, updatedAt: new Date() })
  if (!endpoint) throw notFound('Webhook endpoint not found.')
  return toEndpointResponse(endpoint)
}

export async function deleteWebhookEndpoint(deps: Deps, id: string) {
  const current = await deps.webhooks.findEndpoint(id)
  if (!current) throw notFound('Webhook endpoint not found.')
  await deps.webhooks.deleteEndpoint(id)
}

export async function rotateWebhookSecret(deps: Deps, id: string): Promise<WebhookEndpointSecretResponse> {
  const current = await deps.webhooks.findEndpoint(id)
  if (!current) throw notFound('Webhook endpoint not found.')
  const signingSecret = createSigningSecret()
  const endpoint = await deps.webhooks.updateEndpoint(id, {
    signingSecret: await deps.secrets.seal(signingSecret, webhookSecretContext(id)),
    secretPrefix: secretPrefix(signingSecret),
    updatedAt: new Date(),
  })
  if (!endpoint) throw notFound('Webhook endpoint not found.')
  return { endpoint: toEndpointResponse(endpoint), signingSecret }
}

export async function listWebhookRequests(deps: Deps, query: ListWebhookRequestsQuery, organizationIds?: string[]) {
  const result = await deps.webhooks.listRequests(query, organizationIds)
  return {
    requests: result.items.map(toRequestResponse),
    pagination: paginationMetadata({ ...query, total: result.total }),
  }
}

export async function getWebhookRequest(deps: Deps, id: string) {
  const request = await deps.webhooks.findRequest(id)
  if (!request) throw notFound('Webhook request not found.')
  return toRequestResponse(request)
}

export async function retryWebhookRequest(deps: Deps, id: string) {
  const current = await deps.webhooks.findRequest(id)
  if (!current) throw notFound('Webhook request not found.')
  if (current.status === 'delivered') throw badRequest('Delivered webhook requests cannot be retried.')
  return deliverWebhookRequest(deps, id)
}

export async function publishWebhookEvent(
  deps: Deps,
  event: WebhookEvent,
  data: Record<string, unknown>,
  organizationIds?: string[],
): Promise<WebhookRequest[]> {
  const eventOrganizationIds = organizationIds ?? (await resolveEventOrganizationIds(deps, event, data))
  const endpoints = await deps.webhooks.listSubscribedEndpoints(event, eventOrganizationIds)
  if (endpoints.length === 0) return []

  const now = new Date()
  const envelope: WebhookEventEnvelope = {
    id: `evt_${crypto.randomUUID().replaceAll('-', '')}`,
    type: event,
    createdAt: now.toISOString(),
    data,
  }
  const requestBody = JSON.stringify(envelope)
  const requests = await Promise.all(
    endpoints.map((endpoint) =>
      deps.webhooks.createRequest({
        id: `whr_${crypto.randomUUID().replaceAll('-', '')}`,
        endpointId: endpoint.id,
        event,
        status: 'pending',
        attemptCount: 0,
        httpStatus: null,
        error: null,
        requestBody,
        responseBody: null,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ),
  )

  return Promise.all(requests.map((request) => deliverWebhookRequest(deps, request.id)))
}

export async function deliverWebhookRequest(deps: Deps, id: string): Promise<WebhookRequest> {
  const current = await deps.webhooks.findRequest(id)
  if (!current) throw notFound('Webhook request not found.')
  const endpoint = await deps.webhooks.findEndpoint(current.endpointId)
  if (!endpoint) throw notFound('Webhook endpoint not found.')
  if (!current.requestBody) throw badRequest('Webhook request has no event payload.')

  const attemptCount = current.attemptCount + 1
  const attemptedAt = new Date()
  await updateDelivery(deps, id, {
    status: 'pending',
    attemptCount,
    httpStatus: null,
    error: null,
    responseBody: null,
    nextAttemptAt: null,
    updatedAt: attemptedAt,
  })

  try {
    const timestamp = Math.floor(attemptedAt.getTime() / 1000).toString()
    const signingSecret = await readSigningSecret(deps, endpoint)
    const response = await deps.externalHttp.fetch(
      new Request(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Realmroot-Webhooks/1.0',
          'x-realmroot-event-id': readEventId(current.requestBody),
          'x-realmroot-event': current.event,
          'x-realmroot-timestamp': timestamp,
          'x-realmroot-signature': await signWebhookPayload(signingSecret, timestamp, current.requestBody),
        },
        body: current.requestBody,
      }),
    )
    const responseBody = await readBoundedResponse(response)
    const delivered = response.status >= 200 && response.status < 300
    const updated = await updateDelivery(deps, id, {
      status: delivered ? 'delivered' : 'failed',
      httpStatus: response.status,
      error: delivered ? null : `Endpoint returned HTTP ${response.status}.`,
      responseBody,
      updatedAt: new Date(),
    })
    return toRequestResponse(updated)
  } catch (error) {
    const updated = await updateDelivery(deps, id, {
      status: 'failed',
      httpStatus: null,
      error: error instanceof Error ? error.message.slice(0, 1_000) : 'Webhook delivery failed.',
      responseBody: null,
      updatedAt: new Date(),
    })
    return toRequestResponse(updated)
  }
}

function assertEvents(events: WebhookEvent[]) {
  if (new Set(events).size !== events.length) throw badRequest('Webhook events must be unique.')
}

function toEndpointResponse(row: WebhookEndpointRecord): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    events: row.events as WebhookEvent[],
    enabled: row.enabled,
    organizationId: row.organizationId,
    secretPrefix: row.secretPrefix,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toRequestResponse(row: WebhookRequestRecord): WebhookRequest {
  return {
    id: row.id,
    endpointId: row.endpointId,
    endpointUrl: row.endpointUrl,
    organizationId: row.organizationId,
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

async function resolveEventOrganizationIds(deps: Deps, event: WebhookEvent, data: Record<string, unknown>) {
  const application = readRecord(data, 'application')
  const applicationOrganizationId = readString(application, 'ownerOrganizationId')
  if (event.startsWith('application.') && applicationOrganizationId) return [applicationOrganizationId]

  const user = readRecord(data, 'user')
  const session = readRecord(data, 'session')
  const userId = readString(user, 'id') ?? readString(session, 'userId')
  if (!userId) return []
  const memberships = await deps.authorization.listUserMemberships(userId)
  return [...new Set(memberships.map((membership) => membership.organizationId))].sort()
}

function readRecord(value: Record<string, unknown>, key: string) {
  const nested = value[key]
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : {}
}

function readString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'string' && value[key] ? value[key] : null
}

function createSigningSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `whsec_${base64Url(bytes)}`
}

async function readSigningSecret(deps: Deps, endpoint: WebhookEndpointRecord) {
  const context = webhookSecretContext(endpoint.id)
  if (deps.secrets.isSealed(endpoint.signingSecret)) {
    return deps.secrets.open(endpoint.signingSecret, context)
  }

  const sealed = await deps.secrets.seal(endpoint.signingSecret, context)
  const migrated = await deps.webhooks.updateEndpoint(endpoint.id, { signingSecret: sealed, updatedAt: new Date() })
  if (!migrated) throw notFound('Webhook endpoint not found.')
  return endpoint.signingSecret
}

function webhookSecretContext(endpointId: string) {
  return `webhook:${endpointId}:signing-secret`
}

function readEventId(body: string) {
  const event = JSON.parse(body) as { id?: unknown }
  if (typeof event.id !== 'string' || !event.id.startsWith('evt_')) {
    throw badRequest('Webhook request contains an invalid event payload.')
  }
  return event.id
}

async function signWebhookPayload(secret: string, timestamp: string, body: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`))
  return `v1=${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

async function readBoundedResponse(response: Response) {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  let truncated = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const remaining = webhookResponseLimit - byteLength
    if (remaining <= 0) {
      truncated = true
      await reader.cancel()
      break
    }
    const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value
    chunks.push(chunk)
    byteLength += chunk.byteLength
    if (value.byteLength > remaining) {
      truncated = true
      await reader.cancel()
      break
    }
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const body = new TextDecoder().decode(bytes)
  if (!body && !truncated) return null
  return truncated ? `${body}\n[response truncated]` : body
}

async function updateDelivery(deps: Deps, id: string, input: Partial<import('./ports').WebhookRequestInsert>) {
  const updated = await deps.webhooks.updateRequest(id, input)
  if (!updated) throw notFound('Webhook request not found.')
  return updated
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
