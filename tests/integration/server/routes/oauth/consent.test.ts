import { handleApiError } from '@server/http/errors'
import { createOAuthConsentRoute } from '@server/http/routes/oauth/consent'
import * as applicationsUsecase from '@server/usecases/applications'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../../test-deps'

describe('OAuth consent routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('loads consent for the authenticated user', async () => {
    const service = createConsentServiceMock()
    const response = await createTestApp(service).request(
      '/api/oauth/consent?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&response_type=code&scope=openid%20profile&state=state-1&code_challenge=challenge-1&code_challenge_method=S256&nonce=nonce-1',
      {
        headers: userHeaders(),
      },
    )

    expect(response.status).toBe(200)
    expect(service.loadConsentRequest).toHaveBeenCalledWith(
      {
        clientId: 'client-1',
        redirectUri: 'https://client.example.com/callback',
        scope: 'openid profile',
        state: 'state-1',
        authorizationParams: {
          client_id: 'client-1',
          redirect_uri: 'https://client.example.com/callback',
          response_type: 'code',
          scope: 'openid profile',
          state: 'state-1',
          code_challenge: 'challenge-1',
          code_challenge_method: 'S256',
          nonce: 'nonce-1',
        },
      },
      { id: 'user-1', email: 'jane@example.com', name: 'Jane Stone', image: 'https://auth.example.com/avatar.png' },
    )
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
  vi.spyOn(applicationsUsecase, 'loadConsentRequest').mockImplementation((_d, _i, input, user) =>
    service.loadConsentRequest(input, user),
  )
  vi.spyOn(applicationsUsecase, 'createConsent').mockImplementation((_d, body, userId) =>
    service.createConsent(body, userId),
  )

  const app = new Hono()
  const deps = createTestDeps()
  app.onError((error, c) => handleApiError(error, c))
  app.use('/api/*', async (c, next) => {
    const userId = c.req.header('x-user-id')
    c.set('authContext', {
      session: userId ? { session: { id: 'session-1' }, user: { id: userId } } : null,
      user: userId
        ? { id: userId, email: 'jane@example.com', name: 'Jane Stone', image: 'https://auth.example.com/avatar.png' }
        : null,
    })
    c.set('deps', deps)
    await next()
  })
  app.route('/api/oauth/consent', createOAuthConsentRoute())
  return app
}

function createConsentServiceMock() {
  return {
    loadConsentRequest: vi.fn().mockResolvedValue({
      application: { clientId: 'client-1' },
      user: { email: 'jane@example.com', displayName: 'Jane Stone', image: 'https://auth.example.com/avatar.png' },
      redirects: {
        approveUrl: '/api/auth/oauth2/authorize?client_id=client-1',
        denyUrl: 'https://client.example.com/callback?error=access_denied',
      },
      requestedScopes: ['openid', 'profile'],
      existingConsent: null,
      state: 'state-1',
    }),
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
