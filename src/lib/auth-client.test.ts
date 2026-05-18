import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiRequestError } from './api'
import { nativeAuth, signInWithSocial, verifyEmail } from './auth-client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('native auth client', () => {
  it('posts Better Auth native JSON requests', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      requests.push({ url: String(input), init })
      return Promise.resolve(jsonResponse({ url: 'https://github.com/oauth' }))
    })

    await expect(signInWithSocial({ provider: 'github', callbackURL: '/account' })).resolves.toEqual({
      url: 'https://github.com/oauth',
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('/api/auth/sign-in/social')
    expect(requests[0]?.init?.method).toBe('POST')
    expect(requests[0]?.init?.body).toBe(JSON.stringify({ provider: 'github', callbackURL: '/account' }))
  })

  it('uses native GET requests for token email verification', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ status: true }))

    await verifyEmail({ token: 'token-1', callbackURL: '/account' })

    expect(window.fetch).toHaveBeenCalledWith('/api/auth/verify-email?token=token-1&callbackURL=%2Faccount', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    })
  })

  it('surfaces Better Auth error messages', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ error: { message: 'Invalid credentials' } }, 401))

    await expect(nativeAuth('/sign-in/email', { email: 'jane@example.com', password: 'wrong' })).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 401,
      message: 'Invalid credentials',
    } satisfies Partial<ApiRequestError>)
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
