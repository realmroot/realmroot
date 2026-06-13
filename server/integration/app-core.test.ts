import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('core routes over real D1', () => {
  it('serves health without touching auth', async () => {
    const { request } = await createHarness()
    const response = await request('/api/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, service: 'flareauth' })
  })

  it('serves the public configz contract built from the security policy', async () => {
    const { request } = await createHarness()
    const response = await request('/api/configz')

    expect(response.status).toBe(200)
    const body = (await response.json()) as { signIn: { passwordEnabled: boolean }; onboarding: { required: boolean } }
    expect(body.signIn.passwordEnabled).toBe(true)
    expect(body.onboarding.required).toBe(true)
  })

  it('maps unknown routes to the JSON boundary error', async () => {
    const { request } = await createHarness()
    const response = await request('/api/missing', { headers: { 'cf-ray': 'req-1' } })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_found', message: 'Resource not found.', requestId: 'req-1' },
    })
  })

  it('rejects untrusted API origins before any handler runs', async () => {
    const { request } = await createHarness()
    const response = await request('/api/health', { headers: { origin: 'https://evil.example.com' } })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'forbidden', message: 'Origin is not trusted for this issuer.' },
    })
  })
})

describe('onboarding bootstrap writes real D1 rows', () => {
  it('reports onboarding as required on an empty database', async () => {
    const { request } = await createHarness()
    const response = await request('/api/onboarding/status')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ required: true })
  })

  it('creates the first admin, then locks onboarding', async () => {
    const { request } = await createHarness()

    const created = await request('/api/onboarding/admin-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        username: 'admin',
        name: 'FlareAuth Admin',
        password: 'admin-password-2026',
      }),
    })

    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({
      user: { email: 'admin@example.com', role: 'admin' },
      onboarding: { locked: true },
    })

    const userRow = await env.DB.prepare('select role from user where email = ?1')
      .bind('admin@example.com')
      .first<{ role: string }>()
    expect(userRow?.role).toBe('admin')

    const status = await request('/api/onboarding/status')
    await expect(status.json()).resolves.toEqual({ required: false })

    const second = await request('/api/onboarding/admin-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'second@example.com',
        username: 'second',
        name: 'Second Admin',
        password: 'second-password-2026',
      }),
    })
    expect(second.status).toBe(403)
  })

  it('rejects malformed onboarding payloads at the validation boundary', async () => {
    const { request } = await createHarness()
    const response = await request('/api/onboarding/admin-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'short', name: '' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'bad_request' } })
  })
})
