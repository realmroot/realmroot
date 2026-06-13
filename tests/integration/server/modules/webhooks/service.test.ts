import type {
  WebhookEndpointInsert,
  WebhookEndpointRow,
  WebhookRequestInsert,
  WebhookRequestRow,
} from '@server/adapters/repos/webhooks'
import type { Deps } from '@server/usecases/deps'
import type { WebhookRepository } from '@server/usecases/ports'
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  getWebhookRequest,
  listWebhookEndpoints,
  listWebhookRequests,
  retryWebhookRequest,
  rotateWebhookSecret,
  updateWebhookEndpoint,
} from '@server/usecases/webhooks'
import type { ListWebhookEndpointsQuery, ListWebhookRequestsQuery } from '@shared/api/webhooks'
import { describe, expect, it } from 'vitest'

function depsWith(repository: WebhookRepository): Deps {
  return { webhooks: repository } as unknown as Deps
}

describe('WebhookService', () => {
  it('creates, filters, toggles, rotates, deletes, inspects, and retries webhook resources', async () => {
    const repository = new InMemoryWebhookRepository()
    const deps = depsWith(repository)

    const created = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks/auth', events: ['user.created'], enabled: true },
      'admin-1',
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

    const rotated = await rotateWebhookSecret(deps, created.endpoint.id)
    expect(rotated.signingSecret).toMatch(/^whsec_/)
    expect(rotated.signingSecret).not.toBe(created.signingSecret)

    const request = repository.createRequest({
      id: 'whr_1',
      endpointId: created.endpoint.id,
      event: 'user.created',
      status: 'failed',
      attemptCount: 1,
      httpStatus: 500,
      error: 'Server error',
      requestBody: '{"id":"user-1"}',
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
    await expect(retryWebhookRequest(deps, request.id)).resolves.toMatchObject({ id: 'whr_1', status: 'pending' })

    await deleteWebhookEndpoint(deps, created.endpoint.id)
    await expect(getWebhookEndpoint(deps, created.endpoint.id)).rejects.toMatchObject({ status: 404 })
  })

  it('rejects duplicate events and delivered retries', async () => {
    const repository = new InMemoryWebhookRepository()
    const deps = depsWith(repository)
    const created = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks/auth', events: ['user.created'], enabled: true },
      'admin-1',
    )
    const request = repository.createRequest({
      id: 'whr_1',
      endpointId: created.endpoint.id,
      event: 'user.created',
      status: 'delivered',
      attemptCount: 1,
      httpStatus: 200,
      error: null,
      requestBody: null,
      responseBody: null,
      nextAttemptAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(
      createWebhookEndpoint(
        deps,
        { url: 'https://app.example.com/duplicate', events: ['user.created', 'user.created'], enabled: true },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(retryWebhookRequest(deps, request.id)).rejects.toMatchObject({ status: 400 })
  })

  it('returns not found when webhook resources disappear during mutations', async () => {
    const repository = new InMemoryWebhookRepository()
    const deps = depsWith(repository)

    await expect(updateWebhookEndpoint(deps, 'missing', { enabled: false })).rejects.toMatchObject({ status: 404 })
    await expect(deleteWebhookEndpoint(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(rotateWebhookSecret(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(getWebhookRequest(deps, 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(retryWebhookRequest(deps, 'missing')).rejects.toMatchObject({ status: 404 })

    const created = await createWebhookEndpoint(
      deps,
      { url: 'https://app.example.com/webhooks/auth', events: ['user.created'], enabled: true },
      'admin-1',
    )
    repository.missingEndpointUpdateIds.add(created.endpoint.id)
    await expect(
      updateWebhookEndpoint(deps, created.endpoint.id, { events: ['session.revoked'] }),
    ).rejects.toMatchObject({
      status: 404,
    })
    await expect(rotateWebhookSecret(deps, created.endpoint.id)).rejects.toMatchObject({ status: 404 })

    const request = repository.createRequest({
      id: 'whr_1',
      endpointId: created.endpoint.id,
      event: 'user.created',
      status: 'failed',
      attemptCount: 1,
      httpStatus: 500,
      error: null,
      requestBody: null,
      responseBody: null,
      nextAttemptAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    repository.missingRequestUpdateIds.add(request.id)
    await expect(retryWebhookRequest(deps, request.id)).rejects.toMatchObject({ status: 404 })
  })
})

class InMemoryWebhookRepository implements WebhookRepository {
  private endpoints: WebhookEndpointRow[] = []
  private requests: WebhookRequestRow[] = []
  readonly missingEndpointUpdateIds = new Set<string>()
  readonly missingRequestUpdateIds = new Set<string>()

  async listEndpoints(query: ListWebhookEndpointsQuery) {
    const items = this.endpoints.filter((endpoint) => {
      if (query.status && endpoint.enabled !== (query.status === 'enabled')) return false
      return !query.search || endpoint.url.includes(query.search)
    })
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length }
  }

  async findEndpoint(id: string) {
    return this.endpoints.find((endpoint) => endpoint.id === id) ?? null
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

  async deleteEndpoint(id: string) {
    this.endpoints = this.endpoints.filter((endpoint) => endpoint.id !== id)
    this.requests = this.requests.filter((request) => request.endpointId !== id)
  }

  async listRequests(query: ListWebhookRequestsQuery) {
    const items = this.requests.filter((request) => {
      if (query.status && request.status !== query.status) return false
      if (query.endpointId && request.endpointId !== query.endpointId) return false
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

  createRequest(input: WebhookRequestInsert) {
    const endpoint = this.endpoints.find((value) => value.id === input.endpointId)
    if (!endpoint) throw new Error('Missing endpoint')
    const row = { ...input, endpointUrl: endpoint.url } as WebhookRequestRow
    this.requests.push(row)
    return row
  }
}
