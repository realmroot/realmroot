import { createSecretCipher } from '@server/adapters/gateways/secrets'
import type { WebhookEndpointInsert, WebhookEndpointRow, WebhookRequestRow } from '@server/adapters/repos/webhooks'
import { userManagementActor } from '@server/domain/management-authorization'
import type { Deps } from '@server/usecases/deps'
import type {
  WebhookDeliveryAttemptInsert,
  WebhookDeliveryAttemptRecord,
  WebhookRepository,
  WebhookRequestInsert,
} from '@server/usecases/ports'
import {
  createWebhookDeliveryAttempt,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  deliverWebhookRequest,
  getWebhookDeliveryAttempt,
  getWebhookEndpoint,
  getWebhookRequest,
  listWebhookDeliveryAttempts,
  listWebhookEndpoints,
  listWebhookRequests,
  publishWebhookEvent,
  rotateWebhookSecret,
  updateWebhookEndpoint,
} from '@server/usecases/webhooks'
import type { ListWebhookEndpointsQuery, ListWebhookRequestsQuery, WebhookEvent } from '@shared/api/webhooks'
import { describe, expect, it } from 'vitest'

function depsWith(
  repository: WebhookRepository,
  fetch: (request: Request) => Promise<Response> = async () => new Response(null, { status: 204 }),
): Deps {
  return {
    agentAudit: { append: async () => undefined },
    webhooks: repository,
    authorization: { listUserMemberships: async () => [] },
    secrets: createSecretCipher('test-webhook-secret-key-at-least-32-characters'),
    externalHttp: { fetch },
  } as unknown as Deps
}

