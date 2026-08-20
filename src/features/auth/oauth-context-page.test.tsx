import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthContextPage } from './oauth-context-page'

const oauthQuery =
  'client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=signed-state&code_challenge=challenge-1'
const configz = {
  branding: { logoUrl: null, faviconUrl: null, primaryColor: null, backgroundColor: null, customCss: null },
  links: { privacyUri: null, termsUri: null, supportUri: null, supportEmail: null },
  copy: { productName: 'Realmroot' },
}
const request = {
  application: { name: 'Context Client' },
  authorizationContexts: [
    {
      id: 'user:user-1',
      type: 'user',
      displayName: 'Jane Stone',
      description: 'User Context · jane@example.com',
      organizationId: null,
    },
    {
      id: 'organization:org-a',
      type: 'organization',
      displayName: 'Organization A',
      description: 'Organization Context',
      organizationId: 'org-a',
    },
  ],
}

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.history.pushState(null, '', `/auth/context?${oauthQuery}`)
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, search: `?${oauthQuery}`, assign })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.pushState(null, '', '/')
})

describe('OAuthContextPage', () => {
  it('[spec: hosted-auth/oauth-authorization-context-selection] selects accessible User and Organization Contexts', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url, body })
      if (url.startsWith('/api/configz')) return jsonResponse(configz)
      if (url.startsWith('/api/account/application-authorization-request')) return jsonResponse(request)
      if (url.endsWith('/api/auth/oauth2/continue')) {
        return jsonResponse({ redirect: true, url: 'https://client.example.com/callback?code=code-1' })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    render(<OAuthContextPage />)

    const userContext = await screen.findByRole('radio', { name: /Jane Stone/ })
    const organizationContext = screen.getByRole('radio', { name: /Organization A/ })
    expect(userContext).toHaveProperty('checked', false)
    expect(organizationContext).toHaveProperty('checked', false)
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', true)
    fireEvent.click(userContext)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://client.example.com/callback?code=code-1'))
    expect(calls.some((call) => call.url.includes('/organization/set-active'))).toBe(false)
    expect(calls).toContainEqual({
      url: '/api/auth/oauth2/continue',
      body: { postLogin: true, consentReferenceId: 'user:user-1', oauth_query: oauthQuery },
    })
  })

  it('continues with the selected attempt-scoped Organization Context', async () => {
    const bodies: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return jsonResponse(configz)
      if (url.startsWith('/api/account/application-authorization-request')) return jsonResponse(request)
      if (url.endsWith('/api/auth/oauth2/continue')) {
        bodies.push(JSON.parse(String(init?.body)))
        return jsonResponse({ url: 'https://client.example.com/callback' })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    render(<OAuthContextPage />)
    fireEvent.click(await screen.findByRole('radio', { name: /Organization A/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(bodies).toContainEqual({
        postLogin: true,
        consentReferenceId: 'organization:org-a',
        oauth_query: oauthQuery,
      }),
    )
  })

  it('cancels with the complete OAuth query and switches accounts through sign-out', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url, body })
      if (url.startsWith('/api/configz')) return jsonResponse(configz)
      if (url.startsWith('/api/account/application-authorization-request')) return jsonResponse(request)
      if (url.endsWith('/api/auth/oauth2/consent')) {
        return jsonResponse({ url: 'https://client.example.com/callback?error=access_denied' })
      }
      if (url.endsWith('/api/auth/sign-out')) return jsonResponse({ success: true })
      throw new Error(`Unexpected request: ${url}`)
    })

    const view = render(<OAuthContextPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/auth/oauth2/consent',
        body: { accept: false, oauth_query: oauthQuery },
      }),
    )

    view.unmount()
    render(<OAuthContextPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different account' }))
    await waitFor(() => expect(calls.some((call) => call.url === '/api/auth/sign-out')).toBe(true))
    expect(assign).toHaveBeenLastCalledWith(expect.stringContaining('/auth/sign-in?return_to='))
  })

  it('shows incomplete, load, and continuation errors without redirecting', async () => {
    window.history.pushState(null, '', '/auth/context')
    vi.stubGlobal('location', { ...window.location, search: '', assign })
    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      if (String(input).startsWith('/api/configz')) return jsonResponse(configz)
      throw new Error('Contexts unavailable')
    })
    const view = render(<OAuthContextPage />)
    expect(await screen.findByText(/authorization request is incomplete/i)).toBeTruthy()
    view.unmount()

    vi.stubGlobal('location', { ...window.location, search: `?${oauthQuery}`, assign })
    render(<OAuthContextPage />)
    expect(await screen.findByText('Contexts unavailable')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })

  it('keeps the Context chooser visible when the selected Context is rejected', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return jsonResponse(configz)
      if (url.startsWith('/api/account/application-authorization-request')) return jsonResponse(request)
      if (url.endsWith('/api/auth/oauth2/continue')) {
        return jsonResponse({ message: 'Context no longer available' }, 403)
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    render(<OAuthContextPage />)
    fireEvent.click(await screen.findByRole('radio', { name: /Organization A/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(/Context no longer available|Unable to select this Context/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', false)
    expect(assign).not.toHaveBeenCalled()
  })

  it('ignores submission without a selection and recovers when the next authorization step is missing', async () => {
    let continuationRequests = 0
    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return jsonResponse(configz)
      if (url.startsWith('/api/account/application-authorization-request')) return jsonResponse(request)
      if (url.endsWith('/api/auth/oauth2/continue')) {
        continuationRequests += 1
        return jsonResponse({})
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    render(<OAuthContextPage />)
    const userContext = await screen.findByRole('radio', { name: /Jane Stone/ })
    fireEvent.submit(screen.getByRole('group', { name: 'Continue with' }).closest('form')!)
    expect(continuationRequests).toBe(0)

    fireEvent.click(userContext)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/did not return the next authorization step/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', false)
    expect(assign).not.toHaveBeenCalled()
  })

  it('recovers when cancellation has no callback and when account switching fails unexpectedly', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return jsonResponse(configz)
      if (url.startsWith('/api/account/application-authorization-request')) return jsonResponse(request)
      if (url.endsWith('/api/auth/oauth2/consent')) return jsonResponse({})
      if (url.endsWith('/api/auth/sign-out')) throw 'unexpected sign-out failure'
      throw new Error(`Unexpected request: ${url}`)
    })

    const view = render(<OAuthContextPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText(/did not return a callback URL/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', false)

    view.unmount()
    render(<OAuthContextPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different account' }))
    expect(await screen.findByText('Unable to switch accounts.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use a different account' })).toHaveProperty('disabled', false)
  })

  it('shows safe fallback messages for unexpected non-Error failures', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return jsonResponse(configz)
      if (url.startsWith('/api/account/application-authorization-request')) throw 'unexpected load failure'
      throw new Error(`Unexpected request: ${url}`)
    })
    const loadView = render(<OAuthContextPage />)
    expect(await screen.findByText('Unable to load authorization Contexts.')).toBeTruthy()
    loadView.unmount()

    vi.restoreAllMocks()
    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return jsonResponse(configz)
      if (url.startsWith('/api/account/application-authorization-request')) return jsonResponse(request)
      if (url.endsWith('/api/auth/oauth2/continue')) throw 'unexpected continuation failure'
      if (url.endsWith('/api/auth/oauth2/consent')) throw 'unexpected cancellation failure'
      throw new Error(`Unexpected request: ${url}`)
    })
    const continuationView = render(<OAuthContextPage />)
    fireEvent.click(await screen.findByRole('radio', { name: /Jane Stone/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Unable to select this Context.')).toBeTruthy()
    continuationView.unmount()

    render(<OAuthContextPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Unable to cancel authorization.')).toBeTruthy()
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
