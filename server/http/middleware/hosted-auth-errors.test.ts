import { createApp } from '@server/http/app'
import { createTestDeps } from '@server/http/test-deps'
import { afterEach, describe, expect, it, vi } from 'vitest'

const description = 'Requested Resource Server is not visible to this principal.'
afterEach(() => vi.restoreAllMocks())

function appWithResponse(response: Response | Error) {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  return createApp(
    {
      api: { getOAuthServerConfig: vi.fn(), getOpenIdConfig: vi.fn(), getSession: vi.fn().mockResolvedValue(null) },
      handler: async () => {
        if (response instanceof Error) throw response
        return response
      },
    },
    createTestDeps(),
  )
}

describe('[spec: hosted-auth/browser-auth-failure-page] browser failure boundary', () => {
  it.each([
    '/api/auth/oauth2/authorize',
    '/api/auth/callback/demo',
    '/api/auth/oauth2/callback/demo',
  ])('shows authorization failures from %s', async (path) => {
    const app = appWithResponse(
      Response.json({ error: 'invalid_target', error_description: description }, { status: 400 }),
    )
    const response = await app.request(path, { headers: { Accept: 'text/html' } })
    expect(response.status).toBe(303)
    const location = new URL(response.headers.get('Location')!, 'https://auth.example.com')
    expect(location.pathname).toBe('/auth/error')
    expect(location.searchParams.get('error')).toBe('invalid_target')
    expect(location.searchParams.get('error_description')).toBe(description)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each([
    '/api/auth/callback/demo',
    '/api/auth/oauth2/end-session',
  ])('shows document-navigation failures for %s', async (path) => {
    const response = await appWithResponse(
      Response.json(
        { error: 'access_denied', error_description: 'This request is no longer available.' },
        { status: 400 },
      ),
    ).request(path, { method: 'POST', headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toContain('/auth/error?error=access_denied')
  })

  it('handles thrown errors without exposing server internals', async () => {
    const response = await appWithResponse(new Error('secret database failure')).request('/api/auth/oauth2/authorize', {
      headers: { Accept: 'text/html' },
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toContain('server_error')
    expect(response.headers.get('Location')).not.toContain('secret')
  })

  it('handles invalid resource connection callbacks at the mounted boundary', async () => {
    const response = await appWithResponse(new Response()).request('/oauth/account-connection/callback', {
      headers: { Accept: 'text/html' },
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toContain('/auth/error?')
  })

  it('keeps JSON API failures and OAuth client redirects unchanged', async () => {
    const response = await appWithResponse(
      Response.json({ error: 'invalid_target', error_description: description }, { status: 400 }),
    ).request('/api/auth/oauth2/authorize', { headers: { Accept: 'application/json' } })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_target', error_description: description })
    const location = 'https://client.example.com/callback?error=consent_required&state=original'
    const redirected = await appWithResponse(
      new Response(null, { status: 302, headers: { Location: location } }),
    ).request('/api/auth/oauth2/authorize?prompt=none', { headers: { Accept: 'text/html' } })
    expect(redirected.status).toBe(302)
    expect(redirected.headers.get('Location')).toBe(location)
  })

  it('does not turn a fetch request accepting HTML into navigation', async () => {
    const response = await appWithResponse(Response.json({ error: 'invalid_target' }, { status: 400 })).request(
      '/api/auth/oauth2/authorize',
      { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'cors' } },
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('Location')).toBeNull()
  })

  it('does not redirect token endpoint failures', async () => {
    const response = await appWithResponse(Response.json({ error: 'invalid_grant' }, { status: 400 })).request(
      '/api/auth/oauth2/token',
      { method: 'POST', headers: { Accept: 'text/html' } },
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('Location')).toBeNull()
  })
})