describe('WebhookService', () => {
  it('creates, filters, toggles, rotates, deletes, inspects, and retries webhook resources', async () => {
    const repository = new InMemoryWebhookRepository()
    const deps = depsWith(repository)

    const created = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks/auth', events: ['user.created'], enabled: true, organizationId: null },
      userManagementActor('admin-1'),
    )

    expect(created.signingSecret).toMatch(/^whsec_/)
    expect(created.endpoint).toMatchObject({
      url: 'https://app.example.com/webhooks/auth',
      events: ['user.created'],
      enabled: true,
    })
    await expect(getWebhookEndpoint(deps, created.endpoint.id)).resolves.toMatchObject({ id: created.endpoint.id })
    expect(await listWebhookEndpoints(deps, { limit: 50, offset: 0, status: 'enabled' })).toMatchObject({
      endpoints: [{ id: created.endpoint.id }],
      pagination: { total: 1, hasMore: false },
    })

    await expect(updateWebhookEndpoint(deps, created.endpoint.id, { enabled: false })).resolves.toMatchObject({
      enabled: false,
    })
    await expect(listWebhookEndpoints(deps, { limit: 50, offset: 0, status: 'enabled' })).resolves.toMatchObject({
      endpoints: [],
      pagination: { total: 0 },
    })

    const rotated = await rotateWebhookSecret(deps, created.endpoint.id, userManagementActor('admin-1'))
    expect(rotated.signingSecret).toMatch(/^whsec_/)
    expect(rotated.signingSecret).not.toBe(created.signingSecret)

    const organizationEndpoint = await createWebhookEndpoint(
      deps,
      {
        url: 'https://organization.example.com/webhooks/auth',
        events: ['user.created'],
        enabled: true,
        organizationId: 'org-1',
      },
      userManagementActor('admin-1'),
    )
    await expect(
      rotateWebhookSecret(deps, organizationEndpoint.endpoint.id, userManagementActor('admin-1')),
    ).resolves.toMatchObject({ endpoint: { organizationId: 'org-1' } })

    const request = await repository.createRequest({
      id: 'whr_1',
      endpointId: created.endpoint.id,
      event: 'user.created',
      status: 'failed',
      attemptCount: 1,
      httpStatus: 500,
      error: 'Server error',
      requestBody: '{"id":"evt_seed"}',
      responseBody: '{"error":"failed"}',
      nextAttemptAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    await expect(getWebhookRequest(deps, request.id)).resolves.toMatchObject({ id: 'whr_1', status: 'failed' })
    await expect(listWebhookRequests(deps, { limit: 50, offset: 0, status: 'failed' })).resolves.toMatchObject({
      requests: [{ id: 'whr_1', status: 'failed' }],
      pagination: { total: 1, hasMore: false },
    })
    await expect(createWebhookDeliveryAttempt(deps, request.id, 'retry-1')).resolves.toMatchObject({
      attempt: { requestId: 'whr_1', status: 'delivered', sequence: 2, httpStatus: 204 },
      replayed: false,
    })
    await expect(getWebhookRequest(deps, request.id)).resolves.toMatchObject({ attemptCount: 2, status: 'delivered' })
    await expect(listWebhookDeliveryAttempts(deps, request.id, { limit: 50, offset: 0 })).resolves.toMatchObject({
      attempts: [{ requestId: request.id, sequence: 2 }],
      pagination: { total: 1 },
    })
    const [attempt] = (await listWebhookDeliveryAttempts(deps, request.id, { limit: 50, offset: 0 })).attempts
    await expect(getWebhookDeliveryAttempt(deps, request.id, attempt!.id)).resolves.toEqual(attempt)
    await expect(createWebhookDeliveryAttempt(deps, request.id, 'retry-1')).resolves.toMatchObject({
      attempt: { requestId: request.id, sequence: 2, status: 'delivered' },
      replayed: true,
    })
    await expect(listWebhookDeliveryAttempts(deps, request.id, { limit: 50, offset: 0 })).resolves.toMatchObject({
      pagination: { total: 1 },
    })

    await deleteWebhookEndpoint(deps, created.endpoint.id)
    await expect(getWebhookEndpoint(deps, created.endpoint.id)).rejects.toMatchObject({ status: 404 })
  })

  it('rejects duplicate events and delivered retries', async () => {
    const repository = new InMemoryWebhookRepository()
    const deps = depsWith(repository)
    const created = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks/auth', events: ['user.created'], enabled: true, organizationId: null },
      userManagementActor('admin-1'),
    )
    const request = await repository.createRequest({
      id: 'whr_1',
      endpointId: created.endpoint.id,
      event: 'user.created',
      status: 'delivered',
      attemptCount: 1,
      httpStatus: 200,
      error: null,
      requestBody: '{"id":"evt_seed"}',
      responseBody: null,
      nextAttemptAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(
      createWebhookEndpoint(
        deps,
        {
          url: 'https://app.example.com/duplicate',
          events: ['user.created', 'user.created'],
          enabled: true,
          organizationId: null,
        },
        userManagementActor('admin-1'),
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(createWebhookDeliveryAttempt(deps, request.id, 'retry-delivered')).rejects.toMatchObject({
      status: 409,
    })
  })

  it('returns not found when webhook resources disappear during mutations', async () => {
    const repository = new InMemoryWebhookRepository()
    const deps = depsWith(repository)

    await expect(updateWebhookEndpoint(deps, 'missing', { enabled: false })).rejects.toMatchObject({ status: 404 })
    await expect(deleteWebhookEndpoint(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(rotateWebhookSecret(deps, 'missing', userManagementActor('admin-1'))).rejects.toMatchObject({
      status: 404,
    })
    await expect(getWebhookRequest(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(createWebhookDeliveryAttempt(deps, 'missing', 'retry-missing')).rejects.toMatchObject({ status: 404 })
    await expect(getWebhookDeliveryAttempt(deps, 'missing', 'attempt-1')).rejects.toMatchObject({ status: 404 })

    const created = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks/auth', events: ['user.created'], enabled: true, organizationId: null },
      userManagementActor('admin-1'),
    )
    repository.missingEndpointUpdateIds.add(created.endpoint.id)
    await expect(
      updateWebhookEndpoint(deps, created.endpoint.id, { events: ['session.revoked'] }),
    ).rejects.toMatchObject({
      status: 404,
    })
    await expect(rotateWebhookSecret(deps, created.endpoint.id, userManagementActor('admin-1'))).rejects.toMatchObject({
      status: 404,
    })

    const request = await repository.createRequest({
      id: 'whr_1',
      endpointId: created.endpoint.id,
      event: 'user.created',
      status: 'failed',
      attemptCount: 1,
      httpStatus: 500,
      error: null,
      requestBody: '{"id":"evt_seed"}',
      responseBody: null,
      nextAttemptAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    repository.missingRequestUpdateIds.add(request.id)
    await expect(createWebhookDeliveryAttempt(deps, request.id, 'retry-disappeared')).rejects.toMatchObject({
      status: 404,
    })
    repository.missingRequestUpdateIds.clear()
    await expect(getWebhookDeliveryAttempt(deps, request.id, 'missing-attempt')).rejects.toMatchObject({ status: 404 })
  })

  it('publishes a stable signed event and records failed attempts before a real retry', async () => {
    const repository = new InMemoryWebhookRepository()
    const outbound: Request[] = []
    let status = 503
    const deps = depsWith(repository, async (request) => {
      outbound.push(request)
      return new Response(status === 204 ? null : 'temporarily unavailable', { status })
    })
    const created = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks/auth', events: ['user.created'], enabled: true, organizationId: null },
      userManagementActor('admin-1'),
    )

    const [failed] = await publishWebhookEvent(deps, 'user.created', { user: { id: 'user-1' } })
    expect(failed).toMatchObject({ status: 'failed', attemptCount: 1, httpStatus: 503 })
    expect(outbound).toHaveLength(1)
    const firstBody = await outbound[0]!.clone().text()
    const envelope = JSON.parse(firstBody) as { id: string; type: string; data: unknown }
    expect(envelope).toMatchObject({ type: 'user.created', data: { user: { id: 'user-1' } } })
    expect(envelope.id).toMatch(/^evt_/)
    expect(outbound[0]!.headers.get('x-realmroot-event-id')).toBe(envelope.id)
    expect(outbound[0]!.headers.get('x-realmroot-signature')).toMatch(/^v1=[a-f0-9]{64}$/)
    expect(repository.rawEndpoint(created.endpoint.id)?.signingSecret).toMatch(/^v1\./)

    status = 204
    const retried = await createWebhookDeliveryAttempt(deps, failed!.id, 'retry-after-failure')
    expect(retried).toMatchObject({
      attempt: { status: 'delivered', sequence: 2, httpStatus: 204 },
      replayed: false,
    })
    await expect(getWebhookRequest(deps, failed!.id)).resolves.toMatchObject({
      status: 'delivered',
      attemptCount: 2,
      httpStatus: 204,
    })
    expect(outbound).toHaveLength(2)
    expect(await outbound[1]!.clone().text()).toBe(firstBody)
    expect(outbound[1]!.headers.get('x-realmroot-signature')).not.toBeNull()
  })

  it('delivers Organization events only to Realm-wide and matching Organization endpoints', async () => {
    const repository = new InMemoryWebhookRepository()
    const outbound: string[] = []
    const deps = depsWith(repository, async (request) => {
      outbound.push(request.url)
      return new Response(null, { status: 204 })
    })
    for (const [suffix, organizationId] of [
      ['realm', null],
      ['acme', 'org-acme'],
      ['other', 'org-other'],
    ] as const) {
      await createWebhookEndpoint(
        deps,
        {
          url: `https://${suffix}.example.com/webhooks`,
          events: ['application.created'],
          enabled: true,
          organizationId,
        },
        userManagementActor('admin-1'),
      )
    }

    const deliveries = await publishWebhookEvent(deps, 'application.created', {
      application: { id: 'app-1', ownerOrganizationId: 'org-acme' },
    })

    expect(deliveries).toHaveLength(2)
    expect(outbound.sort()).toEqual(['https://acme.example.com/webhooks', 'https://realm.example.com/webhooks'])
  })

  it('handles durable delivery replay, legacy secrets, bounded responses, and delivery failures', async () => {
    const repository = new InMemoryWebhookRepository()
    const outbound: Request[] = []
    let chunkResponseAtBoundary = false
    const deps = depsWith(repository, async (request) => {
      outbound.push(request)
      if (!chunkResponseAtBoundary) return new Response('x'.repeat(9_000), { status: 500 })
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('x'.repeat(8 * 1024)))
            controller.enqueue(encoder.encode('overflow'))
            controller.close()
          },
        }),
        { status: 500 },
      )
    })
    const created = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks/auth', events: ['user.created'], enabled: true, organizationId: null },
      userManagementActor('admin-1'),
    )
    repository.rawEndpoint(created.endpoint.id)!.signingSecret = 'legacy-plaintext-secret'
    const requestInput: WebhookRequestInsert = {
      id: 'whr_edge',
      endpointId: created.endpoint.id,
      event: 'user.created',
      status: 'pending',
      attemptCount: 0,
      httpStatus: null,
      error: null,
      requestBody: '{"id":"evt_edge"}',
      responseBody: null,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const request = await repository.createRequest(requestInput)

    const failed = await deliverWebhookRequest(deps, request.id, 'edge-attempt')
    expect(failed).toMatchObject({
      status: 'failed',
      httpStatus: 500,
      responseBody: expect.stringContaining('[response truncated]'),
    })
    expect(repository.rawEndpoint(created.endpoint.id)!.signingSecret).toMatch(/^v1\./)
    await expect(deliverWebhookRequest(deps, request.id, 'edge-attempt')).resolves.toMatchObject({ id: request.id })
    expect(outbound).toHaveLength(1)

    chunkResponseAtBoundary = true
    const boundaryRequest = await repository.createRequest({
      ...requestInput,
      id: 'whr_boundary_response',
      requestBody: '{"id":"evt_boundary_response"}',
    })
    await expect(deliverWebhookRequest(deps, boundaryRequest.id, 'boundary-response')).resolves.toMatchObject({
      status: 'failed',
      responseBody: expect.stringContaining('[response truncated]'),
    })

    const noPayload = await repository.createRequest({ ...requestInput, id: 'whr_no_payload' })
    noPayload.requestBody = null
    await expect(deliverWebhookRequest(deps, noPayload.id, 'no-payload')).rejects.toMatchObject({ status: 400 })

    const invalidPayload = await repository.createRequest({
      ...requestInput,
      id: 'whr_invalid_payload',
      requestBody: '{"id":"wrong"}',
    })
    await expect(deliverWebhookRequest(deps, invalidPayload.id, 'invalid-payload')).resolves.toMatchObject({
      status: 'failed',
      error: 'Webhook request contains an invalid event payload.',
    })

    const thrown = depsWith(repository, async () => {
      throw new Error('network unavailable')
    })
    const networkRequest = await repository.createRequest({ ...requestInput, id: 'whr_network', attemptCount: 0 })
    await expect(deliverWebhookRequest(thrown, networkRequest.id, 'network')).resolves.toMatchObject({
      status: 'failed',
      error: 'network unavailable',
    })

    const nonError = depsWith(repository, async () => {
      throw 'network unavailable'
    })
    const unknownRequest = await repository.createRequest({ ...requestInput, id: 'whr_unknown', attemptCount: 0 })
    await expect(deliverWebhookRequest(nonError, unknownRequest.id, 'unknown')).resolves.toMatchObject({
      status: 'failed',
      error: 'Webhook delivery failed.',
    })
  })

  it('surfaces missing delivery resources and failed persistence boundaries', async () => {
    const repository = new InMemoryWebhookRepository()
    const deps = depsWith(repository)
    await expect(deliverWebhookRequest(deps, 'missing', 'attempt')).rejects.toMatchObject({ status: 404 })

    const created = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks', events: ['user.created'], enabled: true, organizationId: null },
      userManagementActor('admin-1'),
    )
    const input: WebhookRequestInsert = {
      id: 'whr_missing_endpoint',
      endpointId: created.endpoint.id,
      event: 'user.created',
      status: 'pending',
      attemptCount: 0,
      httpStatus: null,
      error: null,
      requestBody: '{"id":"evt_missing_endpoint"}',
      responseBody: null,
      nextAttemptAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const missingEndpointRequest = await repository.createRequest(input)
    await repository.deleteEndpoint(created.endpoint.id)
    repository.restoreRequest(missingEndpointRequest)
    await expect(deliverWebhookRequest(deps, input.id, 'attempt')).rejects.toMatchObject({ status: 404 })

    const recreated = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks', events: ['user.created'], enabled: true, organizationId: null },
      userManagementActor('admin-1'),
    )
    const missingUpdate = await repository.createRequest({
      ...input,
      id: 'whr_missing_update',
      endpointId: recreated.endpoint.id,
      requestBody: '{"id":"evt_missing_update"}',
    })
    repository.missingRequestUpdateIds.add(missingUpdate.id)
    await expect(deliverWebhookRequest(deps, missingUpdate.id, 'attempt')).rejects.toMatchObject({ status: 404 })

    repository.rawEndpoint(recreated.endpoint.id)!.signingSecret = 'legacy-secret'
    repository.missingEndpointUpdateIds.add(recreated.endpoint.id)
    const missingMigration = await repository.createRequest({
      ...input,
      id: 'whr_missing_migration',
      endpointId: recreated.endpoint.id,
      requestBody: '{"id":"evt_missing_migration"}',
    })
    await expect(deliverWebhookRequest(deps, missingMigration.id, 'attempt')).resolves.toMatchObject({
      status: 'failed',
      error: 'Webhook endpoint not found.',
    })
  })

  it('returns no requests without subscribers and resolves user Organization audiences', async () => {
    const repository = new InMemoryWebhookRepository()
    const deps = depsWith(repository)
    await expect(publishWebhookEvent(deps, 'session.created', { session: { userId: 'user-1' } })).resolves.toEqual([])

    await createWebhookEndpoint(
      deps,
      {
        url: 'https://acme.example.com/webhooks',
        events: ['session.created'],
        enabled: true,
        organizationId: 'org-acme',
      },
      userManagementActor('admin-1'),
    )
    deps.authorization.listUserMemberships = async () =>
      [{ organizationId: 'org-other' }, { organizationId: 'org-acme' }, { organizationId: 'org-acme' }] as never
    await expect(publishWebhookEvent(deps, 'session.created', { session: { userId: 'user-1' } })).resolves.toHaveLength(
      1,
    )
  })
})

class InMemoryWebhookRepository implements WebhookRepository {
  private endpoints: WebhookEndpointRow[] = []
  private requests: WebhookRequestRow[] = []
  private attempts: WebhookDeliveryAttemptRecord[] = []
  readonly missingEndpointUpdateIds = new Set<string>()
  readonly missingRequestUpdateIds = new Set<string>()

  async listEndpoints(query: ListWebhookEndpointsQuery, organizationIds?: string[]) {
    const items = this.endpoints.filter((endpoint) => {
      if (organizationIds && !endpoint.organizationId) return false
      if (organizationIds && !organizationIds.includes(endpoint.organizationId!)) return false
      if (query.status && endpoint.enabled !== (query.status === 'enabled')) return false
      if (query.organizationId && endpoint.organizationId !== query.organizationId) return false
      return !query.search || endpoint.url.includes(query.search)
    })
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length }
  }

  async findEndpoint(id: string) {
    return this.endpoints.find((endpoint) => endpoint.id === id) ?? null
  }

  async listSubscribedEndpoints(event: WebhookEvent, organizationIds: string[]) {
    return this.endpoints.filter(
      (endpoint) =>
        endpoint.enabled &&
        endpoint.events.includes(event) &&
        (endpoint.organizationId === null || organizationIds.includes(endpoint.organizationId)),
    )
  }

  rawEndpoint(id: string) {
    return this.endpoints.find((endpoint) => endpoint.id === id)
  }

  restoreRequest(request: WebhookRequestRow) {
    this.requests.push(request)
  }

  async createEndpoint(input: WebhookEndpointInsert) {
    const row = input as WebhookEndpointRow
    this.endpoints.push(row)
    return row
  }

  async updateEndpoint(id: string, input: Partial<WebhookEndpointInsert>) {
    if (this.missingEndpointUpdateIds.has(id)) return null
    const current = await this.findEndpoint(id)
    if (!current) return null
    Object.assign(current, input)
    return current
  }

  async updateEndpointWithAudit(id: string, input: Partial<WebhookEndpointInsert>) {
    return this.updateEndpoint(id, input)
  }

  async deleteEndpoint(id: string) {
    this.endpoints = this.endpoints.filter((endpoint) => endpoint.id !== id)
    this.requests = this.requests.filter((request) => request.endpointId !== id)
  }

  async listRequests(query: ListWebhookRequestsQuery, organizationIds?: string[]) {
    const items = this.requests.filter((request) => {
      if (organizationIds && !request.organizationId) return false
      if (organizationIds && !organizationIds.includes(request.organizationId!)) return false
      if (query.status && request.status !== query.status) return false
      if (query.endpointId && request.endpointId !== query.endpointId) return false
      if (query.organizationId && request.organizationId !== query.organizationId) return false
      return !query.search || request.event.includes(query.search) || request.endpointUrl.includes(query.search)
    })
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length }
  }

  async findRequest(id: string) {
    return this.requests.find((request) => request.id === id) ?? null
  }

  async updateRequest(id: string, input: Partial<WebhookRequestInsert>) {
    if (this.missingRequestUpdateIds.has(id)) return null
    const current = await this.findRequest(id)
    if (!current) return null
    Object.assign(current, input)
    return current
  }

  async createRequest(input: WebhookRequestInsert) {
    const endpoint = this.endpoints.find((value) => value.id === input.endpointId)
    if (!endpoint) throw new Error('Missing endpoint')
    const row = { ...input, endpointUrl: endpoint.url, organizationId: endpoint.organizationId } as WebhookRequestRow
    this.requests.push(row)
    return row
  }

  async listAttempts(requestId: string, page: { limit: number; offset: number }) {
    const items = this.attempts.filter((attempt) => attempt.requestId === requestId)
    return { items: items.slice(page.offset, page.offset + page.limit), total: items.length, ...page }
  }

  async findAttempt(id: string) {
    return this.attempts.find((attempt) => attempt.id === id) ?? null
  }

  async findAttemptByIdempotencyKey(requestId: string, idempotencyKey: string) {
    return (
      this.attempts.find((attempt) => attempt.requestId === requestId && attempt.idempotencyKey === idempotencyKey) ??
      null
    )
  }

  async reserveAttempt(input: Omit<WebhookDeliveryAttemptInsert, 'sequence'> & { previousAttemptCount: number }) {
    const existing = await this.findAttemptByIdempotencyKey(input.requestId, input.idempotencyKey)
    if (existing) return { attempt: existing, created: false }
    const { previousAttemptCount, ...attempt } = input
    const sequence =
      Math.max(
        previousAttemptCount,
        ...this.attempts.filter((item) => item.requestId === input.requestId).map((item) => item.sequence),
      ) + 1
    const row: WebhookDeliveryAttemptRecord = { ...attempt, sequence }
    this.attempts.push(row)
    return { attempt: row, created: true }
  }

  async updateAttempt(id: string, input: Partial<WebhookDeliveryAttemptInsert>) {
    const current = await this.findAttempt(id)
    if (!current) return null
    Object.assign(current, input)
    return current
  }
}
