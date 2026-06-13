import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { webhookDeliveryRequest } from '@server/db/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('connector management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous reads with 401', async () => {
    expect((await harness.request('/api/management/connectors')).status).toBe(401)
  })

  it('lists templates, then runs the connector lifecycle and readiness through real SQL', async () => {
    const cookie = await signInAdmin(harness)

    const templates = await harness.request('/api/management/connectors/templates', { headers: { cookie } })
    expect(templates.status).toBe(200)
    expect(((await templates.json()) as { templates: unknown[] }).templates.length).toBeGreaterThan(0)

    const created = await harness.request('/api/management/connectors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        providerType: 'social',
        providerId: 'google',
        displayName: 'Google',
        clientId: 'google-client',
        clientSecret: 'google-secret',
      }),
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const connector = (await created.json()) as { id: string }

    const list = await harness.request('/api/management/connectors', { headers: { cookie } })
    expect(((await list.json()) as { connectors: unknown[] }).connectors.length).toBe(1)

    const fetched = await harness.request(`/api/management/connectors/${connector.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)

    const readiness = await harness.request(`/api/management/connectors/${connector.id}/readiness`, {
      headers: { cookie },
    })
    expect(readiness.status).toBe(200)

    const patched = await harness.request(`/api/management/connectors/${connector.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ displayName: 'Google Workspace' }),
    })
    expect(((await patched.json()) as { displayName: string }).displayName).toBe('Google Workspace')

    const removed = await harness.request(`/api/management/connectors/${connector.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(removed.status).toBe(204)
  })

  it('rejects an invalid connector payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/management/connectors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      // enabled social connector is missing clientId/clientSecret.
      body: JSON.stringify({ providerType: 'social', providerId: 'google', displayName: 'Google' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('webhook management over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  it('rejects anonymous reads with 401', async () => {
    expect((await harness.request('/api/management/webhooks/endpoints')).status).toBe(401)
  })

  it('rejects an invalid endpoint payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/management/webhooks/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      // http URL is rejected (https required) and events is empty.
      body: JSON.stringify({ url: 'http://example.com/hook', events: [] }),
    })
    expect(response.status).toBe(400)
  })

  it('runs the endpoint lifecycle and secret rotation through real SQL [spec: management-api/management-restish-webhook-crud]', async () => {
    const cookie = await signInAdmin(harness)

    const created = await harness.request('/api/management/webhooks/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['user.created'] }),
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const endpoint = ((await created.json()) as { endpoint: { id: string; secretPrefix: string } }).endpoint

    const list = await harness.request('/api/management/webhooks/endpoints', { headers: { cookie } })
    expect(((await list.json()) as { endpoints: unknown[] }).endpoints.length).toBe(1)

    const fetched = await harness.request(`/api/management/webhooks/endpoints/${endpoint.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)

    const patched = await harness.request(`/api/management/webhooks/endpoints/${endpoint.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ events: ['user.created', 'user.deleted'] }),
    })
    expect(patched.status).toBe(200)

    const rotated = await harness.request(`/api/management/webhooks/endpoints/${endpoint.id}/secrets`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(rotated.status).toBe(201)
    expect(((await rotated.json()) as { signingSecret: string }).signingSecret).toBeTruthy()

    const removed = await harness.request(`/api/management/webhooks/endpoints/${endpoint.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(removed.status).toBe(204)
  })

  it('lists, reads, and retries a seeded webhook delivery request through real SQL', async () => {
    const cookie = await signInAdmin(harness)

    const created = await harness.request('/api/management/webhooks/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['user.created'] }),
    })
    const endpoint = ((await created.json()) as { endpoint: { id: string } }).endpoint

    // No API seeds delivery rows (they are produced by the dispatcher), so seed
    // one directly to exercise listRequests/findRequest/updateRequest over real SQL.
    const now = new Date()
    await harness.db.insert(webhookDeliveryRequest).values({
      id: 'whreq-1',
      endpointId: endpoint.id,
      event: 'user.created',
      status: 'failed',
      attemptCount: 1,
      httpStatus: 500,
      createdAt: now,
      updatedAt: now,
    })

    const list = await harness.request('/api/management/webhooks/requests', { headers: { cookie } })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { requests: Array<{ id: string }> }).requests).toEqual([
      expect.objectContaining({ id: 'whreq-1', endpointUrl: 'https://example.com/hook' }),
    ])

    const filtered = await harness.request(
      `/api/management/webhooks/requests?endpointId=${endpoint.id}&status=failed`,
      { headers: { cookie } },
    )
    expect(((await filtered.json()) as { requests: unknown[] }).requests.length).toBe(1)

    const fetched = await harness.request('/api/management/webhooks/requests/whreq-1', { headers: { cookie } })
    expect(fetched.status).toBe(200)

    const retried = await harness.request('/api/management/webhooks/requests/whreq-1/retries', {
      method: 'POST',
      headers: { cookie },
    })
    expect(retried.status).toBe(202)
    expect(((await retried.json()) as { status: string }).status).toBe('pending')
  })
})
