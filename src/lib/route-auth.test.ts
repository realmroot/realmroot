import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadAccountProfile, requireAccountProfile } from '@/lib/route-auth'

const base = 'http://localhost:3000'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('loadAccountProfile', () => {
  it('returns the profile body when authenticated', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: { role: 'admin' } })))
    const profile = await loadAccountProfile()
    expect(profile).toEqual({ user: { role: 'admin' } })
  })

  it('returns null on a 401 response', async () => {
    server.use(
      http.get(`${base}/api/account/profile`, () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    )
    expect(await loadAccountProfile()).toBeNull()
  })

  it('throws a string error message from the error body', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ error: 'boom' }, { status: 500 })))
    await expect(loadAccountProfile()).rejects.toThrow('boom')
  })

  it('throws a nested error message from the error body', async () => {
    server.use(
      http.get(`${base}/api/account/profile`, () =>
        HttpResponse.json({ error: { message: 'nested boom' } }, { status: 500 }),
      ),
    )
    await expect(loadAccountProfile()).rejects.toThrow('nested boom')
  })

  it('throws the raw text when the error body is not JSON', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => new HttpResponse('plain failure', { status: 500 })))
    await expect(loadAccountProfile()).rejects.toThrow('plain failure')
  })

  it('falls back to the status text when the error body is empty', async () => {
    server.use(
      http.get(`${base}/api/account/profile`, () => new HttpResponse(null, { status: 503, statusText: 'Unavailable' })),
    )
    await expect(loadAccountProfile()).rejects.toThrow('Unavailable')
  })

  it('returns the raw text when the JSON body has no error field', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ other: true }, { status: 500 })))
    await expect(loadAccountProfile()).rejects.toThrow('{"other":true}')
  })
})

describe('requireAccountProfile', () => {
  it('returns the profile when authenticated', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: { role: 'user' } })))
    expect(await requireAccountProfile('/profile')).toEqual({ user: { role: 'user' } })
  })

  it('redirects to hosted sign-in with the return path when unauthenticated', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => new HttpResponse(null, { status: 401 })))
    try {
      await requireAccountProfile('/profile?tab=security')
      expect.unreachable('should have thrown a redirect')
    } catch (error) {
      const redirectResponse = error as Response & { options: { href?: string } }
      expect(redirectResponse.options.href).toBe('/auth/sign-in?return_to=%2Fprofile%3Ftab%3Dsecurity')
      expect(redirectResponse.headers.get('Location')).toBe('/auth/sign-in?return_to=%2Fprofile%3Ftab%3Dsecurity')
    }
  })
})
