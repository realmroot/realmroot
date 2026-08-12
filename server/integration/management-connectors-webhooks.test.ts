import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { identityProviderConnector, webhookEndpoint } from '@server/db/schema'
import { eq } from 'drizzle-orm'
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
    expect((await harness.request('/api/connectors')).status).toBe(401)
  })

  it('lists templates, then runs the connector lifecycle and readiness through real SQL', async () => {
    const cookie = await signInAdmin(harness)

    const templates = await harness.request('/api/connectors/templates', { headers: { cookie } })
    expect(templates.status).toBe(200)
    expect(((await templates.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0)

    const created = await harness.request('/api/connectors', {
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
    const [stored] = await harness.db
      .select({ clientSecret: identityProviderConnector.clientSecret })
      .from(identityProviderConnector)
      .where(eq(identityProviderConnector.id, connector.id))
    expect(stored.clientSecret).toMatch(/^v1\./)
    expect(stored.clientSecret).not.toContain('google-secret')
    await expect(harness.deps.connectors.findById(connector.id)).resolves.toMatchObject({
      clientSecret: 'google-secret',
    })

    const list = await harness.request('/api/connectors', { headers: { cookie } })
    expect(((await list.json()) as { items: unknown[] }).items.length).toBe(1)

    const fetched = await harness.request(`/api/connectors/${connector.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)

    const readiness = await harness.request(`/api/connectors/${connector.id}/readiness`, {
      headers: { cookie },
    })
    expect(readiness.status).toBe(200)

    const patched = await harness.request(`/api/connectors/${connector.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ displayName: 'Google Workspace' }),
    })
    expect(((await patched.json()) as { displayName: string }).displayName).toBe('Google Workspace')

    const removed = await harness.request(`/api/connectors/${connector.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(removed.status).toBe(204)
  })

  it('encrypts legacy connector secrets in place before hosted auth uses them [spec: connectors-and-methods/connector-secret-upgrade]', async () => {
    const now = new Date()
    await harness.db.insert(identityProviderConnector).values({
      id: 'idp_legacy_github',
      slug: 'github',
      providerType: 'social',
      providerId: 'github',
      displayName: 'GitHub',
      enabled: true,
      clientId: 'legacy-client',
      clientSecret: 'legacy-plaintext-secret',
      scopes: ['read:user', 'user:email'],
      createdAt: now,
      updatedAt: now,
    })

    await expect(harness.deps.connectors.listEnabled()).resolves.toEqual([
      expect.objectContaining({
        id: 'idp_legacy_github',
        clientSecret: 'legacy-plaintext-secret',
      }),
    ])

    const [stored] = await harness.db
      .select({ clientSecret: identityProviderConnector.clientSecret })
      .from(identityProviderConnector)
      .where(eq(identityProviderConnector.id, 'idp_legacy_github'))
    expect(stored.clientSecret).toMatch(/^v1\./)
    expect(stored.clientSecret).not.toContain('legacy-plaintext-secret')
    await expect(harness.deps.connectors.findById('idp_legacy_github')).resolves.toMatchObject({
      clientSecret: 'legacy-plaintext-secret',
    })
  })

  it('rejects an invalid connector payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/connectors', {
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
    expect((await harness.request('/api/webhooks')).status).toBe(401)
  })

  it('rejects an invalid endpoint payload with 400', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      // http URL is rejected (https required) and events is empty.
      body: JSON.stringify({ url: 'http://example.com/hook', events: [], organizationId: null }),
    })
    expect(response.status).toBe(400)
  })

  it('persists the platform Organization as an ordinary Webhook owner', async () => {
    const cookie = await signInAdmin(harness)
    const response = await harness.request('/api/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        url: 'https://example.com/realm-hook',
        events: ['user.created'],
        organizationId: 'org_platform',
      }),
    })

    expect(response.status, await response.clone().text()).toBe(201)
    expect(((await response.json()) as { endpoint: { organizationId: string | null } }).endpoint.organizationId).toBe(
      'org_platform',
    )
  })

  it('runs the endpoint lifecycle and secret rotation through real SQL [spec: management-api/management-restish-webhook-crud]', async () => {
    const cookie = await signInAdmin(harness)

    const created = await harness.request('/api/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['user.created'], organizationId: null }),
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const endpoint = ((await created.json()) as { endpoint: { id: string; secretPrefix: string } }).endpoint

    const list = await harness.request('/api/webhooks', { headers: { cookie } })
    expect(((await list.json()) as { items: unknown[] }).items.length).toBe(1)

    const fetched = await harness.request(`/api/webhooks/${endpoint.id}`, { headers: { cookie } })
    expect(fetched.status).toBe(200)

    const patched = await harness.request(`/api/webhooks/${endpoint.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ events: ['user.created', 'user.deleted'] }),
    })
    expect(patched.status).toBe(200)

    const rotated = await harness.request(`/api/webhooks/${endpoint.id}/secrets`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(rotated.status).toBe(201)
    expect(((await rotated.json()) as { signingSecret: string }).signingSecret).toBeTruthy()

    const removed = await harness.request(`/api/webhooks/${endpoint.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(removed.status).toBe(204)
  })

  it('signs, delivers, records, and retries product events through real SQL [spec: admin-console/webhook-event-delivery]', async () => {
    const cookie = await signInAdmin(harness)
    const outbound: Request[] = []
    let outboundStatus = 503
    harness.deps.externalHttp.fetch = async (request) => {
      outbound.push(request)
      return new Response(outboundStatus === 204 ? null : 'temporarily unavailable', { status: outboundStatus })
    }

    const created = await harness.request('/api/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['user.created'], organizationId: null }),
    })
    const secretResponse = (await created.json()) as { endpoint: { id: string }; signingSecret: string }
    const endpoint = secretResponse.endpoint
    const [storedEndpoint] = await harness.db
      .select({ signingSecret: webhookEndpoint.signingSecret })
      .from(webhookEndpoint)
      .where(eq(webhookEndpoint.id, endpoint.id))
    expect(storedEndpoint.signingSecret).toMatch(/^v1\./)
    expect(storedEndpoint.signingSecret).not.toContain(secretResponse.signingSecret)

    const createdUser = await harness.request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        email: 'webhook-user@example.com',
        password: 'Webhook2026!',
        displayName: 'Webhook User',
      }),
    })
    expect(createdUser.status, await createdUser.clone().text()).toBe(201)
    expect(outbound).toHaveLength(1)

    const list = await harness.request(`/api/webhooks/${endpoint.id}/deliveries`, { headers: { cookie } })
    expect(list.status).toBe(200)
    const [request] = (
      (await list.json()) as {
        items: Array<{ id: string; status: string; attemptCount: number; requestBody: string }>
      }
    ).items
    expect(request).toMatchObject({ status: 'failed', attemptCount: 1 })
    const body = await outbound[0]!.clone().text()
    expect(request.requestBody).toBe(body)
    const event = JSON.parse(body) as { id: string; type: string; data: { user: { email: string } } }
    expect(event).toMatchObject({ type: 'user.created', data: { user: { email: 'webhook-user@example.com' } } })
    expect(outbound[0]!.headers.get('x-realmroot-event-id')).toBe(event.id)
    const timestamp = outbound[0]!.headers.get('x-realmroot-timestamp')!
    expect(outbound[0]!.headers.get('x-realmroot-signature')).toBe(
      await webhookSignature(secretResponse.signingSecret, timestamp, body),
    )

    const filtered = await harness.request(`/api/webhooks/${endpoint.id}/deliveries?status=failed`, {
      headers: { cookie },
    })
    expect(((await filtered.json()) as { items: unknown[] }).items.length).toBe(1)

    const fetched = await harness.request(`/api/webhooks/${endpoint.id}/deliveries/${request.id}`, {
      headers: { cookie },
    })
    expect(fetched.status).toBe(200)

    outboundStatus = 204
    const retried = await harness.request(`/api/webhooks/${endpoint.id}/deliveries/${request.id}/attempts`, {
      method: 'POST',
      headers: { cookie, 'Idempotency-Key': `retry-${request.id}` },
    })
    expect(retried.status).toBe(201)
    const retriedAttempt = (await retried.json()) as { id: string }
    expect(retriedAttempt).toEqual(
      expect.objectContaining({ requestId: request.id, status: 'delivered', sequence: 2, httpStatus: 204 }),
    )
    const replayed = await harness.request(`/api/webhooks/${endpoint.id}/deliveries/${request.id}/attempts`, {
      method: 'POST',
      headers: { cookie, 'Idempotency-Key': `retry-${request.id}` },
    })
    expect(replayed.status).toBe(201)
    expect(replayed.headers.get('Idempotency-Replayed')).toBe('true')
    await expect(replayed.json()).resolves.toEqual(expect.objectContaining({ id: retriedAttempt.id }))
    const deliveredRequest = await harness.request(`/api/webhooks/${endpoint.id}/deliveries/${request.id}`, {
      headers: { cookie },
    })
    await expect(deliveredRequest.json()).resolves.toEqual(
      expect.objectContaining({ status: 'delivered', attemptCount: 2, httpStatus: 204 }),
    )
    expect(outbound).toHaveLength(2)
    expect(await outbound[1]!.clone().text()).toBe(body)
  })
})

async function webhookSignature(secret: string, timestamp: string, body: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`))
  return `v1=${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
