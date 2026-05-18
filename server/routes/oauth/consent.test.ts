import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiError } from '../../lib/errors'
import { createOAuthConsentRoute } from './consent'

describe('OAuth consent routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('requires authentication before creating consent', async () => {
    const service = createConsentServiceMock()
    const response = await createTestApp(service).request('/api/oauth/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', scopes: ['openid'] }),
    })

    expect(response.status).toBe(401)
    expect(service.createConsent).not.toHaveBeenCalled()
  })

  it('validates hosted consent approval without accepting client permissions', async () => {
    const service = createConsentServiceMock()
    const response = await createTestApp(service).request('/api/oauth/consent', {
      method: 'POST',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', scopes: ['openid'], permissions: ['admin:all'] }),
    })

    expect(response.status).toBe(400)
    expect(service.createConsent).not.toHaveBeenCalled()
  })

  it('creates consent for the authenticated user and returns 201', async () => {
    const service = createConsentServiceMock()
    const response = await createTestApp(service).request('/api/oauth/consent', {
      method: 'POST',
      headers: { ...userHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', scopes: ['openid', 'profile'] }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      consent: {
        id: 'consent-1',
        scopes: ['openid', 'profile'],
        grantedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    expect(service.createConsent).toHaveBeenCalledWith(
      { clientId: 'client-1', scopes: ['openid', 'profile'] },
      'user-1',
    )
  })
})

function createTestApp(service: ReturnType<typeof createConsentServiceMock>) {
  const app = new Hono()
  app.onError((error, c) => handleApiError(error, c))
  app.use('/api/*', async (c, next) => {
    const userId = c.req.header('x-user-id')
    c.set('authContext', {
      session: userId ? { session: { id: 'session-1' }, user: { id: userId } } : null,
      user: userId ? { id: userId } : null,
    })
    await next()
  })
  app.route(
    '/api/oauth/consent',
    createOAuthConsentRoute(() => service),
  )
  return app
}

function createConsentServiceMock() {
  return {
    loadConsentRequest: vi.fn(),
    createConsent: vi.fn().mockResolvedValue({
      id: 'consent-1',
      scopes: ['openid', 'profile'],
      grantedAt: '2026-01-01T00:00:00.000Z',
    }),
  }
}

function userHeaders() {
  return {
    'x-user-id': 'user-1',
  }
}
