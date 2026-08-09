import { handleApiError } from '@server/http/errors'
import { depsMiddleware } from '@server/http/middleware/deps'
import { createProviderConnectionEventRoutes } from '@server/http/routes/provider-connection-events'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

const secret = 'provider-connection-event-secret-for-tests-2026'
const path = '/api/provider-connection-events/delivery-1'
const body = JSON.stringify({
  type: 'authorityChanged',
  resource: 'https://adapter.example.com/provider',
  brokerReference: 'installation-1',
  occurredAt: '2026-08-08T20:00:00.000Z',
  revision: 1,
  scopes: ['contents:read'],
  authorizationDetails: [{ type: 'provider_installation', resource_ids: ['repo-1'] }],
})

describe('Provider Connection Event routes', () => {
  it('[spec: agent-identity/provider-connection-events] authenticates and applies an idempotent event resource', async () => {
    const deps = createTestDeps()
    const app = testApp(deps)
    const timestamp = `${Math.floor(Date.now() / 1000)}`
    const response = await app.request(`https://auth.example.com${path}`, {
      method: 'PUT',
      headers: await signedHeaders(timestamp, body),
      body,
    })

    expect(response.status).toBe(204)
    expect(deps.externalResources.applyProviderConnectionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delivery-1',
        brokerReference: 'installation-1',
        type: 'authorityChanged',
        scopes: ['contents:read'],
      }),
    )
  })

  it('rejects missing, stale, malformed, and invalidly signed requests before persistence', async () => {
    const deps = createTestDeps()
    const app = testApp(deps)
    const current = `${Math.floor(Date.now() / 1000)}`
    const stale = `${Math.floor(Date.now() / 1000) - 301}`
    const invalid = await signedHeaders(current, body)
    invalid.set('Realmroot-Signature', 'sha256=deadbeef')
    const otherResourceBody = body.replace(
      'https://adapter.example.com/provider',
      'https://other-adapter.example.com/provider',
    )
    const missingRevisionBody = body.replace(',"revision":1', '')

    const responses = await Promise.all([
      app.request(`https://auth.example.com${path}`, { method: 'PUT', body }),
      app.request(`https://auth.example.com${path}`, {
        method: 'PUT',
        headers: await signedHeaders(stale, body),
        body,
      }),
      app.request(`https://auth.example.com${path}`, { method: 'PUT', headers: invalid, body }),
      app.request(`https://auth.example.com${path}`, {
        method: 'PUT',
        headers: await signedHeaders(current, otherResourceBody),
        body: otherResourceBody,
      }),
      app.request(`https://auth.example.com${path}`, {
        method: 'PUT',
        headers: await signedHeaders(current, '{'),
        body: '{',
      }),
      app.request(`https://auth.example.com${path}`, {
        method: 'PUT',
        headers: await signedHeaders(current, missingRevisionBody),
        body: missingRevisionBody,
      }),
    ])

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 400, 400])
    expect(deps.externalResources.applyProviderConnectionEvent).not.toHaveBeenCalled()
  })

  it('maps a reused event identity with a different representation to conflict', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.externalResources.applyProviderConnectionEvent).mockResolvedValue('conflict')
    const app = testApp(deps)
    const timestamp = `${Math.floor(Date.now() / 1000)}`
    const response = await app.request(`https://auth.example.com${path}`, {
      method: 'PUT',
      headers: await signedHeaders(timestamp, body),
      body,
    })

    expect(response.status).toBe(409)
  })

  it('rejects an oversized representation before buffering or authenticating it', async () => {
    const deps = createTestDeps()
    const app = testApp(deps)
    const response = await app.request(`https://auth.example.com${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(64 * 1024) }),
    })

    expect(response.status).toBe(413)
    expect(deps.externalResources.applyProviderConnectionEvent).not.toHaveBeenCalled()
  })
})

function testApp(deps: ReturnType<typeof createTestDeps>) {
  return new Hono()
    .use('*', depsMiddleware(deps))
    .onError((error, c) => handleApiError(error, c))
    .route(
      '/api/provider-connection-events',
      createProviderConnectionEventRoutes({ 'https://adapter.example.com/provider': secret }),
    )
}

async function signedHeaders(timestamp: string, rawBody: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const value = `${timestamp}\nPUT\n${path}\n${rawBody}`
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return new Headers({
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
    'Realmroot-Timestamp': timestamp,
    'Realmroot-Signature': `sha256=${hex}`,
  })
}
