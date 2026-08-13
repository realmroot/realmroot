import { QueryClient } from '@tanstack/react-query'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { accountQueryKeys } from '@/lib/account-query'
import {
  loadAccountProfile,
  loadDeveloperConsoleAccess,
  requireAccountProfile,
  takeAccountReturnTarget,
} from '@/lib/route-auth'

const base = 'http://localhost:3000'
const server = setupServer()

function routeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  sessionStorage.clear()
})
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

describe('loadDeveloperConsoleAccess', () => {
  it('surfaces a failed access-policy response', async () => {
    server.use(
      http.get(`${base}/api/account/developer-console-access`, () =>
        HttpResponse.json({ error: 'Access policy unavailable.' }, { status: 503 }),
      ),
    )
    await expect(loadDeveloperConsoleAccess()).rejects.toThrow('Access policy unavailable.')
  })
})

describe('requireAccountProfile', () => {
  it('reuses fresh route authentication data across navigations', async () => {
    let profileRequests = 0
    let securityRequests = 0
    server.use(
      http.get(`${base}/api/account/profile`, () => {
        profileRequests += 1
        return HttpResponse.json({ user: { role: 'user' } })
      }),
      http.get(`${base}/api/account/security`, () => {
        securityRequests += 1
        return HttpResponse.json({ security: { mfa: { enabled: false }, policy: { mfa: { mode: 'optional' } } } })
      }),
    )
    const queryClient = routeQueryClient()

    await requireAccountProfile('/profile', queryClient)
    await requireAccountProfile('/applications', queryClient)

    expect(profileRequests).toBe(1)
    expect(securityRequests).toBe(1)
  })

  it('reloads route authentication data after explicit invalidation', async () => {
    let profileRequests = 0
    let securityRequests = 0
    server.use(
      http.get(`${base}/api/account/profile`, () => {
        profileRequests += 1
        return HttpResponse.json({ user: { role: 'user' } })
      }),
      http.get(`${base}/api/account/security`, () => {
        securityRequests += 1
        return HttpResponse.json({ security: { mfa: { enabled: false }, policy: { mfa: { mode: 'optional' } } } })
      }),
    )
    const queryClient = routeQueryClient()
    await requireAccountProfile('/profile', queryClient)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.profile }),
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.security }),
    ])

    await requireAccountProfile('/applications', queryClient)

    expect(profileRequests).toBe(2)
    expect(securityRequests).toBe(2)
  })

  it('returns the profile when authenticated', async () => {
    server.use(
      http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: { role: 'user' } })),
      http.get(`${base}/api/account/security`, () =>
        HttpResponse.json({ security: { mfa: { enabled: false }, policy: { mfa: { mode: 'optional' } } } }),
      ),
    )
    expect(await requireAccountProfile('/profile', routeQueryClient())).toEqual({ user: { role: 'user' } })
  })

  it('does not require a second security lookup on the Security page', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: { role: 'user' } })))
    expect(await requireAccountProfile('/security', routeQueryClient())).toEqual({ user: { role: 'user' } })
  })

  it('redirects an unenrolled user to Account Security when MFA is required', async () => {
    server.use(
      http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: { role: 'user' } })),
      http.get(`${base}/api/account/security`, () =>
        HttpResponse.json({ security: { mfa: { enabled: false }, policy: { mfa: { mode: 'required' } } } }),
      ),
    )

    try {
      await requireAccountProfile('/console', routeQueryClient())
      expect.unreachable('should have redirected to enrollment')
    } catch (error) {
      const redirectResponse = error as Response & { options: { href?: string } }
      expect(redirectResponse.options.href).toBe('/security')
    }
  })

  it('redirects to hosted sign-in with the return path when unauthenticated', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => new HttpResponse(null, { status: 401 })))
    try {
      await requireAccountProfile('/profile?tab=security', routeQueryClient())
      expect.unreachable('should have thrown a redirect')
    } catch (error) {
      const redirectResponse = error as Response & { options: { href?: string } }
      expect(redirectResponse.options.href).toBe('/auth/sign-in?return_to=%2Fprofile%3Ftab%3Dsecurity')
      expect(redirectResponse.headers.get('Location')).toBe('/auth/sign-in?return_to=%2Fprofile%3Ftab%3Dsecurity')
    }
  })

  it('keeps fragment-bearing approval targets through sign-in without exposing the token [spec: agent-identity/agent-resource-approval-sign-in]', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => new HttpResponse(null, { status: 401 })))
    const approval = '/agent/resource-access/approve#token=secret'

    try {
      await requireAccountProfile(approval, routeQueryClient())
      expect.unreachable('should have thrown a redirect')
    } catch (error) {
      const redirectResponse = error as Response & { options: { href?: string } }
      const href = redirectResponse.options.href!
      expect(href).toMatch(/^\/auth\/sign-in\?return_key=/)
      expect(href).not.toContain('secret')
      const returnKey = new URL(href, base).searchParams.get('return_key')!
      expect(takeAccountReturnTarget(returnKey)).toBe(approval)
      expect(takeAccountReturnTarget(returnKey)).toBeUndefined()
    }
  })

  it('does not read storage without a return key', () => {
    expect(takeAccountReturnTarget(undefined)).toBeUndefined()
  })
})
