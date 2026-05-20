import { describe, expect, it } from 'vitest'
import type { Database } from '../../db/client'
import { webhookDeliveryRequest, webhookEndpoint } from '../../db/schema'
import { createWebhookRepository, type WebhookEndpointRow, type WebhookRequestRow } from './repository'

describe('createWebhookRepository', () => {
  it('persists endpoint and request resources through the Drizzle adapter', async () => {
    const endpoint = webhookEndpointRow()
    const request = webhookRequestRow()
    const db = new FakeDb({ endpoints: [endpoint], requests: [request] })
    const repository = createWebhookRepository(db as unknown as Database)

    await expect(
      repository.listEndpoints({ limit: 10, offset: 0, search: 'auth', status: 'enabled' }),
    ).resolves.toEqual({
      items: [endpoint],
      total: 1,
    })
    await expect(repository.findEndpoint(endpoint.id)).resolves.toEqual(endpoint)

    const created = webhookEndpointRow({ id: 'wh_created', url: 'https://events.example.com/auth' })
    await expect(repository.createEndpoint(created)).resolves.toEqual(created)
    await expect(repository.updateEndpoint(endpoint.id, { enabled: false })).resolves.toMatchObject({ enabled: false })

    await expect(
      repository.listRequests({
        limit: 10,
        offset: 0,
        endpointId: endpoint.id,
        search: 'user',
        status: 'failed',
      }),
    ).resolves.toEqual({
      items: [{ ...request, endpointUrl: endpoint.url }],
      total: 1,
    })
    await expect(repository.findRequest(request.id)).resolves.toEqual({ ...request, endpointUrl: endpoint.url })
    await expect(repository.updateRequest(request.id, { status: 'pending' })).resolves.toMatchObject({
      id: request.id,
      endpointUrl: endpoint.url,
      status: 'pending',
    })

    await repository.deleteEndpoint(endpoint.id)
    expect(db.deletedEndpointIds).toEqual([endpoint.id])
  })

  it('returns null and zero totals for absent webhook rows', async () => {
    const db = new FakeDb()
    const repository = createWebhookRepository(db as unknown as Database)

    await expect(repository.listEndpoints({ limit: 10, offset: 0 })).resolves.toEqual({ items: [], total: 0 })
    await expect(repository.findEndpoint('missing')).resolves.toBeNull()
    await expect(repository.updateEndpoint('missing', { enabled: false })).resolves.toBeNull()
    await expect(repository.listRequests({ limit: 10, offset: 0 })).resolves.toEqual({ items: [], total: 0 })
    await expect(repository.findRequest('missing')).resolves.toBeNull()
    await expect(repository.updateRequest('missing', { status: 'pending' })).resolves.toBeNull()
  })

  it('returns null when an updated request no longer has an endpoint', async () => {
    const request = webhookRequestRow({ endpointId: 'missing-endpoint' })
    const db = new FakeDb({ requests: [request] })
    const repository = createWebhookRepository(db as unknown as Database)

    await expect(repository.updateRequest(request.id, { status: 'pending' })).resolves.toBeNull()
  })
})

class FakeDb {
  readonly endpoints: WebhookEndpointRow[]
  readonly requests: WebhookRequestRow[]
  readonly deletedEndpointIds: string[] = []
  private lastEndpointId: string | null = null
  private lastRequestId: string | null = null

  constructor(input: { endpoints?: WebhookEndpointRow[]; requests?: WebhookRequestRow[] } = {}) {
    this.endpoints = input.endpoints ?? []
    this.requests = input.requests ?? []
  }

  select(selection?: Record<string, unknown>) {
    return new FakeSelectQuery(this, selection)
  }

  insert(table: unknown) {
    return {
      values: (input: WebhookEndpointRow) => ({
        returning: async () => {
          expect(table).toBe(webhookEndpoint)
          this.endpoints.push(input)
          return [input]
        },
      }),
    }
  }

  update(table: unknown) {
    return {
      set: (input: Partial<WebhookEndpointRow | WebhookRequestRow>) => ({
        where: () => ({
          returning: async () => {
            if (table === webhookEndpoint) {
              const endpoint = this.endpoints.find((row) => row.id === this.lastEndpointId) ?? null
              if (!endpoint) return []
              Object.assign(endpoint, input)
              return [endpoint]
            }
            const request = this.requests.find((row) => row.id === this.lastRequestId) ?? null
            if (!request) return []
            Object.assign(request, input)
            return [request]
          },
        }),
      }),
    }
  }

  delete(table: unknown) {
    return {
      where: async () => {
        expect(table).toBe(webhookEndpoint)
        if (this.lastEndpointId) this.deletedEndpointIds.push(this.lastEndpointId)
      },
    }
  }

  setEndpointId(id: string) {
    this.lastEndpointId = id
  }

  setRequestId(id: string) {
    this.lastRequestId = id
  }
}

class FakeSelectQuery implements PromiseLike<unknown[]> {
  private table: unknown = null

  constructor(
    private readonly db: FakeDb,
    private readonly selection?: Record<string, unknown>,
  ) {}

  from(table: unknown) {
    this.table = table
    return this
  }

  innerJoin() {
    return this
  }

  where(condition: unknown) {
    const text = String(condition)
    const endpoint = this.db.endpoints.find((row) => text.includes(row.id))
    const request = this.db.requests.find((row) => text.includes(row.id))
    if (endpoint) this.db.setEndpointId(endpoint.id)
    else if (this.table === webhookEndpoint && this.db.endpoints[0]) this.db.setEndpointId(this.db.endpoints[0].id)
    if (request) this.db.setRequestId(request.id)
    else if (this.table === webhookDeliveryRequest && this.db.requests[0]) this.db.setRequestId(this.db.requests[0].id)
    return this
  }

  orderBy() {
    return this
  }

  limit() {
    return this
  }

  offset() {
    return this
  }

  // biome-ignore lint/suspicious/noThenProperty: The fake mirrors Drizzle's awaitable query builder contract.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (this.selection && 'value' in this.selection) {
      const rows = this.rows()
      return rows.length > 0 ? [{ value: rows.length }] : []
    }
    if (this.selection && 'request' in this.selection) {
      return this.db.requests.map((request) => ({
        request,
        endpointUrl: this.db.endpoints.find((endpoint) => endpoint.id === request.endpointId)?.url ?? '',
      }))
    }
    return this.rows()
  }

  private rows() {
    if (this.table === webhookDeliveryRequest) return this.db.requests
    return this.db.endpoints
  }
}

function webhookEndpointRow(overrides: Partial<WebhookEndpointRow> = {}): WebhookEndpointRow {
  return {
    id: 'wh_1',
    url: 'https://app.example.com/webhooks/auth',
    events: ['user.created'],
    enabled: true,
    signingSecret: 'whsec_secret',
    secretPrefix: 'whsec_sec',
    createdByUserId: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function webhookRequestRow(overrides: Partial<WebhookRequestRow> = {}): WebhookRequestRow {
  return {
    id: 'whr_1',
    endpointId: 'wh_1',
    endpointUrl: 'https://app.example.com/webhooks/auth',
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
    ...overrides,
  }
}
